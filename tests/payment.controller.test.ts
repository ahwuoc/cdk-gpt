import { describe, expect, mock, test } from 'bun:test';
import { UnauthorizedException } from '@nestjs/common';
import type { BotConfigService } from '../apps/api/src/bot-config/bot-config.service';
import { PaymentController } from '../apps/api/src/payment/payment.controller';
import type { CakeCallbackDto } from '../apps/api/src/payment/payment.dto';
import type { PaymentService } from '../apps/api/src/payment/payment.service';

const payload: CakeCallbackDto = {
  transactions: [{ transactionID: '479740339', amount: 100_000,
    description: 'BUI THANH PHUONG NAPABC123', transactionDate: '08/08/2026', type: 'IN' }],
};

describe('Cake payment callback', () => {
  test('rejects a missing or incorrect signature before processing transactions', async () => {
    const processCakeCallback = mock(async () => ({ status: true }));
    const controller = new PaymentController({ processCakeCallback } as unknown as PaymentService, {
      getBankApiTokenForRuntime: async () => 'cake-api-token',
    } as unknown as BotConfigService);

    await expect(controller.cakeCallback(payload)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(controller.cakeCallback(payload, 'wrong-token')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(processCakeCallback).toHaveBeenCalledTimes(0);
  });

  test('accepts the configured Cake signature and forwards the batch once', async () => {
    const result = { status: true, msg: 'OK', examined: 1, incoming: 1, approved: 1 };
    const processCakeCallback = mock(async () => result);
    const controller = new PaymentController({ processCakeCallback } as unknown as PaymentService, {
      getBankApiTokenForRuntime: async () => 'cake-api-token',
    } as unknown as BotConfigService);

    await expect(controller.cakeCallback(payload, 'cake-api-token')).resolves.toEqual(result);
    expect(processCakeCallback).toHaveBeenCalledTimes(1);
    expect(processCakeCallback).toHaveBeenCalledWith(payload.transactions);
  });
});
