import { Schema, model, models } from 'mongoose';
import type { HydratedDocument, Types, Model } from 'mongoose';
import { baseSchemaOptions, metadata, objectId } from './common';

export const NotificationChannel = { TELEGRAM: 'TELEGRAM', ADMIN_WEB: 'ADMIN_WEB', EMAIL: 'EMAIL' } as const;
export const NotificationStatus = { PENDING: 'PENDING', SENT: 'SENT', FAILED: 'FAILED', READ: 'READ' } as const;
export interface Notification {
  userId?: Types.ObjectId; adminId?: Types.ObjectId; channel: typeof NotificationChannel[keyof typeof NotificationChannel];
  title: string; body: string; status: typeof NotificationStatus[keyof typeof NotificationStatus];
  referenceType?: string; referenceId?: Types.ObjectId; sentAt?: Date; readAt?: Date; errorCode?: string;
  metadata: Record<string, unknown>; createdAt: Date; updatedAt: Date;
}
export const NotificationSchema = new Schema<Notification>({
  userId: objectId('User'), adminId: objectId('Admin'),
  channel: { type: String, enum: Object.values(NotificationChannel), required: true },
  title: { type: String, required: true, trim: true, maxlength: 200 }, body: { type: String, required: true, maxlength: 5000 },
  status: { type: String, enum: Object.values(NotificationStatus), default: NotificationStatus.PENDING },
  referenceType: { type: String, maxlength: 80 }, referenceId: objectId(), sentAt: Date, readAt: Date,
  errorCode: { type: String, maxlength: 100 }, metadata,
}, baseSchemaOptions);
NotificationSchema.index({ userId: 1, status: 1, createdAt: -1 });
NotificationSchema.index({ adminId: 1, status: 1, createdAt: -1 });
NotificationSchema.index({ status: 1, createdAt: 1 });
NotificationSchema.index({ referenceType: 1, referenceId: 1 });
export const NotificationModel: Model<Notification> = (models.Notification as Model<Notification> | undefined) ?? model<Notification>('Notification', NotificationSchema, 'notifications');
