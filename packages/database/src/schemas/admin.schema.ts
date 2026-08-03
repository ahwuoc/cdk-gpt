import { Schema, model, models } from 'mongoose';
import type { HydratedDocument, Types, Model } from 'mongoose';
import { baseSchemaOptions, objectId, softDelete } from './common';

export const AdminStatus = { ACTIVE: 'ACTIVE', DISABLED: 'DISABLED', LOCKED: 'LOCKED' } as const;
export interface Admin {
  username: string; email: string; passwordHash: string; telegramId?: string; roleIds: Types.ObjectId[];
  status: typeof AdminStatus[keyof typeof AdminStatus]; tokenVersion: number; lastLoginAt?: Date;
  createdAt: Date; updatedAt: Date; deletedAt: Date | null;
}
export type AdminDocument = HydratedDocument<Admin>;
export const AdminSchema = new Schema<Admin>({
  username: { type: String, required: true, trim: true, minlength: 3, maxlength: 64 },
  email: { type: String, required: true, lowercase: true, trim: true, match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ },
  passwordHash: { type: String, required: true, select: false },
  telegramId: { type: String, trim: true },
  roleIds: [{ ...objectId('Role', true) }],
  status: { type: String, enum: Object.values(AdminStatus), default: AdminStatus.ACTIVE, required: true },
  tokenVersion: { type: Number, min: 0, default: 0 }, lastLoginAt: Date, deletedAt: softDelete,
}, baseSchemaOptions);
AdminSchema.index({ username: 1 }, { unique: true, partialFilterExpression: { deletedAt: null } });
AdminSchema.index({ email: 1 }, { unique: true, partialFilterExpression: { deletedAt: null } });
AdminSchema.index({ telegramId: 1 }, { unique: true, sparse: true });
AdminSchema.index({ status: 1, createdAt: -1 });
export const AdminModel: Model<Admin> = (models.Admin as Model<Admin> | undefined) ?? model<Admin>('Admin', AdminSchema, 'admins');
