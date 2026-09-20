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
    const processCakeCallback = mock(async () => ({ status: true, msg: 'OK', examined: 1, incoming: 1, approved: 1 }));
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

  test('admin bank test delegates to the selected bank history diagnostic', async () => {
    const result = { ok: true, provider: 'CAKE', endpoint: 'https://example.test/<token ẩn>',
      latencyMs: 10, totalTransactions: 2, incomingTransactions: 1, transactions: [] };
    const testCakeHistoryConnection = mock(async () => result);
    const controller = new PaymentController({ testCakeHistoryConnection } as unknown as PaymentService,
      {} as BotConfigService);

    await expect(controller.testCakeHistory({ bankConfigId: 'bank-cake' })).resolves.toEqual(result);
    expect(testCakeHistoryConnection).toHaveBeenCalledTimes(1);
    expect(testCakeHistoryConnection).toHaveBeenCalledWith('bank-cake');
  });

  test('a config-specific BIDV callback validates its own signature and accepts the batch', async () => {
    const bidvPayload: CakeCallbackDto = { status: 'success', message: 'Thành công', merchant: 'G7D1DA', transactions: [{ transactionID: 'FT233ABC', amount: 100_000,
      description: 'NAPABCDEF0123456789', type: 'IN' }] };
    const result = { status: true, msg: 'OK', examined: 1, incoming: 1, approved: 1 };
    const processCakeCallback = mock(async () => result);
    const getBankConfigForRuntime = mock(async (id: string) => id === 'bank-bidv'
      ? { id, token: 'bidv-secret', provider: 'BIDV_V4' } : undefined);
    const controller = new PaymentController({ processCakeCallback } as unknown as PaymentService,
      { getBankConfigForRuntime } as unknown as BotConfigService);

    await expect(controller.bankCallback('bank-bidv', bidvPayload, 'wrong')).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(controller.bankCallback('bank-bidv', bidvPayload, 'bidv-secret')).resolves.toEqual(result);
    expect(processCakeCallback).toHaveBeenCalledTimes(1);
    expect(processCakeCallback).toHaveBeenCalledWith(bidvPayload.transactions, 'bank-bidv');
  });

  test('authenticated bot checkout forwards product, quantity and current price', async () => {
    const previous = process.env.BOT_API_SECRET;
    process.env.BOT_API_SECRET = 'quick-checkout-test-secret';
    try {
      const result = { id: 'checkout-id', requestCode: 'DONABC', amount: 170_000, status: 'PENDING' as const,
        transferContent: 'DONABC', expiresAt: '2026-08-25T12:00:00.000Z', productId: '65b65b65b65b65b65b65b65b',
        productName: 'ChatGPT Plus', quantity: 2, unitPrice: 85_000, checkoutStatus: 'PENDING_PAYMENT' as const,
        subtotal: 170_000, discountAmount: 0, couponCode: undefined,
        bank: { bankId: 'CAKE', accountNo: '123', accountName: 'TEST', template: 'compact2' }, qrUrl: 'https://example.test/qr' };
      const createBankCheckout = mock(async () => result);
      const controller = new PaymentController({ createBankCheckout } as unknown as PaymentService, {} as BotConfigService);
      const body = { userId: '64b64b64b64b64b64b64b64b', productId: '65b65b65b65b65b65b65b65b',
        quantity: 2, expectedUnitPrice: 85_000, idempotencyKey: 'checkout-idempotency' };
      await expect(controller.createBotCheckout(body, 'quick-checkout-test-secret')).resolves.toEqual(result);
      expect(createBankCheckout).toHaveBeenCalledWith(body.userId, body.productId, 2, 85_000, body.idempotencyKey, undefined, undefined);
    } finally {
      if (previous === undefined) delete process.env.BOT_API_SECRET;
      else process.env.BOT_API_SECRET = previous;
    }
  });

  test('authenticated customer can cancel only their own quick checkout through the bot endpoint', async () => {
    const previous = process.env.BOT_API_SECRET;
    process.env.BOT_API_SECRET = 'cancel-checkout-test-secret';
    try {
      const result = { id: '65b65b65b65b65b65b65b65b', requestCode: 'DONCANCELLED',
        status: 'EXPIRED' as const, cancelled: true, checkout: undefined };
      const cancelBankCheckout = mock(async () => result);
      const controller = new PaymentController({ cancelBankCheckout } as unknown as PaymentService, {} as BotConfigService);
      const body = { userId: '64b64b64b64b64b64b64b64b' };

      expect(() => controller.cancelBotCheckout(result.id, body, 'wrong-secret')).toThrow(UnauthorizedException);
      await expect(controller.cancelBotCheckout(result.id, body, 'cancel-checkout-test-secret')).resolves.toEqual(result);
      expect(cancelBankCheckout).toHaveBeenCalledTimes(1);
      expect(cancelBankCheckout).toHaveBeenCalledWith(result.id, body.userId);
    } finally {
      if (previous === undefined) delete process.env.BOT_API_SECRET;
      else process.env.BOT_API_SECRET = previous;
    }
  });
});
