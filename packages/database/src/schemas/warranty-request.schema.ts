import { Schema, model, models } from 'mongoose';
import type { HydratedDocument, Types, Model } from 'mongoose';
import { baseSchemaOptions, metadata, objectId } from './common';
import { ComplaintCategory, type ComplaintCategoryValue } from '@store/shared';

export const WarrantyStatus = { PENDING: 'PENDING', REVIEWING: 'REVIEWING', APPROVED: 'APPROVED', REJECTED: 'REJECTED',
  RESOLVED: 'RESOLVED', REPLACED: 'REPLACED', REFUNDED: 'REFUNDED' } as const;
export interface WarrantyRequest {
  requestCode: string; userId: Types.ObjectId; orderId: Types.ObjectId; inventoryItemId: Types.ObjectId;
  category: ComplaintCategoryValue; reason: string; evidenceUrls: string[]; status: typeof WarrantyStatus[keyof typeof WarrantyStatus];
  reviewedBy?: Types.ObjectId; reviewedAt?: Date; resolutionNote?: string; replacementInventoryItemId?: Types.ObjectId;
  metadata: Record<string, unknown>; createdAt: Date; updatedAt: Date;
}
export const WarrantyRequestSchema = new Schema<WarrantyRequest>({
  requestCode: { type: String, required: true, uppercase: true }, userId: objectId('User', true), orderId: objectId('Order', true),
  inventoryItemId: objectId('InventoryItem', true),
  category: { type: String, enum: Object.values(ComplaintCategory), required: true, default: ComplaintCategory.OTHER },
  reason: { type: String, required: true, maxlength: 5000 },
  evidenceUrls: [{ type: String, maxlength: 2048 }], status: { type: String, enum: Object.values(WarrantyStatus), default: WarrantyStatus.PENDING },
  reviewedBy: objectId('Admin'), reviewedAt: Date, resolutionNote: { type: String, maxlength: 5000 },
  replacementInventoryItemId: objectId('InventoryItem'), metadata,
}, baseSchemaOptions);
WarrantyRequestSchema.index({ requestCode: 1 }, { unique: true });
WarrantyRequestSchema.index({ orderId: 1 }, { unique: true, partialFilterExpression: { status: { $in: [WarrantyStatus.PENDING, WarrantyStatus.REVIEWING, WarrantyStatus.APPROVED] } } });
WarrantyRequestSchema.index({ userId: 1, createdAt: -1 });
WarrantyRequestSchema.index({ status: 1, createdAt: 1 });
WarrantyRequestSchema.index({ category: 1, status: 1, createdAt: -1 });
export const WarrantyRequestModel: Model<WarrantyRequest> = (models.WarrantyRequest as Model<WarrantyRequest> | undefined) ?? model<WarrantyRequest>('WarrantyRequest', WarrantyRequestSchema, 'warranty_requests');
