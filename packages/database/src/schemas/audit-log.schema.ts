import { Schema, model, models } from 'mongoose';
import type { HydratedDocument, Types, Model } from 'mongoose';
import { baseSchemaOptions, metadata, objectId } from './common';

export interface AuditLog {
  actorType: 'ADMIN' | 'USER' | 'SYSTEM'; actorId?: Types.ObjectId; action: string;
  resourceType: string; resourceId?: Types.ObjectId; requestId?: string; ipAddress?: string;
  userAgent?: string; changes?: Record<string, unknown>; metadata: Record<string, unknown>; createdAt: Date; updatedAt: Date;
}
export const AuditLogSchema = new Schema<AuditLog>({
  actorType: { type: String, enum: ['ADMIN', 'USER', 'SYSTEM'], required: true }, actorId: objectId(),
  action: { type: String, required: true, trim: true, maxlength: 100 },
  resourceType: { type: String, required: true, trim: true, maxlength: 100 }, resourceId: objectId(),
  requestId: { type: String, trim: true, maxlength: 128 }, ipAddress: { type: String, maxlength: 64 },
  userAgent: { type: String, maxlength: 1000 }, changes: metadata, metadata,
}, { ...baseSchemaOptions, versionKey: false, optimisticConcurrency: false });
AuditLogSchema.index({ actorType: 1, actorId: 1, createdAt: -1 });
AuditLogSchema.index({ resourceType: 1, resourceId: 1, createdAt: -1 });
AuditLogSchema.index({ requestId: 1 }, { sparse: true });
AuditLogSchema.index({ createdAt: -1 });
AuditLogSchema.index({ createdAt: -1, _id: -1 }, { name: 'admin_history_created_id' });
export const AuditLogModel: Model<AuditLog> = (models.AuditLog as Model<AuditLog> | undefined) ?? model<AuditLog>('AuditLog', AuditLogSchema, 'audit_logs');
