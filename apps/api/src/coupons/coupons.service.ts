import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Types, type ClientSession, type Connection, type Model } from 'mongoose';
import type { AuditLog, Product, Coupon, CouponRedemption } from '@store/database';
import { isMongoDuplicateKey } from '@store/shared';
import type { BotCouponQueryDto, CouponQueryDto, CreateCouponDto, UpdateCouponDto } from './coupons.dto';

export class CouponUnavailableError extends BadRequestException {
  readonly code = 'COUPON_UNAVAILABLE';
}
export const normalizeCouponCode = (code?: string) => code?.trim().toUpperCase() || undefined;
export interface CouponPricingInput { userId: Types.ObjectId; productId: Types.ObjectId; subtotal: number; couponCode?: string }
export interface CouponPricing { subtotal: number; discountAmount: number; totalAmount: number; couponCode?: string; couponId?: Types.ObjectId }

@Injectable()
export class CouponsService {
  constructor(@InjectConnection() private readonly connection: Connection,
    @InjectModel('Coupon') private readonly coupons: Model<Coupon>,
    @InjectModel('CouponRedemption') private readonly redemptions: Model<CouponRedemption>,
    @InjectModel('Product') private readonly products: Model<Product>,
    @InjectModel('AuditLog') private readonly audits: Model<AuditLog>) {}

  async list(query: CouponQueryDto) {
    const filter: Record<string, unknown> = {};
    if (query.active !== undefined) filter.active = query.active === 'true';
    if (query.q?.trim()) filter.code = { $regex: query.q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    const page = query.page ?? 1, limit = query.limit ?? 20;
    const [items, total] = await Promise.all([this.coupons.find(filter).sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit).limit(limit).lean(), this.coupons.countDocuments(filter)]);
    return { items, page, limit, total, totalPages: Math.ceil(total / limit) };
  }

  /**
   * List coupons the bot can show to one user. User redemption filtering is
   * intentionally done before slicing the page, otherwise a full coupon can
   * hide a later coupon that is still usable by this user.
   */
  async listAvailable(query: BotCouponQueryDto) {
    const now = new Date();
    const storedCoupons = await this.coupons.find({
      active: true,
      $and: [
        { $or: [{ startsAt: null }, { startsAt: { $exists: false } }, { startsAt: { $lte: now } }] },
        { $or: [{ endsAt: null }, { endsAt: { $exists: false } }, { endsAt: { $gt: now } }] },
        { $or: [{ usageLimit: null }, { usageLimit: { $exists: false } }, { $expr: { $lt: ['$usageCount', '$usageLimit'] } }] },
      ],
    }).sort({ createdAt: -1, _id: -1 }).lean();
    const candidates = storedCoupons.filter((coupon) =>
      coupon.active && (!coupon.startsAt || coupon.startsAt.getTime() <= now.getTime()) &&
      (!coupon.endsAt || coupon.endsAt.getTime() > now.getTime()) &&
      (coupon.usageLimit == null || coupon.usageCount < coupon.usageLimit));
    if (!candidates.length) return { items: [], page: query.page, limit: query.limit, total: 0, totalPages: 0 };

    const userId = this.objectId(query.userId);
    const couponIds = candidates.map((coupon) => coupon._id);
    const redemptionCounts = await this.redemptions.aggregate<{ _id: Types.ObjectId; count: number }>([
      { $match: { couponId: { $in: couponIds }, userId } },
      { $group: { _id: '$couponId', count: { $sum: 1 } } },
    ]);
    const usedByCoupon = new Map(redemptionCounts.map((row) => [row._id.toString(), row.count]));
    const available = candidates.filter((coupon) => {
      const perUserLimit = coupon.perUserLimit ?? 1;
      return (usedByCoupon.get(coupon._id.toString()) ?? 0) < perUserLimit;
    });
    const total = available.length;
    const pageItems = available.slice((query.page - 1) * query.limit, query.page * query.limit);
    const scopedProductIds = [...new Set(pageItems.flatMap((coupon) => (coupon.productIds ?? []).map((id) => id.toString())))];
    const productRows = scopedProductIds.length
      ? await this.products.find({ _id: { $in: scopedProductIds }, deletedAt: null }).select('_id name').lean()
      : [];
    const productNames = new Map(productRows.map((product) => [product._id.toString(), { id: product._id.toString(), name: product.name }]));

    return {
      items: pageItems.map((coupon) => {
        const used = usedByCoupon.get(coupon._id.toString()) ?? 0;
        const remainingUses = coupon.usageLimit == null ? null : Math.max(0, coupon.usageLimit - coupon.usageCount);
        const productIds = (coupon.productIds ?? []).map((id) => id.toString());
        return {
          code: coupon.code,
          type: coupon.type,
          value: coupon.value,
          minSubtotal: coupon.minSubtotal,
          maxDiscount: coupon.maxDiscount ?? null,
          endsAt: coupon.endsAt ?? null,
          remainingUses,
          remainingUserUses: Math.max(0, (coupon.perUserLimit ?? 1) - used),
          productIds,
          products: productIds.flatMap((id) => {
            const product = productNames.get(id);
            return product ? [product] : [];
          }),
        };
      }),
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    };
  }

  async create(input: CreateCouponDto, adminId: string, requestId?: string) {
    const normalized = this.normalize(input);
    const code = normalizeCouponCode(input.code);
    if (!code || !/^[A-Z0-9][A-Z0-9_-]{2,39}$/.test(code)) throw new BadRequestException('Mã giảm giá phải có 3–40 ký tự A–Z, 0–9, _ hoặc -');
    this.validate({ ...normalized, type: input.type, value: input.value });
    const actor = this.objectId(adminId);
    const session = await this.connection.startSession();
    try {
      return await session.withTransaction(async () => {
        await this.validateProducts(normalized.productIds ?? [], session);
        const [coupon] = await this.coupons.create([{ ...normalized, code, usageCount: 0,
          createdBy: actor, updatedBy: actor }], { session });
        await this.audit(actor, coupon!._id, 'COUPON_CREATED', requestId, { code, ...normalized }, session);
        return coupon!;
      });
    } catch (error) {
      if (isMongoDuplicateKey(error)) throw new ConflictException('Mã giảm giá đã tồn tại');
      throw error;
    } finally { await session.endSession(); }
  }

  async update(id: string, input: UpdateCouponDto, adminId: string, requestId?: string) {
    const couponId = this.objectId(id), actor = this.objectId(adminId), normalized = this.normalize(input);
    const session = await this.connection.startSession();
    try {
      return await session.withTransaction(async () => {
        const coupon = await this.coupons.findById(couponId).session(session);
        if (!coupon) throw new NotFoundException('Không tìm thấy mã giảm giá');
        this.validate({ ...coupon.toObject(), ...normalized });
        if (normalized.productIds) await this.validateProducts(normalized.productIds, session);
        coupon.set({ ...normalized, updatedBy: actor });
        await coupon.save({ session });
        await this.audit(actor, couponId, 'COUPON_UPDATED', requestId, normalized, session);
        return coupon;
      });
    } finally { await session.endSession(); }
  }

  async price(input: CouponPricingInput, session?: ClientSession): Promise<CouponPricing> {
    const code = normalizeCouponCode(input.couponCode);
    const base = { subtotal: input.subtotal, discountAmount: 0, totalAmount: input.subtotal };
    if (!code) return base;
    const coupon = await this.coupons.findOne({ code }).session(session ?? null);
    const now = Date.now();
    if (!coupon || !coupon.active || (coupon.startsAt && coupon.startsAt.getTime() > now) ||
      (coupon.endsAt && coupon.endsAt.getTime() <= now)) throw new CouponUnavailableError('Mã giảm giá không tồn tại, chưa mở hoặc đã hết hạn');
    if (coupon.productIds.length && !coupon.productIds.some((id) => id.equals(input.productId))) {
      throw new CouponUnavailableError('Mã giảm giá không áp dụng cho sản phẩm này');
    }
    if (input.subtotal < coupon.minSubtotal) throw new CouponUnavailableError(`Đơn hàng tối thiểu ${coupon.minSubtotal}đ để dùng mã này`);
    if (coupon.usageLimit != null && coupon.usageCount >= coupon.usageLimit) throw new CouponUnavailableError('Mã giảm giá đã hết lượt sử dụng');
    if (await this.redemptions.countDocuments({ couponId: coupon._id, userId: input.userId }).session(session ?? null) >= coupon.perUserLimit) {
      throw new CouponUnavailableError('Bạn đã dùng hết lượt của mã giảm giá này');
    }
    // Integer arithmetic avoids rounded-up discounts at large safe monetary values.
    const raw = coupon.type === 'PERCENT' ? Number(BigInt(input.subtotal) * BigInt(coupon.value) / BigInt(100)) : coupon.value;
    const discountAmount = Math.min(input.subtotal, raw, coupon.maxDiscount ?? Number.MAX_SAFE_INTEGER);
    if (discountAmount < 1) throw new CouponUnavailableError('Giá trị đơn chưa đủ để áp dụng mã giảm giá này');
    return { subtotal: input.subtotal, discountAmount, totalAmount: input.subtotal - discountAmount,
      couponCode: coupon.code, couponId: coupon._id };
  }

  /** The coupon write serializes all redemptions, including per-user counts.
   * A concurrent edit/redemption conflicts with the caller's snapshot and is
   * retried together with stock, orders and wallet; unpaid quotes never call it. */
  async redeem(input: CouponPricingInput & { quantity: number; checkoutKey: string; expectedTotalAmount?: number }, session: ClientSession) {
    const pricing = await this.price(input, session);
    if (input.expectedTotalAmount !== undefined && input.expectedTotalAmount !== pricing.totalAmount) {
      throw new CouponUnavailableError('Giá sau giảm đã thay đổi; vui lòng xác nhận lại đơn hàng');
    }
    if (!pricing.couponId) return pricing;
    await this.coupons.updateOne({ _id: pricing.couponId }, { $inc: { usageCount: 1 } }, { session });
    await this.redemptions.create([{ couponId: pricing.couponId, userId: input.userId, productId: input.productId,
      checkoutKey: input.checkoutKey, quantity: input.quantity, subtotal: pricing.subtotal,
      discountAmount: pricing.discountAmount, totalAmount: pricing.totalAmount }], { session });
    return pricing;
  }

  private normalize(input: UpdateCouponDto) {
    const output: Partial<Coupon> = {};
    for (const field of ['type', 'value', 'minSubtotal', 'perUserLimit', 'active', 'productIds'] as const) {
      if (input[field] === null) throw new BadRequestException(`Giá trị ${field} không được để trống`);
    }
    if (input.active !== undefined && typeof input.active !== 'boolean') throw new BadRequestException('Trạng thái mã giảm giá không hợp lệ');
    if (input.productIds !== undefined && (!Array.isArray(input.productIds) || input.productIds.length > 100)) {
      throw new BadRequestException('Danh sách sản phẩm không hợp lệ');
    }
    for (const field of ['type', 'value', 'minSubtotal', 'maxDiscount', 'usageLimit', 'perUserLimit', 'active'] as const) {
      if (input[field] !== undefined) Object.assign(output, { [field]: input[field] });
    }
    for (const field of ['startsAt', 'endsAt'] as const) {
      if (input[field] !== undefined) output[field] = input[field] === null ? null : new Date(input[field]);
    }
    if (input.productIds !== undefined) output.productIds = input.productIds.map((id) => this.objectId(id));
    return output;
  }
  private validate(input: Partial<Coupon>) {
    if (!['PERCENT', 'FIXED'].includes(input.type ?? '') || !Number.isSafeInteger(input.value) || (input.value ?? 0) < 1 ||
      (input.type === 'PERCENT' && input.value! > 100)) throw new BadRequestException('Phần trăm phải từ 1–100; số tiền giảm phải là số nguyên dương');
    for (const field of ['minSubtotal', 'maxDiscount', 'usageLimit', 'perUserLimit'] as const) {
      if (input[field] != null && (!Number.isSafeInteger(input[field]) || input[field]! < (field === 'minSubtotal' ? 0 : 1))) {
        throw new BadRequestException(`Giá trị ${field} không hợp lệ`);
      }
    }
    if ((input.startsAt && !Number.isFinite(input.startsAt.getTime())) || (input.endsAt && !Number.isFinite(input.endsAt.getTime())) ||
      (input.startsAt && input.endsAt && input.startsAt >= input.endsAt)) throw new BadRequestException('Khoảng thời gian áp dụng không hợp lệ');
    if (input.usageLimit != null && input.usageLimit < (input.usageCount ?? 0)) throw new BadRequestException('Giới hạn không thể nhỏ hơn số lượt đã sử dụng');
  }
  private async validateProducts(ids: Types.ObjectId[], session: ClientSession) {
    if (new Set(ids.map(String)).size !== ids.length || await this.products.countDocuments({ _id: { $in: ids }, deletedAt: null }).session(session) !== ids.length) {
      throw new BadRequestException('Danh sách sản phẩm không hợp lệ');
    }
  }
  private objectId(id: string) {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('ID không hợp lệ');
    return new Types.ObjectId(id);
  }
  private audit(actor: Types.ObjectId, id: Types.ObjectId, action: string, requestId: string | undefined, changes: object, session: ClientSession) {
    return this.audits.create([{ actorType: 'ADMIN', actorId: actor, action, resourceType: 'Coupon',
      resourceId: id, requestId, changes, metadata: {} }], { session });
  }
}
