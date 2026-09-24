import 'reflect-metadata';
import { describe, expect, mock, test } from 'bun:test';
import { ForbiddenException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { BotCouponsController, CouponsController } from '../apps/api/src/coupons/coupons.controller';
import { BotCouponQueryDto } from '../apps/api/src/coupons/coupons.dto';
import type { CouponsService } from '../apps/api/src/coupons/coupons.service';
import { PermissionsGuard } from '../apps/api/src/auth/permissions.guard';
import { PurchaseController } from '../apps/api/src/purchase/purchase.controller';
import type { PurchaseService } from '../apps/api/src/purchase/purchase.service';

describe('coupon and quote route boundaries', () => {
  test('every admin coupon operation requires products.manage', () => {
    const guard = new PermissionsGuard(new Reflector());
    for (const method of ['list', 'create', 'update'] as const) {
      const context = (permissions: string[]) => ({ getHandler: () => CouponsController.prototype[method],
        getClass: () => CouponsController, switchToHttp: () => ({ getRequest: () => ({ admin: { permissions } }) }),
      }) as unknown as ExecutionContext;
      expect(() => guard.canActivate(context(['analytics.read']))).toThrow(ForbiddenException);
      expect(guard.canActivate(context(['products.manage']))).toBe(true);
      expect(guard.canActivate(context(['*']))).toBe(true);
    }
    expect(new CouponsController({} as CouponsService)).toBeDefined();
  });

  test('quote and batch endpoints reject a missing bot credential and forward coupon and expected net total', async () => {
    const previous = process.env.BOT_API_SECRET;
    process.env.BOT_API_SECRET = 'isolated-coupon-route-secret';
    try {
      const quoteBatch = mock(async (input: object) => input);
      const purchaseBatch = mock(async (input: object) => input);
      const controller = new PurchaseController({ quoteBatch, purchaseBatch } as unknown as PurchaseService);
      const quote = { userId: '64b64b64b64b64b64b64b64b', productId: '65b65b65b65b65b65b65b65b',
        quantity: 3, expectedUnitPrice: 100, couponCode: 'SAVE10' };
      const request = { ...quote, idempotencyPrefix: 'coupon-controller-batch', expectedTotalAmount: 270 };
      expect(() => controller.quote(quote)).toThrow(UnauthorizedException);
      expect(() => controller.purchaseBatch(request, 'wrong')).toThrow(UnauthorizedException);
      await controller.quote(quote, process.env.BOT_API_SECRET);
      await controller.purchaseBatch(request, process.env.BOT_API_SECRET);
      expect(quoteBatch).toHaveBeenCalledTimes(1);
      expect(quoteBatch).toHaveBeenCalledWith(quote);
      expect(purchaseBatch).toHaveBeenCalledTimes(1);
      expect(purchaseBatch).toHaveBeenCalledWith(request);
    } finally {
      if (previous === undefined) delete process.env.BOT_API_SECRET;
      else process.env.BOT_API_SECRET = previous;
    }
  });

  test('bot coupon listing is public to the auth guard but still requires the shared bot secret', async () => {
    const previous = process.env.BOT_API_SECRET;
    process.env.BOT_API_SECRET = 'isolated-coupon-route-secret';
    try {
      const listAvailable = mock(async (query: BotCouponQueryDto) => ({ items: [], page: query.page, limit: query.limit, total: 0, totalPages: 0 }));
      const controller = new BotCouponsController({ listAvailable } as unknown as CouponsService);
      expect(Reflect.getMetadata('public-route', BotCouponsController.prototype.listAvailable)).toBe(true);
      const query = Object.assign(new BotCouponQueryDto(), { userId: '64b64b64b64b64b64b64b64b', page: 2, limit: 5 });
      expect(() => controller.listAvailable(query)).toThrow(UnauthorizedException);
      expect(() => controller.listAvailable(query, 'wrong')).toThrow(UnauthorizedException);
      await expect(controller.listAvailable(query, process.env.BOT_API_SECRET)).resolves.toMatchObject({ page: 2, limit: 5 });
      expect(listAvailable).toHaveBeenCalledWith(query);
      const defaults = new BotCouponQueryDto();
      expect(defaults).toMatchObject({ page: 1, limit: 5 });
    } finally {
      if (previous === undefined) delete process.env.BOT_API_SECRET;
      else process.env.BOT_API_SECRET = previous;
    }
  });
});
