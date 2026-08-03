import { Schema, model, models } from 'mongoose';
import type { HydratedDocument, Types, Model } from 'mongoose';
import { PaymentRequestStatus } from '@store/shared';
import { baseSchemaOptions, metadata, objectId, softDelete } from './common';

export interface PaymentRequest {
  requestCode: string; userId: Types.ObjectId; amount: number; provider: string; providerReference?: string;
  status: typeof PaymentRequestStatus[keyof typeof PaymentRequestStatus]; proofUrls: string[];
  reviewedBy?: Types.ObjectId; reviewedAt?: Date; rejectionReason?: string; walletTransactionId?: Types.ObjectId;
  idempotencyKey: string; metadata: Record<string, unknown>; createdAt: Date; updatedAt: Date; deletedAt: Date | null;
}
export type PaymentRequestDocument = HydratedDocument<PaymentRequest>;
export const PaymentRequestSchema = new Schema<PaymentRequest>({
  requestCode: { type: String, required: true, uppercase: true, trim: true }, userId: objectId('User', true),
  amount: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  provider: { type: String, required: true, trim: true, maxlength: 50 },
  providerReference: { type: String, trim: true, maxlength: 200 },
  status: { type: String, required: true, enum: Object.values(PaymentRequestStatus), default: PaymentRequestStatus.PENDING },
  proofUrls: [{ type: String, trim: true, maxlength: 2048 }], reviewedBy: objectId('Admin'), reviewedAt: Date,
  rejectionReason: { type: String, maxlength: 1000 }, walletTransactionId: objectId('WalletTransaction'),
  idempotencyKey: { type: String, required: true, trim: true, minlength: 8, maxlength: 160 }, metadata, deletedAt: softDelete,
}, baseSchemaOptions);
PaymentRequestSchema.index({ requestCode: 1 }, { unique: true });
PaymentRequestSchema.index({ idempotencyKey: 1 }, { unique: true });
PaymentRequestSchema.index({ provider: 1, providerReference: 1 }, { unique: true,
  partialFilterExpression: { providerReference: { $type: 'string' } } });
PaymentRequestSchema.index({ userId: 1, status: 1, createdAt: -1 });
PaymentRequestSchema.index({ status: 1, createdAt: 1 });
export const PaymentRequestModel: Model<PaymentRequest> = (models.PaymentRequest as Model<PaymentRequest> | undefined) ?? model<PaymentRequest>('PaymentRequest', PaymentRequestSchema, 'payment_requests');
