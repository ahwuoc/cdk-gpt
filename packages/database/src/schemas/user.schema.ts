import { Schema, model, models } from 'mongoose';
import type { HydratedDocument, Types, Model } from 'mongoose';
import { UserStatus } from '@store/shared';
import { baseSchemaOptions, objectId, softDelete } from './common';

export interface User {
  telegramId: string; username?: string; displayName?: string;
  language?: 'vi' | 'en';
  status: typeof UserStatus[keyof typeof UserStatus]; walletBalance: number;
  referralCode: string; referredByUserId?: Types.ObjectId; purchaseCount: number; checkoutLockVersion: number;
  createdAt: Date; updatedAt: Date; deletedAt: Date | null;
}
export type UserDocument = HydratedDocument<User>;
export const UserSchema = new Schema<User>({
  telegramId: { type: String, required: true, trim: true, match: /^-?\d+$/ },
  username: { type: String, trim: true, maxlength: 64 }, displayName: { type: String, trim: true, maxlength: 128 },
  language: { type: String, enum: ['vi', 'en'], default: 'vi' },
  status: { type: String, enum: Object.values(UserStatus), default: UserStatus.ACTIVE, required: true },
  walletBalance: { type: Number, required: true, default: 0, min: 0, validate: Number.isSafeInteger },
  referralCode: { type: String, required: true, uppercase: true, trim: true, minlength: 6, maxlength: 32 },
  referredByUserId: objectId('User'), purchaseCount: { type: Number, default: 0, min: 0, validate: Number.isSafeInteger },
  checkoutLockVersion: { type: Number, default: 0, min: 0, validate: Number.isSafeInteger, select: false },
  deletedAt: softDelete,
}, baseSchemaOptions);
UserSchema.index({ telegramId: 1 }, { unique: true, partialFilterExpression: { deletedAt: null } });
UserSchema.index({ referralCode: 1 }, { unique: true, partialFilterExpression: { deletedAt: null } });
UserSchema.index({ referredByUserId: 1, createdAt: -1 });
UserSchema.index({ status: 1, createdAt: -1 });
UserSchema.index({ status: 1, deletedAt: 1, _id: 1 }, { name: 'broadcast_active_cursor' });
UserSchema.index({ deletedAt: 1, createdAt: -1, _id: -1 }, { name: 'admin_history_active_created_id' });
export const UserModel: Model<User> = (models.User as Model<User> | undefined) ?? model<User>('User', UserSchema, 'users');
