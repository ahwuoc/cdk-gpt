import { Schema, model, models } from 'mongoose';
import type { HydratedDocument, Types, Model } from 'mongoose';
import { InventoryStatus } from '@store/shared';
import { baseSchemaOptions, metadata, objectId, softDelete } from './common';

export interface InventoryItem {
  productId: Types.ObjectId; encryptedPayload: string; maskedPreview: Record<string, unknown>; payloadHash: string;
  status: typeof InventoryStatus[keyof typeof InventoryStatus]; reservedByUserId?: Types.ObjectId;
  reservedOrderId?: Types.ObjectId; reservedAt?: Date; reservationExpiresAt?: Date;
  soldToUserId?: Types.ObjectId; soldOrderId?: Types.ObjectId; soldAt?: Date;
  importBatchId?: Types.ObjectId; createdBy: Types.ObjectId; updatedBy?: Types.ObjectId; internalNote?: string;
  createdAt: Date; updatedAt: Date; deletedAt: Date | null;
}
export type InventoryItemDocument = HydratedDocument<InventoryItem>;
export const InventoryItemSchema = new Schema<InventoryItem>({
  productId: objectId('Product', true), encryptedPayload: { type: String, required: true, select: false, minlength: 20 },
  maskedPreview: metadata, payloadHash: { type: String, required: true, select: false, match: /^[a-f0-9]{64}$/ },
  status: { type: String, enum: Object.values(InventoryStatus), required: true, default: InventoryStatus.AVAILABLE },
  reservedByUserId: objectId('User'), reservedOrderId: objectId('Order'), reservedAt: Date, reservationExpiresAt: Date,
  soldToUserId: objectId('User'), soldOrderId: objectId('Order'), soldAt: Date, importBatchId: objectId('ImportBatch'),
  createdBy: objectId('Admin', true), updatedBy: objectId('Admin'),
  internalNote: { type: String, maxlength: 2_000, select: false }, deletedAt: softDelete,
}, baseSchemaOptions);
InventoryItemSchema.index({ productId: 1, status: 1, createdAt: 1 });
InventoryItemSchema.index({ reservationExpiresAt: 1 }, { partialFilterExpression: { status: InventoryStatus.RESERVED } });
InventoryItemSchema.index({ soldOrderId: 1 }, { sparse: true });
InventoryItemSchema.index({ soldToUserId: 1, soldAt: -1 }, { sparse: true });
InventoryItemSchema.index({ productId: 1, payloadHash: 1 }, { unique: true, partialFilterExpression: { deletedAt: null } });
InventoryItemSchema.index({ createdAt: -1 });
InventoryItemSchema.index({ importBatchId: 1, createdAt: 1 }, { sparse: true });
export const InventoryItemModel: Model<InventoryItem> = (models.InventoryItem as Model<InventoryItem> | undefined) ?? model<InventoryItem>('InventoryItem', InventoryItemSchema, 'inventory_items');
