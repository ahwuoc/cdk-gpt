import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { UnauthorizedException } from '@nestjs/common';
import { WarrantyController } from '../apps/api/src/warranty/warranty.controller';
import type { CreateOrderReportDto } from '../apps/api/src/warranty/warranty.dto';
import type { WarrantyService } from '../apps/api/src/warranty/warranty.service';

const originalSecret = process.env.BOT_API_SECRET;
const payload: CreateOrderReportDto = {
  userId: '64b64c0f1de2360012345678', orderId: '64b64c0f1de2360012345679',
  category: 'INVALID_CREDENTIALS', description: 'Tài khoản không thể đăng nhập.',
};

beforeEach(() => { process.env.BOT_API_SECRET = 'bot-report-secret'; });
afterEach(() => {
  if (originalSecret === undefined) delete process.env.BOT_API_SECRET;
  else process.env.BOT_API_SECRET = originalSecret;
});

test('order report endpoint rejects an invalid bot credential before creating a report', () => {
  const create = mock(async () => ({ id: 'report-id' }));
  const controller = new WarrantyController({ create } as unknown as WarrantyService);
  expect(() => controller.create(payload)).toThrow(UnauthorizedException);
  expect(() => controller.create(payload, 'wrong-secret')).toThrow(UnauthorizedException);
  expect(create).toHaveBeenCalledTimes(0);
});

test('order report endpoint forwards a verified request once', async () => {
  const result = { id: 'report-id', requestCode: 'REP-1234567890', status: 'PENDING' as const, existing: false };
  const create = mock(async () => result);
  const controller = new WarrantyController({ create } as unknown as WarrantyService);
  await expect(controller.create(payload, 'bot-report-secret')).resolves.toEqual(result);
  expect(create).toHaveBeenCalledTimes(1);
  expect(create).toHaveBeenCalledWith(payload);
});
