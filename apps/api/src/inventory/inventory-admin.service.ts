import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { ClientSession, Connection, Model } from 'mongoose';
import { EncryptionService } from '@store/encryption';
import { AuditLog, ImportBatch, InventoryItem, Product } from '@store/database';
import { formatInventoryPatternPayload, InventoryStatus, parseInventoryPatternTemplate } from '@store/shared';
import type { InventoryListQueryDto } from './inventory.dto';

type InventoryListItem = {
  id: string;
  productId: string;
  status: InventoryItem['status'];
  maskedPreview: Record<string, unknown>;
  importBatchId?: string;
  createdAt: Date;
  updatedAt: Date;
};

type InventoryPage = {
  items: InventoryListItem[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

@Injectable()
export class InventoryAdminService {
  private readonly encryption = EncryptionService.fromEnvironment();
  constructor(
    @InjectModel('InventoryItem') private readonly items: Model<InventoryItem>,
    @InjectModel('AuditLog') private readonly audits: Model<AuditLog>,
    // Optional keeps direct, read-only service construction in workers/tests backwards compatible.
    @Optional() @InjectConnection() private readonly connection?: Connection,
    @Optional() @InjectModel('ImportBatch') private readonly batches?: Model<ImportBatch>,
    @Optional() @InjectModel('Product') private readonly products?: Model<Product>,
  ) {}

  async list(query: InventoryListQueryDto): Promise<InventoryPage> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const filter: Record<string, unknown> = { deletedAt: null };
    if (query.productId) filter.productId = new Types.ObjectId(query.productId);
    if (query.status) filter.status = query.status;

    const search = (query.query ?? query.search)?.trim();
    if (search) {
      const safePattern = escapeRegex(search);
      const matches: Record<string, unknown>[] = [{
        $expr: {
          $anyElementTrue: {
            $map: {
              input: { $objectToArray: { $ifNull: ['$maskedPreview', {}] } },
              as: 'field',
              in: {
                $regexMatch: {
                  input: { $convert: { input: '$$field.v', to: 'string', onError: '', onNull: '' } },
                  regex: safePattern,
                  options: 'i',
                },
              },
            },
          },
        },
      }];
      // The UI commonly pastes one of these IDs. Use exact ObjectId matching rather than
      // applying a regex to identifiers, which keeps this path indexed and predictable.
      if (Types.ObjectId.isValid(search)) {
        const id = new Types.ObjectId(search);
        matches.push({ _id: id }, { importBatchId: id });
      }
      filter.$or = matches;
    }

    const [items, total] = await Promise.all([
      this.items.find(filter).select('productId status maskedPreview importBatchId createdAt updatedAt')
        .sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      this.items.countDocuments(filter),
    ]);
    return {
      items: items.map((item) => ({
        id: item._id.toString(),
        productId: item.productId.toString(),
        status: item.status,
        maskedPreview: item.maskedPreview ?? {},
        ...(item.importBatchId ? { importBatchId: item.importBatchId.toString() } : {}),
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      })),
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    };
  }

  /** Soft-delete one item, but only while it is still safe to remove. */
  async removeItem(itemId: string, adminId: string, requestId?: string) {
    const inventoryId = this.objectId(itemId, 'inventory');
    const actorId = this.objectId(adminId, 'admin');
    const connection = this.transactionConnection();
    let removed = false;
    const session = await connection.startSession();
    try {
      await session.withTransaction(async () => {
        const item = await this.items.findOneAndUpdate({
          _id: inventoryId,
          deletedAt: null,
          status: InventoryStatus.AVAILABLE,
        }, { $set: { deletedAt: new Date(), updatedBy: actorId } }, { new: true, session }).lean();
        if (!item) {
          const existing = await this.items.findOne({ _id: inventoryId, deletedAt: null }).select('status').session(session).lean();
          if (!existing) throw new NotFoundException('Không tìm thấy hàng trong kho.');
          throw new ConflictException('Chỉ có thể xóa hàng đang có sẵn. Hàng đã bán hoặc đang giữ được bảo vệ.');
        }
        removed = true;
        await this.audit(actorId, 'INVENTORY_ITEM_REMOVED', item._id, requestId,
          { productId: item.productId.toString(), importBatchId: item.importBatchId?.toString(), status: item.status }, session);
      });
    } finally { await session.endSession(); }
    return { removed, id: inventoryId.toString() };
  }

  /**
   * Remove a mistaken import batch without touching inventory that might already be in a purchase
   * or a completed order. The status predicate is part of the write, not merely a pre-check.
   */
  async removeBatch(batchId: string, adminId: string, requestId?: string) {
    const importBatchId = this.objectId(batchId, 'import batch');
    const actorId = this.objectId(adminId, 'admin');
    const connection = this.transactionConnection();
    const batches = this.batchModel();
    let removedCount = 0;
    let protectedCount = 0;
    const session = await connection.startSession();
    try {
      await session.withTransaction(async () => {
        const batch = await batches.exists({ _id: importBatchId }).session(session);
        if (!batch) throw new NotFoundException('Không tìm thấy lô nhập kho.');

        const result = await this.items.updateMany({
          importBatchId,
          deletedAt: null,
          status: InventoryStatus.AVAILABLE,
        }, { $set: { deletedAt: new Date(), updatedBy: actorId } }, { session });
        removedCount = result.modifiedCount;
        // Every non-AVAILABLE row remains untouched. This includes reserved, sold, disabled and
        // returned rows, so a bad bulk deletion can never break an in-flight or past order.
        protectedCount = await this.items.countDocuments({
          importBatchId,
          deletedAt: null,
          status: { $ne: InventoryStatus.AVAILABLE },
        }).session(session);
        await this.audit(actorId, 'INVENTORY_BATCH_AVAILABLE_REMOVED', importBatchId, requestId,
          { removedCount, protectedCount }, session, 'ImportBatch');
      });
    } finally { await session.endSession(); }
    const message = protectedCount
      ? `Đã xóa ${removedCount} hàng có sẵn; giữ lại ${protectedCount} hàng đã bán hoặc đang xử lý.`
      : `Đã xóa ${removedCount} hàng có sẵn trong lô.`;
    return { removedCount, protectedCount, message };
  }

  async readFullPayload(itemId: string, adminId: string, permissions: string[], requestId?: string) {
    if (!permissions.includes('*') && !permissions.includes('inventory.read_sensitive')) throw new ForbiddenException('Sensitive inventory permission required');
    const item = await this.items.findOne({ _id: itemId, deletedAt: null }).select('+encryptedPayload');
    if (!item) throw new NotFoundException('Inventory item not found');
    const payload = this.encryption.decrypt<Record<string, unknown>>(item.encryptedPayload);
    if (!this.products) throw new Error('Product model is required to format inventory payloads');
    const product = await this.products.findById(item.productId).select('inventoryPattern fieldDefinitions').lean();
    if (!product) throw new NotFoundException('Inventory product not found');
    const inventoryPattern = product.inventoryPattern?.trim() || [...product.fieldDefinitions]
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .map((field) => `{{${field.key}}}`).join('----');
    const formatted = formatInventoryPatternPayload(payload, parseInventoryPatternTemplate(inventoryPattern));
    await this.audits.create({ actorType: 'ADMIN', actorId: new Types.ObjectId(adminId), action: 'INVENTORY_PAYLOAD_READ',
      resourceType: 'InventoryItem', resourceId: item._id, requestId, metadata: { keyVersion: this.encryption.currentVersion } });
    return { productId: item.productId.toString(), inventoryPattern, formatted };
  }

  private transactionConnection() {
    if (!this.connection) throw new Error('Inventory transaction connection is unavailable');
    return this.connection;
  }

  private batchModel() {
    if (!this.batches) throw new Error('Import batch model is unavailable');
    return this.batches;
  }

  private objectId(value: string, label: string) {
    if (!Types.ObjectId.isValid(value)) throw new BadRequestException(`Invalid ${label} identifier`);
    return new Types.ObjectId(value);
  }

  private audit(actorId: Types.ObjectId, action: string, resourceId: Types.ObjectId, requestId: string | undefined,
    metadata: Record<string, unknown>, session: ClientSession, resourceType = 'InventoryItem') {
    return this.audits.create([{ actorType: 'ADMIN', actorId, action, resourceType, resourceId, requestId, metadata }], { session });
  }
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
