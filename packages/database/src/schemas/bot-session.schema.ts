import { Schema, model, models } from 'mongoose';
import type { HydratedDocument, Model } from 'mongoose';
import { baseSchemaOptions, metadata } from './common';

/**
 * Short-lived Telegram conversation state. This deliberately lives in MongoDB
 * rather than a process Map: webhook invocations can land on different Vercel
 * instances and a cold start must not make "Nhập số lượng khác" disappear.
 */
export const BotSessionKind = {
  PURCHASE_QUANTITY: 'PURCHASE_QUANTITY',
  DEPOSIT_AMOUNT: 'DEPOSIT_AMOUNT',
} as const;

export interface BotSession {
  chatId: string;
  telegramUserId: string;
  kind: typeof BotSessionKind[keyof typeof BotSessionKind];
  data: Record<string, unknown>;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type BotSessionDocument = HydratedDocument<BotSession>;

export const BotSessionSchema = new Schema<BotSession>({
  chatId: { type: String, required: true, trim: true, match: /^-?\d+$/, maxlength: 32 },
  telegramUserId: { type: String, required: true, trim: true, match: /^\d+$/, maxlength: 32 },
  kind: { type: String, required: true, enum: Object.values(BotSessionKind) },
  data: metadata,
  expiresAt: { type: Date, required: true },
}, baseSchemaOptions);

// Exactly one pending input is allowed per Telegram user within a chat. The
// TTL index is cleanup only; reads still validate expiry, so it is safe even
// though Mongo's TTL monitor runs asynchronously.
BotSessionSchema.index({ chatId: 1, telegramUserId: 1 }, { unique: true });
BotSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const BotSessionModel: Model<BotSession> = (models.BotSession as Model<BotSession> | undefined)
  ?? model<BotSession>('BotSession', BotSessionSchema, 'bot_sessions');
