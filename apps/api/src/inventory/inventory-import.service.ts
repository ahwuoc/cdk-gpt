import { Inject, Injectable, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { EncryptionService, createMaskedPreview } from '@store/encryption';
import { ImportBatch, ImportBatchStatus, InventoryItem, Product } from '@store/database';
import { InventoryStatus, isMongoDuplicateKey } from '@store/shared';
import { STOCK_ALERT_QUEUE, type StockAlertQueueClient } from './stock-alert.queue';

interface PreparedRow { line: number; normalized: Record<string, unknown>; hash: string; maskedPreview: Record<string, unknown>; }
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

  private async prepare(productId: string, rows: Record<string, unknown>[]) {
    const product = await this.products.findOne({ _id: productId, deletedAt: null }).lean();
    if (!product) throw new Error('Product not found');
    const errors: ImportError[] = []; const prepared: PreparedRow[] = []; const seen = new Set<string>();
    let duplicateRows = 0;
    rows.forEach((row, index) => {
      const line = index + 1;
      if (!row || Object.values(row).every((value) => value === '' || value === null || value === undefined)) {
        errors.push({ line, reason: 'Blank row skipped' }); return;
      }
      try {
        const normalized = this.normalize(row, product.fieldDefinitions);
        const hash = this.encryption.normalizedHash(normalized);
        if (seen.has(hash)) { duplicateRows++; errors.push({ line, reason: 'Duplicate row in import' }); return; }
        seen.add(hash);
        prepared.push({ line, normalized, hash, maskedPreview: createMaskedPreview(normalized, product.fieldDefinitions) });
      } catch (error) { errors.push({ line, reason: error instanceof Error ? error.message : 'Invalid row' }); }
    });
    const databaseHashes = new Set((await this.inventory.find({ productId, payloadHash: { $in: prepared.map((row) => row.hash) }, deletedAt: null })
      .select('+payloadHash').lean()).map((item) => item.payloadHash));
    const importable = prepared.filter((row) => {
      if (!databaseHashes.has(row.hash)) return true;
      duplicateRows++; errors.push({ line: row.line, reason: 'Duplicate row already in inventory' }); return false;
    });
    return { totalRows: rows.length, validRows: importable.length, invalidRows: errors.length - duplicateRows,
      duplicateRows, preview: importable.slice(0, 100).map(({ line, maskedPreview }) => ({ line, maskedPreview })),
      errors, prepared: importable };
  }

  async commit(productId: string, rows: Record<string, unknown>[], adminId: string, sourceName?: string) {
    const report = await this.prepare(productId, rows);
    const batch = await this.batches.create({ productId, createdBy: adminId, status: ImportBatchStatus.PROCESSING,
      totalRows: report.totalRows, validRows: report.validRows, invalidRows: report.invalidRows,
      duplicateRows: report.duplicateRows, importedRows: 0, sourceName, rowErrors: report.errors });
    let importedRows = 0; const runtimeErrors: ImportError[] = [];
    for (let offset = 0; offset < report.prepared.length; offset += 500) {
      const chunk = report.prepared.slice(offset, offset + 500);
      try {
        const result = await this.inventory.bulkWrite(chunk.map((row) => ({ insertOne: { document: {
          productId: new Types.ObjectId(productId), encryptedPayload: this.encryption.encrypt(row.normalized),
          maskedPreview: row.maskedPreview, payloadHash: row.hash, status: InventoryStatus.AVAILABLE,
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
    batch.importedRows = importedRows; batch.duplicateRows += runtimeErrors.filter((item) => item.reason.includes('Duplicate')).length;
    batch.rowErrors.push(...runtimeErrors); batch.status = importedRows === report.prepared.length ? ImportBatchStatus.COMPLETED : ImportBatchStatus.PARTIAL;
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
      duplicateRows: batch.duplicateRows, importedRows, skipped: batch.rowErrors, restockNotificationQueued };
  }

  private normalize(row: Record<string, unknown>, fields: Product['fieldDefinitions']) {
    const output: Record<string, unknown> = {};
    for (const field of fields.sort((a, b) => a.sortOrder - b.sortOrder)) {
      let value = row[field.key];
      if (typeof value === 'string') value = value.trim();
      if (field.required && (value === undefined || value === null || value === '')) throw new Error(`${field.key} is required`);
      if (value === undefined || value === null || value === '') continue;
      if (field.type === 'EMAIL' && (typeof value !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))) throw new Error(`${field.key} must be an email`);
      if (field.type === 'URL' && (typeof value !== 'string' || !URL.canParse(value))) throw new Error(`${field.key} must be a URL`);
      if (field.type === 'NUMBER') { value = Number(value); if (!Number.isFinite(value)) throw new Error(`${field.key} must be a number`); }
      if (field.type === 'BOOLEAN' && typeof value !== 'boolean') throw new Error(`${field.key} must be boolean`);
      output[field.key] = value;
    }
    return output;
  }
}
