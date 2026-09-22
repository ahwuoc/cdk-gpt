import { Schema, model, models } from 'mongoose';
import type { HydratedDocument, Types, Model } from 'mongoose';
import { WalletTransactionType } from '@store/shared';
import { baseSchemaOptions, metadata, objectId } from './common';

export const WalletReferenceType = { ORDER: 'ORDER', PAYMENT_REQUEST: 'PAYMENT_REQUEST', USER: 'USER', REFERRAL: 'REFERRAL', MANUAL: 'MANUAL' } as const;
export const ActorType = { USER: 'USER', ADMIN: 'ADMIN', SYSTEM: 'SYSTEM', WEBHOOK: 'WEBHOOK' } as const;
export interface WalletTransaction {
  userId: Types.ObjectId; balanceBefore: number; balanceAfter: number; amount: number;
  type: typeof WalletTransactionType[keyof typeof WalletTransactionType]; reason: string;
  referenceType: typeof WalletReferenceType[keyof typeof WalletReferenceType]; referenceId?: Types.ObjectId;
  idempotencyKey: string; actorType: typeof ActorType[keyof typeof ActorType]; actorId?: Types.ObjectId;
  metadata: Record<string, unknown>; createdAt: Date; updatedAt: Date;
}
export type WalletTransactionDocument = HydratedDocument<WalletTransaction>;
export const WalletTransactionSchema = new Schema<WalletTransaction>({
  userId: objectId('User', true),
  balanceBefore: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  balanceAfter: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  amount: { type: Number, required: true, validate: { validator: (v: number) => Number.isSafeInteger(v) && v !== 0, message: 'amount must be a non-zero integer' } },
  type: { type: String, required: true, enum: Object.values(WalletTransactionType) },
  reason: { type: String, required: true, trim: true, maxlength: 500 },
  referenceType: { type: String, required: true, enum: Object.values(WalletReferenceType) }, referenceId: objectId(),
  idempotencyKey: { type: String, required: true, trim: true, minlength: 8, maxlength: 160 },
  actorType: { type: String, required: true, enum: Object.values(ActorType) }, actorId: objectId(), metadata,
}, baseSchemaOptions);
WalletTransactionSchema.index({ idempotencyKey: 1 }, { unique: true });
WalletTransactionSchema.index({ userId: 1, createdAt: -1 });
WalletTransactionSchema.index({ createdAt: -1, _id: -1 }, { name: 'admin_history_created_id' });
WalletTransactionSchema.index({ referenceType: 1, referenceId: 1 });
WalletTransactionSchema.index({ actorType: 1, actorId: 1, createdAt: -1 });
export const WalletTransactionModel: Model<WalletTransaction> = (models.WalletTransaction as Model<WalletTransaction> | undefined) ?? model<WalletTransaction>('WalletTransaction', WalletTransactionSchema, 'wallet_transactions');
