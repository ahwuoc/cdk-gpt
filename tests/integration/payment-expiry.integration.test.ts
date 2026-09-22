import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import mongoose, { type Connection, type Model, Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { InventoryItemSchema, InventoryRepository, OrderRepository, OrderSchema, PaymentRequestSchema, ProductSchema,
  UserRepository, UserSchema, WalletTransactionRepository, WalletTransactionSchema,
  type InventoryItem, type PaymentRequest, type User, type WalletTransaction } from '@store/database';
import { InventoryStatus, PaymentRequestStatus } from '@store/shared';
import { InventoryReservationService } from '../../apps/api/src/inventory/inventory-reservation.service';
import { PaymentService } from '../../apps/api/src/payment/payment.service';
import { PurchaseService } from '../../apps/api/src/purchase/purchase.service';
import { WalletService } from '../../apps/api/src/wallet/wallet.service';

const integration = process.env.RUN_INTEGRATION === '1' ? describe : describe.skip;

integration('bank expiry outside the incoming-payment path', () => {
  let server: MongoMemoryReplSet;
  let connection: Connection;
  let requests: Model<PaymentRequest>;
  let users: Model<User>;
  let inventory: Model<InventoryItem>;
  let transactions: Model<WalletTransaction>;
  let service: PaymentService;
  let purchases: PurchaseService;
  let wallet: WalletService;
  const buyer = new Types.ObjectId();

  beforeAll(async () => {
    server = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
    connection = await new mongoose.Mongoose().createConnection(server.getUri('payment_expiry'), { autoIndex: false }).asPromise();
    requests = connection.model('PaymentRequest', PaymentRequestSchema, 'payment_requests');
    users = connection.model('User', UserSchema, 'users');
    inventory = connection.model('InventoryItem', InventoryItemSchema, 'inventory_items');
    transactions = connection.model('WalletTransaction', WalletTransactionSchema, 'wallet_transactions');
    const products = connection.model('Product', ProductSchema, 'products');
    const orders = connection.model('Order', OrderSchema, 'orders');
    const userRepository = new UserRepository(users);
    const walletRepository = new WalletTransactionRepository(transactions);
    const reservations = new InventoryReservationService(connection, orders,
      new InventoryRepository(inventory), userRepository, walletRepository);
    purchases = new PurchaseService(connection, products, orders, userRepository, reservations,
      new OrderRepository(orders), walletRepository, { enqueue: async () => undefined, requeue: async () => undefined });
    wallet = new WalletService(connection, userRepository, walletRepository);
    service = paymentService('serverless');
    await Promise.all([requests.createIndexes(), users.createIndexes(), transactions.createIndexes()]);
  }, 120_000);

  beforeEach(async () => {
    await Promise.all([requests.deleteMany({}), users.deleteMany({}), inventory.deleteMany({}), transactions.deleteMany({})]);
    await users.create({ _id: buyer, telegramId: '10001', username: 'expirybuyer', status: 'ACTIVE',
      walletBalance: 0, referralCode: 'EXPIRYBUYER', deletedAt: null });
  });
  afterAll(async () => { await connection?.close(); await server?.stop(); }, 30_000);

  test('a serverless callback credits its payment without processing an unrelated legacy backlog', async () => {
    await Promise.all(Array.from({ length: 35 }, () => payment('LEGACY')));
    const target = await payment('ordinary', false);
    const session = spyOn(connection, 'startSession');
    try {
      const result = await service.processCakeCallback([transfer(target)]);
      expect(result.approved).toBe(1);
      expect(session).toHaveBeenCalledTimes(1);
      expect((await users.findById(buyer))?.walletBalance).toBe(100);
      expect(await requests.countDocuments({ status: PaymentRequestStatus.PENDING })).toBe(35);
      expect(await inventory.countDocuments({ status: InventoryStatus.RESERVED })).toBe(35);
      await service.processCakeCallback([transfer(target)]);
      expect((await users.findById(buyer))?.walletBalance).toBe(100);
      expect(await transactions.countDocuments({})).toBe(1);
    } finally { session.mockRestore(); }
  });

  test('standalone callbacks credit first and then perform bounded abandoned-payment cleanup', async () => {
    const target = await payment('ordinary', false);
    const abandoned = await payment('LEGACY');
    const standalone = paymentService('server');
    const expire = standalone.expireBankTopups.bind(standalone);
    let balanceAtCleanup: number | undefined;
    const cleanup = spyOn(standalone, 'expireBankTopups').mockImplementation(async (limit, owner) => {
      balanceAtCleanup = (await users.findById(buyer))?.walletBalance;
      return expire(limit, owner);
    });
    try {
      expect((await standalone.processCakeCallback([transfer(target)])).approved).toBe(1);
      expect(balanceAtCleanup).toBe(100);
      expect(cleanup.mock.calls).toEqual([[25]]);
      expect((await requests.findById(abandoned._id))?.status).toBe(PaymentRequestStatus.EXPIRED);
      expect(await inventory.countDocuments({ status: InventoryStatus.AVAILABLE })).toBe(1);
    } finally { cleanup.mockRestore(); }
  });

  test('standalone cleanup failures keep a successful credit successful and omit sensitive error details', async () => {
    const target = await payment('ordinary', false);
    const standalone = paymentService('server');
    let balanceAtCleanup: number | undefined;
    const cleanup = spyOn(standalone, 'expireBankTopups').mockImplementation(async () => {
      balanceAtCleanup = (await users.findById(buyer))?.walletBalance;
      throw new Error('fixture-secret-database-details');
    });
    const errors = spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(await standalone.processCakeCallback([transfer(target)]))
        .toMatchObject({ status: true, msg: 'OK', approved: 1 });
      expect(balanceAtCleanup).toBe(100);
      expect((await users.findById(buyer))?.walletBalance).toBe(100);
      expect((await requests.findById(target._id))?.status).toBe(PaymentRequestStatus.APPROVED);
      expect(errors.mock.calls).toEqual([[{ event: 'bank-expiry-cleanup-failed' }]]);
    } finally { cleanup.mockRestore(); errors.mockRestore(); }
  });

  test('status polling expires only the owned request and keeps legacy hold release atomic', async () => {
    const target = await payment('LEGACY');
    const unrelated = await payment('LEGACY');
    await expect(service.checkBankDeposit(target._id.toString(), new Types.ObjectId().toString())).rejects.toThrow('not found');
    expect((await requests.findById(target._id))?.status).toBe(PaymentRequestStatus.PENDING);
    expect(await inventory.countDocuments({ status: InventoryStatus.RESERVED })).toBe(2);
    const session = spyOn(connection, 'startSession');
    try {
      expect(await service.checkBankDeposit(target._id.toString(), buyer.toString())).toMatchObject({
        status: PaymentRequestStatus.EXPIRED, historyCheck: { status: 'UNAVAILABLE' },
      });
      expect((await requests.findById(unrelated._id))?.status).toBe(PaymentRequestStatus.PENDING);
      expect(await inventory.countDocuments({ status: InventoryStatus.AVAILABLE })).toBe(1);
      for (const kind of ['ordinary', 'SOFT'] as const) {
        const unreserved = await payment(kind);
        expect(await service.checkBankDeposit(unreserved._id.toString(), buyer.toString()))
          .toMatchObject({ status: PaymentRequestStatus.EXPIRED });
      }
      expect(session).toHaveBeenCalledTimes(1);
    } finally { session.mockRestore(); }
  });

  test('maintenance bulk-expires soft payments and caps legacy transactions at 25, then drains on retry', async () => {
    await Promise.all(Array.from({ length: 30 }, () => payment('LEGACY')));
    await Promise.all(Array.from({ length: 5 }, () => payment('SOFT')));
    await Promise.all(Array.from({ length: 3 }, () => payment('ordinary')));
    const active = await Promise.all(['ordinary', 'SOFT', 'LEGACY'].map((kind) => payment(kind as PaymentKind, false)));
    const approved = await payment('LEGACY');
    await requests.updateOne({ _id: approved._id }, { $set: { status: PaymentRequestStatus.APPROVED } });
    const session = spyOn(connection, 'startSession');
    try {
      expect(await service.expireBankTopups(100)).toEqual({ expired: 33, legacyExpired: 25 });
      expect(session).toHaveBeenCalledTimes(25);
      expect(await inventory.countDocuments({ status: InventoryStatus.AVAILABLE })).toBe(25);
      expect(await requests.countDocuments({ status: PaymentRequestStatus.PENDING })).toBe(8);
      expect(await service.expireBankTopups()).toEqual({ expired: 5, legacyExpired: 5 });
      expect(await service.expireBankTopups()).toEqual({ expired: 0, legacyExpired: 0 });
      expect(session).toHaveBeenCalledTimes(30);
      expect(await requests.countDocuments({ _id: { $in: active.map((request) => request._id) }, status: PaymentRequestStatus.PENDING })).toBe(3);
      expect((await requests.findById(approved._id))?.status).toBe(PaymentRequestStatus.APPROVED);
      expect(await inventory.countDocuments({ status: InventoryStatus.RESERVED })).toBe(2);
    } finally { session.mockRestore(); }
  });

  test('late credit and legacy hold release roll back together and retry without duplicate money', async () => {
    const target = await payment('LEGACY');
    const release = purchases.releaseBankCheckoutReservation.bind(purchases);
    const failure = spyOn(purchases, 'releaseBankCheckoutReservation').mockImplementationOnce(async (id, session) => {
      await release(id, session);
      throw new Error('fixture release failure');
    });
    try {
      await expect(service.processCakeCallback([transfer(target)])).rejects.toThrow('fixture release failure');
      expect((await requests.findById(target._id))?.status).toBe(PaymentRequestStatus.PENDING);
      expect((await users.findById(buyer))?.walletBalance).toBe(0);
      expect(await transactions.countDocuments({})).toBe(0);
      expect(await inventory.countDocuments({ status: InventoryStatus.RESERVED })).toBe(1);
    } finally { failure.mockRestore(); }
    await service.processCakeCallback([transfer(target)]);
    await service.processCakeCallback([transfer(target)]);
    expect((await users.findById(buyer))?.walletBalance).toBe(100);
    expect(await transactions.countDocuments({})).toBe(1);
    expect(await inventory.countDocuments({ status: InventoryStatus.AVAILABLE })).toBe(1);
    expect(await requests.findById(target._id).lean()).toMatchObject({ status: PaymentRequestStatus.APPROVED,
      metadata: { latePayment: true, quickCheckout: { status: 'FAILED' } } });
  });

  test('maintenance racing a late callback preserves the credit and releases its hold once', async () => {
    const target = await payment('LEGACY');
    await Promise.all([service.expireBankTopups(), service.processCakeCallback([transfer(target)])]);
    expect((await users.findById(buyer))?.walletBalance).toBe(100);
    expect(await transactions.countDocuments({})).toBe(1);
    expect((await requests.findById(target._id))?.status).toBe(PaymentRequestStatus.APPROVED);
    expect(await inventory.countDocuments({ status: InventoryStatus.AVAILABLE })).toBe(1);
  });

  type PaymentKind = 'ordinary' | 'SOFT' | 'LEGACY';
  function paymentService(runtime: 'server' | 'serverless') {
    const previous = process.env.APP_RUNTIME;
    process.env.APP_RUNTIME = runtime;
    try { return new PaymentService(connection, requests, wallet, undefined, purchases); }
    finally {
      if (previous === undefined) delete process.env.APP_RUNTIME;
      else process.env.APP_RUNTIME = previous;
    }
  }

  async function payment(kind: PaymentKind, expired = true) {
    const _id = new Types.ObjectId(); const productId = new Types.ObjectId();
    const requestCode = `${kind === 'ordinary' ? 'NAP' : 'DON'}${_id.toString().slice(-16).toUpperCase()}`;
    const expiresAt = new Date(Date.now() + (expired ? -60_000 : 60_000));
    const request = await requests.create({ _id, userId: buyer, requestCode, amount: 100, provider: 'BANK_API',
      status: PaymentRequestStatus.PENDING, proofUrls: [], idempotencyKey: `expiry-fixture:${_id}`, deletedAt: null,
      metadata: { expiresAt: expiresAt.toISOString(), transferContent: requestCode,
        ...(kind !== 'ordinary' ? { quickCheckout: { productId: productId.toString(), productName: 'Expiry fixture',
          quantity: 1, unitPrice: 100, totalAmount: 100, idempotencyPrefix: `quickpay:${requestCode}`,
          status: 'PENDING_PAYMENT', ...(kind === 'SOFT' ? { reservationMode: 'SOFT' } : {}) } } : {}) } });
    if (kind === 'LEGACY') await inventory.collection.insertOne({ productId, createdBy: new Types.ObjectId(),
      status: InventoryStatus.RESERVED, reservedPaymentRequestId: _id, reservedByUserId: buyer,
      reservationExpiresAt: expiresAt, createdAt: new Date(), updatedAt: new Date(), deletedAt: null });
    return request;
  }
  function transfer(request: { _id: Types.ObjectId; requestCode: string }) {
    return { transactionID: request._id.toString(), amount: 100, description: `PAY ${request.requestCode}`, type: 'IN' };
  }
});
