import { Schema, model, models } from 'mongoose';
import type { Model, Types } from 'mongoose';
import { objectId } from './common';

export const CustomerEventType = {
  MENU_VIEW: 'MENU_VIEW', PRODUCT_VIEW: 'PRODUCT_VIEW', CHECKOUT_START: 'CHECKOUT_START',
} as const;
export type CustomerEventTypeValue = typeof CustomerEventType[keyof typeof CustomerEventType];

/** Deliberately no free-form metadata: analytics never stores message text, credentials or payment payloads. */
export interface CustomerEvent {
  userId: Types.ObjectId;
  productId?: Types.ObjectId;
  type: CustomerEventTypeValue;
  updateId: number;
  createdAt: Date;
}
export const CustomerEventSchema = new Schema<CustomerEvent>({
  userId: objectId('User', true), productId: objectId('Product'),
  type: { type: String, enum: Object.values(CustomerEventType), required: true },
  updateId: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  createdAt: { type: Date, required: true, default: Date.now, immutable: true },
}, { timestamps: false, versionKey: false });
CustomerEventSchema.index({ createdAt: 1, type: 1, userId: 1 }, { name: 'customer_event_period_type_user' });
CustomerEventSchema.index({ userId: 1, createdAt: -1 }, { name: 'customer_event_user_period' });
export const CustomerEventModel: Model<CustomerEvent> = (models.CustomerEvent as Model<CustomerEvent> | undefined)
  ?? model<CustomerEvent>('CustomerEvent', CustomerEventSchema, 'customer_events');
