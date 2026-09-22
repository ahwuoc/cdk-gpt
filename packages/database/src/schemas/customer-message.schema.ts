import { createHash } from 'node:crypto';
import { Schema, Types, model, models } from 'mongoose';
import type { HydratedDocument, Model } from 'mongoose';
import { baseSchemaOptions, objectId } from './common';

export const CustomerConversationType = { DIRECT: 'DIRECT', COMPLAINT: 'COMPLAINT' } as const;
export const CustomerMessageDirection = { USER_TO_ADMIN: 'USER_TO_ADMIN', ADMIN_TO_USER: 'ADMIN_TO_USER' } as const;
export const CustomerMessageStatus = {
  RECEIVED: 'RECEIVED', PENDING: 'PENDING', SENDING: 'SENDING', SENT: 'SENT', FAILED: 'FAILED',
} as const;
export const CustomerMessageAudience = { DIRECT: 'DIRECT', BROADCAST: 'BROADCAST' } as const;
const DELIVERY_CLAIM_TIMEOUT_MS = 5 * 60_000;

export function claimableCustomerMessageDelivery(now = new Date()) {
  return { $or: [
    { status: { $in: [CustomerMessageStatus.PENDING, CustomerMessageStatus.FAILED] } },
    { status: CustomerMessageStatus.SENDING,
      updatedAt: { $lt: new Date(now.getTime() - DELIVERY_CLAIM_TIMEOUT_MS) } },
  ] };
}

/** Mongo's built-in unique `_id` keeps delivery idempotent even before a new deployment's indexes are migrated. */
export function customerMessageId(deduplicationKey: string) {
  return new Types.ObjectId(createHash('sha256').update(deduplicationKey).digest('hex').slice(0, 24));
}

export interface CustomerMessage {
  userId: Types.ObjectId;
  adminId?: Types.ObjectId;
  warrantyRequestId?: Types.ObjectId;
  campaignId?: Types.ObjectId;
  conversationType: typeof CustomerConversationType[keyof typeof CustomerConversationType];
  direction: typeof CustomerMessageDirection[keyof typeof CustomerMessageDirection];
  audience: typeof CustomerMessageAudience[keyof typeof CustomerMessageAudience];
  body: string;
  status: typeof CustomerMessageStatus[keyof typeof CustomerMessageStatus];
  telegramMessageId?: number;
  errorCode?: string;
  deduplicationKey?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type CustomerMessageDocument = HydratedDocument<CustomerMessage>;

export const CustomerMessageSchema = new Schema<CustomerMessage>({
  userId: objectId('User', true), adminId: objectId('Admin'), warrantyRequestId: objectId('WarrantyRequest'),
  campaignId: objectId('Notification'),
  conversationType: { type: String, enum: Object.values(CustomerConversationType), required: true },
  direction: { type: String, enum: Object.values(CustomerMessageDirection), required: true },
  audience: { type: String, enum: Object.values(CustomerMessageAudience), required: true, default: CustomerMessageAudience.DIRECT },
  body: { type: String, required: true, trim: true, minlength: 1, maxlength: 4_000 },
  status: { type: String, enum: Object.values(CustomerMessageStatus), required: true },
  telegramMessageId: { type: Number, min: 1, validate: Number.isSafeInteger }, errorCode: { type: String, maxlength: 100 },
  deduplicationKey: { type: String, trim: true, minlength: 8, maxlength: 200 },
}, baseSchemaOptions);

CustomerMessageSchema.index({ userId: 1, conversationType: 1, createdAt: -1 });
CustomerMessageSchema.index({ conversationType: 1, createdAt: -1, _id: -1, userId: 1, audience: 1 },
  { name: 'messages_conversation_latest' });
CustomerMessageSchema.index({ userId: 1, conversationType: 1, createdAt: -1, _id: -1, audience: 1 },
  { name: 'messages_user_latest' });
CustomerMessageSchema.index({ warrantyRequestId: 1, createdAt: 1 });
CustomerMessageSchema.index({ campaignId: 1, status: 1 });
CustomerMessageSchema.index({ deduplicationKey: 1 }, { unique: true, sparse: true });

export const CustomerMessageModel: Model<CustomerMessage> =
  (models.CustomerMessage as Model<CustomerMessage> | undefined)
  ?? model<CustomerMessage>('CustomerMessage', CustomerMessageSchema, 'customer_messages');
