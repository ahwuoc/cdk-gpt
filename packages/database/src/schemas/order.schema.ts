import { Schema, model, models } from 'mongoose';
import type { HydratedDocument, Types, Model } from 'mongoose';
import { DeliveryStatus, OrderStatus } from '@store/shared';
import { baseSchemaOptions, metadata, objectId } from './common';

export const PaymentMethod = { WALLET: 'WALLET', MANUAL: 'MANUAL', BANK_TRANSFER: 'BANK_TRANSFER' } as const;
export interface Order {
  orderCode: string; userId: Types.ObjectId; productId: Types.ObjectId; inventoryItemId: Types.ObjectId;
  quantity: number; unitPrice: number; totalAmount: number; status: typeof OrderStatus[keyof typeof OrderStatus];
  grossAmount?: number; discountAmount?: number; couponCode?: string; couponId?: Types.ObjectId;
  paymentMethod: typeof PaymentMethod[keyof typeof PaymentMethod]; walletTransactionId?: Types.ObjectId;
  deliveryStatus: typeof DeliveryStatus[keyof typeof DeliveryStatus]; deliveredAt?: Date; failureReason?: string;
  idempotencyKey?: string; metadata: Record<string, unknown>; createdAt: Date; updatedAt: Date;
}
export type OrderDocument = HydratedDocument<Order>;
export const OrderSchema = new Schema<Order>({
  orderCode: { type: String, required: true, uppercase: true, trim: true, match: /^ORD-[A-Z0-9-]{8,40}$/ },
  userId: objectId('User', true), productId: objectId('Product', true), inventoryItemId: objectId('InventoryItem', true),
  quantity: { type: Number, required: true, min: 1, max: 1, validate: Number.isSafeInteger },
  unitPrice: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  totalAmount: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  grossAmount: { type: Number, min: 0, validate: Number.isSafeInteger },
  discountAmount: { type: Number, min: 0, validate: Number.isSafeInteger },
  couponCode: { type: String, maxlength: 40 }, couponId: objectId('Coupon'),
  status: { type: String, required: true, enum: Object.values(OrderStatus), default: OrderStatus.PENDING_DELIVERY },
  paymentMethod: { type: String, required: true, enum: Object.values(PaymentMethod), default: PaymentMethod.WALLET },
  walletTransactionId: objectId('WalletTransaction'),
  deliveryStatus: { type: String, required: true, enum: Object.values(DeliveryStatus), default: DeliveryStatus.PENDING },
  deliveredAt: Date, failureReason: { type: String, maxlength: 2_000 },
  idempotencyKey: { type: String, trim: true, minlength: 8, maxlength: 128 }, metadata,
}, baseSchemaOptions);
OrderSchema.index({ orderCode: 1 }, { unique: true });
OrderSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });
OrderSchema.index({ userId: 1, createdAt: -1 });
OrderSchema.index({ productId: 1, status: 1, createdAt: -1 });
OrderSchema.index({ inventoryItemId: 1 }, { unique: true });
OrderSchema.index({ deliveryStatus: 1, updatedAt: 1 });
OrderSchema.index({ status: 1, deliveryStatus: 1, 'metadata.deliveryDispatchAttemptAt': 1, createdAt: 1 },
  { name: 'pending_delivery_dispatch_attempt' });
export const OrderModel: Model<Order> = (models.Order as Model<Order> | undefined) ?? model<Order>('Order', OrderSchema, 'orders');
