import { expect, test } from 'bun:test';
import { ConflictException } from '@nestjs/common';
import { formatWarrantyDuration } from '@store/shared';
import { WarrantyService } from '../apps/api/src/warranty/warranty.service';

const userId = '64b64c0f1de2360012345678';
const orderId = '64b64c0f1de2360012345679';
const productId = '64b64c0f1de2360012345680';

test('formats hour-only warranties and keeps legacy day values readable', () => {
  expect(formatWarrantyDuration(0, 2)).toBe('2 giờ');
  expect(formatWarrantyDuration(1, 2)).toBe('1 ngày 2 giờ');
  expect(formatWarrantyDuration(7, 0)).toBe('7 ngày');
});

test('rejects a warranty report after a two-hour warranty expires', async () => {
  const order = {
    _id: orderId, userId, productId, createdAt: new Date(),
    deliveredAt: new Date(Date.now() - 3 * 60 * 60 * 1_000),
  };
  const orders = { findOne: () => ({ lean: async () => order }) };
  const reports = { findOne: () => ({ lean: async () => null }) };
  const products = { findById: () => ({ select: () => ({ lean: async () => ({ warrantyDays: 0, warrantyHours: 2 }) }) }) };
  const service = new WarrantyService({} as never, reports as never, orders as never, products as never,
    {} as never, {} as never, {} as never, {} as never, {} as never);

  await expect(service.create({ userId, orderId, category: 'WARRANTY', description: 'Tài khoản đã hết hạn bảo hành.' }))
    .rejects.toBeInstanceOf(ConflictException);
});
