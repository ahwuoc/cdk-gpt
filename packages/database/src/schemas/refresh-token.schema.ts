import { Schema, model, models } from 'mongoose';
import type { HydratedDocument, Types, Model } from 'mongoose';
import { baseSchemaOptions, objectId } from './common';

export interface RefreshToken {
  adminId: Types.ObjectId; tokenHash: string; familyId: string; expiresAt: Date;
  revokedAt?: Date; replacedByTokenHash?: string; createdByIp?: string; revokedByIp?: string;
  userAgent?: string; createdAt: Date; updatedAt: Date;
}
export const RefreshTokenSchema = new Schema<RefreshToken>({
  adminId: objectId('Admin', true), tokenHash: { type: String, required: true, select: false, match: /^[a-f0-9]{64}$/ },
  familyId: { type: String, required: true, trim: true, maxlength: 100 }, expiresAt: { type: Date, required: true },
  revokedAt: Date, replacedByTokenHash: { type: String, select: false }, createdByIp: { type: String, maxlength: 64 },
  revokedByIp: { type: String, maxlength: 64 }, userAgent: { type: String, maxlength: 1000 },
}, baseSchemaOptions);
RefreshTokenSchema.index({ tokenHash: 1 }, { unique: true });
RefreshTokenSchema.index({ adminId: 1, familyId: 1, createdAt: -1 });
RefreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
RefreshTokenSchema.index({ revokedAt: 1 }, { sparse: true });
export const RefreshTokenModel: Model<RefreshToken> = (models.RefreshToken as Model<RefreshToken> | undefined) ?? model<RefreshToken>('RefreshToken', RefreshTokenSchema, 'refresh_tokens');
