import 'reflect-metadata';
import { expect, test } from 'bun:test';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AdminWalletAdjustmentDto } from '../apps/api/src/wallet/wallet-admin.dto';

test('normalizes a valid manual wallet adjustment', async () => {
  const input = plainToInstance(AdminWalletAdjustmentDto, { direction: ' credit ', amount: '125000', reason: '  Bù giao dịch thiếu  ' });
  expect(await validate(input)).toHaveLength(0);
  expect(input).toMatchObject({ direction: 'CREDIT', amount: 125_000, reason: 'Bù giao dịch thiếu' });
});

test('rejects zero, negative, decimal, and undocumented wallet adjustments', async () => {
  for (const value of [0, -1, 1.5]) {
    const input = plainToInstance(AdminWalletAdjustmentDto, { direction: 'DEBIT', amount: value, reason: 'Điều chỉnh thử' });
    expect(await validate(input)).not.toHaveLength(0);
  }
  const missingReason = plainToInstance(AdminWalletAdjustmentDto, { direction: 'CREDIT', amount: 1, reason: 'x' });
  expect((await validate(missingReason)).some((error) => error.property === 'reason')).toBeTrue();
});
