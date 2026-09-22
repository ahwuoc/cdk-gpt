import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import mongoose, { type Connection, type Model, Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { PaymentRequestSchema, UserSchema, WalletTransactionSchema, type PaymentRequest, type User, type WalletTransaction } from '@store/database';
import { PaymentRequestStatus, WalletTransactionType } from '@store/shared';
import { BankReconciliationService } from '../apps/api/src/payment/bank-reconciliation.service';

const CODE = 'DONEA88E69F0BD2558D';
const BANK_ID = 'bank-test';

describe('read-only bank reconciliation', () => {
  let mongo: MongoMemoryServer;
  let connection: Connection;
  let requests: Model<PaymentRequest>;
  let wallets: Model<WalletTransaction>;
  let users: Model<User>;
  let reconcile: BankReconciliationService;

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    connection = await new mongoose.Mongoose().createConnection(mongo.getUri('bank_reconciliation'), { autoIndex: false }).asPromise();
    requests = connection.model('PaymentRequest', PaymentRequestSchema, 'payment_requests');
    wallets = connection.model('WalletTransaction', WalletTransactionSchema, 'wallet_transactions');
    users = connection.model('User', UserSchema, 'users');
  }, 120_000);
  beforeEach(async () => {
    await Promise.all([requests.deleteMany({}), wallets.deleteMany({}), users.deleteMany({})]);
    const bank = { getBankConfigForRuntime: async (id: string) => id === BANK_ID
      ? { id: BANK_ID, label: 'Bank test', provider: 'CAKE_V2' as const, token: 'hidden', bankId: 'TEST', accountNo: '123456', template: 'compact2', accountName: 'TEST' }
      : undefined };
    reconcile = new BankReconciliationService(requests as never, wallets as never, users as never, bank as never,
      async () => Response.json({ status: 'success', transactions: [] }));
  });
  afterAll(async () => { await connection?.close(); await mongo?.stop(); }, 30_000);

  async function user(index = 1) {
    return users.create({ telegramId: String(index), username: `user${index}`, displayName: `User ${index}`,
      status: 'ACTIVE', walletBalance: 0, referralCode: `REF${String(index).padStart(6, '0')}`, purchaseCount: 0,
      checkoutLockVersion: 0, deletedAt: null });
  }

  async function request(userId: Types.ObjectId, status: string, amount = 100_000) {
    return requests.create({ requestCode: CODE, userId, amount, provider: 'BANK_API', status,
      proofUrls: [], idempotencyKey: `request-${new Types.ObjectId()}`, metadata: { bankConfigId: BANK_ID }, deletedAt: null });
  }

  async function wallet(userId: Types.ObjectId, transactionId: string, amount: number) {
    return wallets.create({ userId, balanceBefore: 0, balanceAfter: amount, amount,
      type: WalletTransactionType.DEPOSIT, reason: 'Bank deposit', referenceType: 'PAYMENT_REQUEST',
      referenceId: new Types.ObjectId(), idempotencyKey: `deposit:bank:bank:${BANK_ID}:${transactionId}`,
      actorType: 'WEBHOOK', metadata: { bankConfigId: BANK_ID, transactionId } });
  }

  test('shows bank receipt and rejection reason without treating it as wallet credit', async () => {
    const buyer = await user();
    const payment = await request(buyer._id, PaymentRequestStatus.REJECTED, 100_000);
    await payment.updateOne({ $set: { rejectionReason: 'Sai số tiền chuyển' } });
    const service = new BankReconciliationService(requests as never, wallets as never, users as never,
      { getBankConfigForRuntime: async () => ({ id: BANK_ID, label: 'Bank test', provider: 'CAKE_V2', token: 'hidden', bankId: 'TEST', accountNo: '123456', template: 'compact2', accountName: 'TEST' }) } as never,
      async () => Response.json({ status: 'success', transactions: [{ type: 'IN', transactionID: 'TX-REJECTED', amount: 100000, description: `NAP ${CODE}`, transactionDate: '23/09/2026' }] }));
    const result = await service.reconcile(BANK_ID);
    expect(result.summary.rejectedReceivedCount).toBe(1);
    expect(result.summary.creditedAmount).toBe(0);
    expect(result.items[0]).toMatchObject({ status: 'BANK_RECEIVED_REQUEST_REJECTED', amount: 100_000, creditedAmount: 0 });
    expect(result.items[0]!.paymentRequests[0]).toMatchObject({ id: payment._id.toString(), rejectionReason: 'Sai số tiền chuyển' });
  });

  test('matches an underpaid transfer against the actual ledger amount, not requested amount', async () => {
    const buyer = await user();
    const payment = await request(buyer._id, PaymentRequestStatus.APPROVED, 100_000);
    await payment.updateOne({ $set: { providerReference: `bank:${BANK_ID}:TX-UNDER`, walletTransactionId: new Types.ObjectId() } });
    await wallet(buyer._id, 'TX-UNDER', 90_000);
    const service = new BankReconciliationService(requests as never, wallets as never, users as never,
      { getBankConfigForRuntime: async () => ({ id: BANK_ID, label: 'Bank test', provider: 'CAKE_V2', token: 'hidden', bankId: 'TEST', accountNo: '123456', template: 'compact2', accountName: 'TEST' }) } as never,
      async () => Response.json({ status: 'success', transactions: [{ type: 'IN', transactionID: 'TX-UNDER', amount: 90_000, description: CODE }] }));
    const result = await service.reconcile(BANK_ID);
    expect(result.items[0]).toMatchObject({ status: 'MATCHED', amount: 90_000, creditedAmount: 90_000, difference: 0 });
    expect(result.items[0]!.paymentRequests[0]!.requestedAmount).toBe(100_000);
  });

  test('does not count outgoing or unmatched bank rows as received credits', async () => {
    const service = new BankReconciliationService(requests as never, wallets as never, users as never,
      { getBankConfigForRuntime: async () => ({ id: BANK_ID, label: 'Bank test', provider: 'CAKE_V2', token: 'hidden', bankId: 'TEST', accountNo: '123456', template: 'compact2', accountName: 'TEST' }) } as never,
      async () => Response.json({ status: 'success', transactions: [
        { type: 'OUT', transactionID: 'TX-OUT', amount: 50_000, description: 'RUT TIEN' },
        { type: 'IN', transactionID: 'TX-UNKNOWN', amount: 80_000, description: 'NGUOI LA CHUYEN' },
      ] }));
    const result = await service.reconcile(BANK_ID);
    expect(result.summary.incomingAmount).toBe(80_000);
    expect(result.summary.outgoingAmount).toBe(50_000);
    expect(result.summary.creditedAmount).toBe(0);
    expect(result.items.map((item) => item.status)).toEqual(['OUTGOING', 'UNMATCHED']);
  });
});
