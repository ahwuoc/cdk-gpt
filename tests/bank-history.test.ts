import { describe, expect, test } from 'bun:test';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CakeCallbackDto } from '../apps/api/src/payment/payment.dto';
import { fetchBankHistoryTransactions } from '../apps/api/src/payment/payment.service';

describe('bank history providers', () => {
  test('BIDV V4 uses the documented V2 history endpoint and accepts alphanumeric transaction ids', async () => {
    let requestedUrl = '';
    const transactions = await fetchBankHistoryTransactions('BIDV_V4', 'bidv-secret', async (input) => {
      requestedUrl = String(input);
      return Response.json({ status: 'success', msg: 'Thành công', merchant: 'G7D1DA', transactions: [{
        type: 'IN', transactionID: 'FT233ABC-01', amount: '100000', description: 'NAPABCDEF0123456789',
        transactionDate: '14/01/2026',
      }] });
    });

    expect(requestedUrl).toBe('https://thueapibank.vn/historyapibidvv2/bidv-secret');
    expect(transactions).toEqual([{ type: 'IN', transactionID: 'FT233ABC-01', amount: 100_000,
      description: 'NAPABCDEF0123456789', transactionDate: '14/01/2026' }]);
  });

  test('Cake keeps using the existing V2 endpoint', async () => {
    let requestedUrl = '';
    await fetchBankHistoryTransactions('CAKE_V2', 'cake-secret', async (input) => {
      requestedUrl = String(input);
      return Response.json({ status: 'success', transactions: [] });
    });

    expect(requestedUrl).toBe('https://thueapibank.vn/historyapicakev2/cake-secret');
  });

  test('BIDV V4 webhook envelope passes strict request validation', async () => {
    const errors = await validate(plainToInstance(CakeCallbackDto, {
      status: 'success', message: 'Thành công', merchant: 'G7D1DA', transactions: [{
        type: 'IN', transactionID: 'FT233ABC', amount: '100000', description: 'NAPABCDEF0123456789',
      }],
    }));
    expect(errors).toHaveLength(0);
  });
});
