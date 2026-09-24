import 'reflect-metadata';
import { expect, mock, test } from 'bun:test';
import { Types, type Model } from 'mongoose';
import type { AuditLog, Coupon, CouponRedemption, Product } from '@store/database';
import { BotCouponQueryDto } from '../apps/api/src/coupons/coupons.dto';
import { CouponsService } from '../apps/api/src/coupons/coupons.service';

test('available coupons filter user exhaustion before pagination and scope product names to the page', async () => {
  const exhaustedId = new Types.ObjectId();
  const availableId = new Types.ObjectId();
  const hiddenId = new Types.ObjectId();
  const productId = new Types.ObjectId();
  const userId = new Types.ObjectId();
  const now = Date.now();
  const candidates = [
    { _id: exhaustedId, code: 'USED', type: 'FIXED', value: 5_000, minSubtotal: 0, maxDiscount: null,
      endsAt: new Date(now + 60_000), usageLimit: 20, usageCount: 1, perUserLimit: 1, productIds: [], active: true,
      createdAt: new Date(now + 2_000) },
    { _id: availableId, code: 'GOOD', type: 'PERCENT', value: 10, minSubtotal: 50_000, perUserLimit: 2,
      usageLimit: 3, usageCount: 1, productIds: [productId], active: true, createdAt: new Date(now + 1_000) },
    { _id: hiddenId, code: 'EXPIRED', type: 'FIXED', value: 1_000, minSubtotal: 0, perUserLimit: 1,
      usageLimit: null, usageCount: 0, endsAt: new Date(now - 1), productIds: [], active: true, createdAt: new Date(now) },
  ] as unknown as (Coupon & { _id: Types.ObjectId })[];
  const findCoupons = mock(() => ({ sort: () => ({ lean: async () => candidates }) }));
  const aggregate = mock(async () => [{ _id: exhaustedId, count: 1 }]);
  const findProducts = mock((_filter: Record<string, unknown>) => ({ select: () => ({ lean: async () => [{ _id: productId, name: 'Demo product' }] }) }));
  const service = new CouponsService({} as never, { find: findCoupons } as unknown as Model<Coupon>,
    { aggregate } as unknown as Model<CouponRedemption>, { find: findProducts } as unknown as Model<Product>,
    {} as Model<AuditLog>);
  const query = Object.assign(new BotCouponQueryDto(), { userId: userId.toString(), page: 1, limit: 1 });

  const result = await service.listAvailable(query);

  expect(result).toMatchObject({ page: 1, limit: 1, total: 1, totalPages: 1 });
  expect(result.items).toEqual([{
    code: 'GOOD', type: 'PERCENT', value: 10, minSubtotal: 50_000, maxDiscount: null,
    endsAt: null, remainingUses: 2, remainingUserUses: 2, productIds: [productId.toString()],
    products: [{ id: productId.toString(), name: 'Demo product' }],
  }]);
  expect(findProducts).toHaveBeenCalledTimes(1);
  expect(findProducts.mock.calls[0]?.[0]).toMatchObject({ deletedAt: null });
});
