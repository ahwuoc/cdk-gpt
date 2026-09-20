import { Schema, model, models, type Model, type Types } from 'mongoose';
import { baseSchemaOptions, objectId } from './common';

export interface Coupon {
  code: string; type: 'PERCENT' | 'FIXED'; value: number; minSubtotal: number;
  maxDiscount?: number | null; startsAt?: Date | null; endsAt?: Date | null;
  usageLimit?: number | null; perUserLimit: number; usageCount: number;
  productIds: Types.ObjectId[]; active: boolean; createdBy: Types.ObjectId; updatedBy: Types.ObjectId;
  createdAt: Date; updatedAt: Date;
}
const money = { type: Number, min: 0, validate: Number.isSafeInteger };
const optionalPositiveInteger = { type: Number, min: 1, validate: (value: unknown) => value == null || Number.isSafeInteger(value) };
export const CouponSchema = new Schema<Coupon>({
  code: { type: String, required: true, uppercase: true, trim: true, match: /^[A-Z0-9][A-Z0-9_-]{2,39}$/ },
  type: { type: String, required: true, enum: ['PERCENT', 'FIXED'] },
  value: { ...money, required: true, min: 1 }, minSubtotal: { ...money, required: true, default: 0 },
  maxDiscount: optionalPositiveInteger, startsAt: Date, endsAt: Date,
  usageLimit: optionalPositiveInteger, perUserLimit: { ...money, required: true, min: 1, default: 1 },
  usageCount: { ...money, required: true, default: 0 },
  productIds: { type: [Schema.Types.ObjectId], ref: 'Product', default: [] },
  active: { type: Boolean, required: true, default: true },
  createdBy: objectId('Admin', true), updatedBy: objectId('Admin', true),
}, baseSchemaOptions);
CouponSchema.index({ code: 1 }, { unique: true });
CouponSchema.index({ active: 1, createdAt: -1 });
export const CouponModel: Model<Coupon> = (models.Coupon as Model<Coupon> | undefined) ?? model<Coupon>('Coupon', CouponSchema, 'coupons');

export interface CouponRedemption {
  couponId: Types.ObjectId; userId: Types.ObjectId; productId: Types.ObjectId;
  checkoutKey: string; quantity: number; subtotal: number; discountAmount: number; totalAmount: number;
  createdAt: Date; updatedAt: Date;
}
export const CouponRedemptionSchema = new Schema<CouponRedemption>({
  couponId: objectId('Coupon', true), userId: objectId('User', true), productId: objectId('Product', true),
  checkoutKey: { type: String, required: true, maxlength: 128 },
  quantity: { ...money, required: true, min: 1 }, subtotal: { ...money, required: true },
  discountAmount: { ...money, required: true }, totalAmount: { ...money, required: true },
}, baseSchemaOptions);
CouponRedemptionSchema.index({ checkoutKey: 1 }, { unique: true });
CouponRedemptionSchema.index({ couponId: 1, userId: 1 });
export const CouponRedemptionModel: Model<CouponRedemption> = (models.CouponRedemption as Model<CouponRedemption> | undefined)
  ?? model<CouponRedemption>('CouponRedemption', CouponRedemptionSchema, 'coupon_redemptions');
