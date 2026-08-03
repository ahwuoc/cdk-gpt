import { Schema, model, models } from 'mongoose';
import type { HydratedDocument, Types, Model } from 'mongoose';
import { baseSchemaOptions, objectId } from './common';

export const ReferralStatus = { PENDING: 'PENDING', QUALIFIED: 'QUALIFIED', REWARDED: 'REWARDED', REJECTED: 'REJECTED' } as const;
export interface Referral {
  referrerUserId: Types.ObjectId; referredUserId: Types.ObjectId; referralCode: string;
  status: typeof ReferralStatus[keyof typeof ReferralStatus]; qualifiedOrderId?: Types.ObjectId;
  commissionAmount: number; walletTransactionId?: Types.ObjectId; createdAt: Date; updatedAt: Date;
}
export const ReferralSchema = new Schema<Referral>({
  referrerUserId: objectId('User', true), referredUserId: objectId('User', true),
  referralCode: { type: String, required: true, uppercase: true, trim: true },
  status: { type: String, enum: Object.values(ReferralStatus), default: ReferralStatus.PENDING },
  qualifiedOrderId: objectId('Order'), commissionAmount: { type: Number, min: 0, default: 0, validate: Number.isSafeInteger },
  walletTransactionId: objectId('WalletTransaction'),
}, baseSchemaOptions);
ReferralSchema.index({ referredUserId: 1 }, { unique: true });
ReferralSchema.index({ referrerUserId: 1, status: 1, createdAt: -1 });
ReferralSchema.index({ qualifiedOrderId: 1 }, { unique: true, sparse: true });
export const ReferralModel: Model<Referral> = (models.Referral as Model<Referral> | undefined) ?? model<Referral>('Referral', ReferralSchema, 'referrals');
