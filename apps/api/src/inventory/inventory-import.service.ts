import { Inject, Injectable, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { EncryptionService, createMaskedPreview } from '@store/encryption';
import { ImportBatch, ImportBatchStatus, InventoryItem, Product } from '@store/database';
import { InventoryStatus, inventorySearchValues, isMongoDuplicateKey } from '@store/shared';
import { STOCK_ALERT_QUEUE, type StockAlertQueueClient } from './stock-alert.queue';

interface PreparedRow {
  line: number;
  normalized: Record<string, unknown>;
  hash: string;
  maskedPreview: Record<string, unknown>;
  existingId?: Types.ObjectId;
}
interface ImportError { line: number; reason: string; }

@Injectable()
export class InventoryImportService {
  private readonly encryption = EncryptionService.fromEnvironment();
  constructor(
    @InjectModel('Product') private readonly products: Model<Product>,
    @InjectModel('InventoryItem') private readonly inventory: Model<InventoryItem>,
    @InjectModel('ImportBatch') private readonly batches: Model<ImportBatch>,
    @Optional() @Inject(STOCK_ALERT_QUEUE) private readonly stockAlerts?: StockAlertQueueClient,
  ) {}

  async preview(productId: string, rows: Record<string, unknown>[]) {
    const { prepared: _prepared, ...report } = await this.prepare(productId, rows);
    return report;
  }

  private async prepare(productId: string, rows: Record<string, unknown>[], overwriteDuplicates = false) {
    const product = await this.products.findOne({ _id: productId, deletedAt: null }).lean();
    if (!product) throw new Error('Product not found');
    const errors: ImportError[] = []; const prepared: PreparedRow[] = []; const seen = new Set<string>();
    let duplicateRows = 0; let invalidRows = 0;
    rows.forEach((row, index) => {
      const line = index + 1;
      if (!row || Object.values(row).every((value) => value === '' || value === null || value === undefined)) {
        invalidRows++; errors.push({ line, reason: 'Blank row skipped' }); return;
      }
      try {
        const normalized = this.normalize(row, product.fieldDefinitions);
        const hash = this.encryption.normalizedHash(normalized);
        if (seen.has(hash)) { duplicateRows++; errors.push({ line, reason: 'Duplicate row in import' }); return; }
        seen.add(hash);
        prepared.push({ line, normalized, hash, maskedPreview: createMaskedPreview(normalized, product.fieldDefinitions) });
      } catch (error) {
        invalidRows++; errors.push({ line, reason: error instanceof Error ? error.message : 'Invalid row' });
      }
    });
    const databaseRows = await this.inventory.find({ productId,
      payloadHash: { $in: prepared.map((row) => row.hash) }, deletedAt: null })
      .select('_id status +payloadHash').lean();
    const existingByHash = new Map(databaseRows.map((item) => [item.payloadHash, item]));
    let overwriteableRows = 0;
    const importable = prepared.flatMap((row) => {
      const existing = existingByHash.get(row.hash);
      if (!existing) return [row];
      duplicateRows++;
      if (existing.status === InventoryStatus.AVAILABLE) {
        overwriteableRows++;
        if (overwriteDuplicates) return [{ ...row, existingId: existing._id }];
        errors.push({ line: row.line, reason: 'Duplicate row already in inventory' });
      } else {
        errors.push({ line: row.line, reason: 'Duplicate row is sold or reserved and cannot be overwritten' });
      }
      return [];
    });
    return { totalRows: rows.length, validRows: importable.length, invalidRows,
      duplicateRows, overwriteableRows,
      preview: importable.slice(0, 100).map(({ line, maskedPreview }) => ({ line, maskedPreview })),
      errors, prepared: importable };
  }

  async commit(productId: string, rows: Record<string, unknown>[], adminId: string, sourceName?: string,
    overwriteDuplicates = false) {
    const report = await this.prepare(productId, rows, overwriteDuplicates);
    const batch = await this.batches.create({ productId, createdBy: adminId, status: ImportBatchStatus.PROCESSING,
      totalRows: report.totalRows, validRows: report.validRows, invalidRows: report.invalidRows,
      duplicateRows: report.duplicateRows, importedRows: 0, sourceName, rowErrors: report.errors });
    let importedRows = 0; let overwrittenRows = 0; const runtimeErrors: ImportError[] = [];
    const inserts = report.prepared.filter((row) => !row.existingId);
    for (let offset = 0; offset < inserts.length; offset += 500) {
      const chunk = inserts.slice(offset, offset + 500);
      try {
        const result = await this.inventory.bulkWrite(chunk.map((row) => ({ insertOne: { document: {
          productId: new Types.ObjectId(productId), encryptedPayload: this.encryption.encrypt(row.normalized),
          maskedPreview: row.maskedPreview, searchValues: inventorySearchValues(row.maskedPreview),
          payloadHash: row.hash, status: InventoryStatus.AVAILABLE,
          importBatchId: batch._id, createdBy: new Types.ObjectId(adminId), deletedAt: null,
        } } })), { ordered: false });
        importedRows += result.insertedCount;
      } catch (error) {
        const writeErrors = (error as { writeErrors?: Array<{ index: number; code: number }> }).writeErrors ?? [];
        importedRows += Math.max(0, chunk.length - writeErrors.length);
        for (const item of writeErrors) runtimeErrors.push({ line: chunk[item.index]?.line ?? offset + item.index + 1,
          reason: item.code === 11000 ? 'Duplicate inserted concurrently' : 'Database write rejected' });
        if (!writeErrors.length && !isMongoDuplicateKey(error)) throw error;
      }
    }
    const overwrites = report.prepared.filter((row): row is PreparedRow & { existingId: Types.ObjectId } => Boolean(row.existingId));
    for (let offset = 0; offset < overwrites.length; offset += 500) {
      const chunk = overwrites.slice(offset, offset + 500);
      const rejectedIndexes = new Set<number>();
      try {
        await this.inventory.bulkWrite(chunk.map((row) => ({ updateOne: {
          filter: { _id: row.existingId, productId: new Types.ObjectId(productId), status: InventoryStatus.AVAILABLE,
            deletedAt: null, payloadHash: row.hash },
          update: { $set: { encryptedPayload: this.encryption.encrypt(row.normalized), maskedPreview: row.maskedPreview,
            searchValues: inventorySearchValues(row.maskedPreview),
            importBatchId: batch._id, updatedBy: new Types.ObjectId(adminId) } },
        } })), { ordered: false });
      } catch (error) {
        const writeErrors = (error as { writeErrors?: Array<{ index: number }> }).writeErrors ?? [];
        if (!writeErrors.length) throw error;
        writeErrors.forEach((item) => {
          rejectedIndexes.add(item.index);
          runtimeErrors.push({ line: chunk[item.index]?.line ?? offset + item.index + 1,
            reason: 'Database rejected duplicate overwrite' });
        });
      }
      const candidates = chunk.filter((_, index) => !rejectedIndexes.has(index));
      const updatedIds = new Set((await this.inventory.find({ _id: { $in: candidates.map((row) => row.existingId) },
        importBatchId: batch._id }).select('_id').lean()).map((item) => item._id.toString()));
      overwrittenRows += updatedIds.size;
      candidates.filter((row) => !updatedIds.has(row.existingId.toString())).forEach((row) => runtimeErrors.push({
        line: row.line, reason: 'Duplicate became sold or reserved before overwrite and was protected',
      }));
    }
    batch.importedRows = importedRows;
    batch.duplicateRows += runtimeErrors.filter((item) => item.reason === 'Duplicate inserted concurrently').length;
    batch.rowErrors.push(...runtimeErrors); batch.status = importedRows + overwrittenRows === report.prepared.length
      ? ImportBatchStatus.COMPLETED : ImportBatchStatus.PARTIAL;
    await batch.save();
    let restockNotificationQueued = false;
    if (importedRows > 0 && this.stockAlerts) {
      try {
        await this.stockAlerts.enqueue({ productId, importBatchId: batch._id.toString(), importedRows });
        restockNotificationQueued = true;
      } catch (error) {
        // Stock import remains successful even if Redis is temporarily unavailable; no inventory is rolled back.
        console.error({ event: 'product-restock-alert-queue-failed', message: error instanceof Error ? error.message : 'unknown error' });
      }
    }
    return { batchId: batch._id, totalRows: batch.totalRows, validRows: batch.validRows, invalidRows: batch.invalidRows,
      duplicateRows: batch.duplicateRows, overwriteableRows: report.overwriteableRows, importedRows, overwrittenRows,
      skipped: batch.rowErrors, restockNotificationQueued };
  }

  private normalize(row: Record<string, unknown>, fields: Product['fieldDefinitions']) {
    const output: Record<string, unknown> = {};
    for (const field of fields.sort((a, b) => a.sortOrder - b.sortOrder)) {
      let value = row[field.key];
      if (typeof value === 'string') value = value.trim();
      if (field.required && (value === undefined || value === null || value === '')) throw new Error(`${field.key} is required`);
      if (value === undefined || value === null || value === '') continue;
      output[field.key] = typeof value === 'string' ? value : String(value);
    }
    return output;
  }
}
