import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import mongoose, { type Connection, type Model, type PipelineStage, Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { AnalyticsService } from '../../apps/api/src/analytics/analytics.service';
import { AuditLogSchema, InventoryItemSchema, OrderSchema, PaymentRequestSchema, ProductSchema, UserSchema,
  WalletTransactionSchema, type AuditLog, type InventoryItem, type Order, type PaymentRequest, type Product,
  type User, type WalletTransaction } from '@store/database';
import { adminHistoryIndexesMigration } from '../../packages/database/src/migrations/011-admin-history-indexes';

const integration = process.env.RUN_INTEGRATION === '1' ? describe : describe.skip;

integration('indexed admin history pages against isolated MongoDB', () => {
  let server: MongoMemoryServer;
  let connection: Connection;
  let service: AnalyticsService;
  let orders: Model<Order>;
  let payments: Model<PaymentRequest>;
  let users: Model<User>;
  let wallets: Model<WalletTransaction>;
  let audits: Model<AuditLog>;
  const buyer = new Types.ObjectId();
  const product = new Types.ObjectId();
  const day = new Date('2026-08-31T17:00:00.000Z');
  const orderIds = Array.from({ length: 120 }, () => new Types.ObjectId());

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    connection = await new mongoose.Mongoose().createConnection(server.getUri('admin_history'), { autoIndex: false }).asPromise();
    orders = connection.model('Order', OrderSchema, 'orders');
    payments = connection.model('PaymentRequest', PaymentRequestSchema, 'payment_requests');
    users = connection.model('User', UserSchema, 'users');
    wallets = connection.model('WalletTransaction', WalletTransactionSchema, 'wallet_transactions');
    audits = connection.model('AuditLog', AuditLogSchema, 'audit_logs');
    const products = connection.model<Product>('Product', ProductSchema, 'products');
    const inventory = connection.model<InventoryItem>('InventoryItem', InventoryItemSchema, 'inventory_items');
    service = new AnalyticsService(orders, payments, users, products, inventory, wallets, audits);
    await adminHistoryIndexesMigration.up(connection);
    await users.collection.insertOne({ _id: buyer, telegramId: '10001', username: 'auditbuyer', displayName: 'Audit Buyer',
      status: 'ACTIVE', walletBalance: 500, purchaseCount: 120, referralCode: 'FAKEBUYER', deletedAt: null, createdAt: day, updatedAt: day });
    await products.collection.insertOne({ _id: product, name: 'Fake product', slug: 'fake-product', status: 'ACTIVE',
      deletedAt: null, lowStockThreshold: 1, createdAt: day, updatedAt: day });
    await orders.collection.insertMany(orderIds.map((_id) => ({ _id, orderCode: `ORD-${_id}`, userId: buyer,
      productId: product, inventoryItemId: new Types.ObjectId(), quantity: 1, unitPrice: 100, totalAmount: 100,
      status: 'DELIVERED', paymentMethod: 'WALLET', deliveryStatus: 'SENT', metadata: {},
      createdAt: day, updatedAt: day, deliveredAt: day })));
    await payments.collection.insertMany([null, new Date()].map((deletedAt, i) => ({
      _id: new Types.ObjectId(), requestCode: `PAY-FAKE-${i}`, userId: buyer, amount: 100,
      provider: 'TEST', status: 'APPROVED', deletedAt, createdAt: day, updatedAt: day, reviewedAt: day, metadata: {},
    })));
    await wallets.collection.insertOne({ _id: new Types.ObjectId(), userId: buyer, amount: 100, balanceBefore: 400, balanceAfter: 500,
      type: 'DEPOSIT', reason: 'History deposit', referenceType: 'PAYMENT_REQUEST', idempotencyKey: 'fake-history-deposit',
      actorType: 'SYSTEM', metadata: {}, createdAt: day, updatedAt: day });
    await audits.collection.insertOne({ _id: new Types.ObjectId(), actorType: 'USER', actorId: buyer, action: 'HISTORY_READ',
      resourceType: 'Order', requestId: 'fake-request', metadata: { password: 'fake-secret', safe: 'visible' }, createdAt: day, updatedAt: day });
  }, 120_000);

  afterAll(async () => { await connection?.close(); await server?.stop(); }, 30_000);

  test('first order page reads only its indexed rows and retains exact totals and deterministic pagination', async () => {
    let pipeline: PipelineStage[] = [];
    const original = orders.aggregate.bind(orders);
    const aggregate = spyOn(orders, 'aggregate').mockImplementation(((stages: PipelineStage[]) => {
      pipeline = stages; return original(stages);
    }) as typeof orders.aggregate);
    try {
      const first = await service.orders({ page: 1, limit: 8 });
      expect(first).toMatchObject({ total: 120, totalPages: 15, limit: 8, page: 1 });
      expect(first.items.map((item) => item.id)).toEqual(orderIds.slice(-8).reverse().map(String));
      expect(first.items[0]).toMatchObject({ user: { username: 'auditbuyer' }, product: { name: 'Fake product' } });
      const plan = await original(pipeline).explain('executionStats');
      const cursor = plan.stages.find((stage: { $cursor?: unknown }) => stage.$cursor).$cursor;
      expect(cursor.executionStats.totalDocsExamined).toBe(8);
      expect(cursor.executionStats.totalKeysExamined).toBe(8);
      const second = await service.orders({ page: 2, limit: 8 });
      expect(second.items.map((item) => item.id)).toEqual(orderIds.slice(-16, -8).reverse().map(String));
      expect((await service.orders({ page: 99, limit: 8 })).items).toEqual([]);
    } finally { aggregate.mockRestore(); }
  });

  test('joined search still matches usernames, products, literal metacharacters and Vietnam date boundaries', async () => {
    const query = { page: 1, limit: 20, from: '2026-09-01', to: '2026-09-01' };
    expect((await service.orders({ ...query, search: '@auditbuyer' })).total).toBe(120);
    expect((await service.orders({ ...query, search: 'Fake product' })).total).toBe(120);
    expect((await service.orders({ ...query, search: '.*' })).total).toBe(0);
    expect((await service.orders({ ...query, to: '2026-08-31', from: '2026-08-31' })).total).toBe(0);
    await expect(service.orders({ ...query, from: '2026-09-02' })).rejects.toThrow('from date');
  });

  test('other history pages retain soft deletion, joined search and audit redaction', async () => {
    const page = { page: 1, limit: 20 };
    for (const search of [undefined, '@auditbuyer']) {
      expect((await service.deposits({ ...page, search })).total).toBe(1);
      expect((await service.users({ ...page, search })).items[0]?.walletBalance).toBe(500);
      expect((await service.walletTransactions({ ...page, search })).items[0]?.amount).toBe(100);
      const trace = await service.auditLogs({ ...page, search });
      expect(trace.items[0]?.metadata).toEqual({ password: '[REDACTED]', safe: 'visible' });
    }
  });

  test('dashboard caches concurrent reads but explicit refresh returns changed financial totals', async () => {
    const [first, simultaneous] = await Promise.all([service.summary(), service.summary()]);
    expect(first).toBe(simultaneous);
    expect(first.revenue.total).toBe(12_000);
    await orders.collection.updateOne({ _id: orderIds[0] }, { $set: { totalAmount: 200 } });
    expect((await service.summary()).revenue.total).toBe(12_000);
    expect((await service.summary(true)).revenue.total).toBe(12_100);
  });

  test('performance indexes can be installed repeatedly and rollback preserves the pre-existing inventory batch index', async () => {
    await adminHistoryIndexesMigration.up(connection);
    await adminHistoryIndexesMigration.up(connection);
    expect((await orders.collection.indexes()).some((index) => index.name === 'admin_history_created_id')).toBe(true);
    await adminHistoryIndexesMigration.down(connection);
    expect((await orders.collection.indexes()).some((index) => index.name === 'admin_history_created_id')).toBe(false);
    const batch = (await connection.collection('inventory_items').indexes())
      .find((index) => index.name === 'importBatchId_1_createdAt_1');
    expect(batch).toMatchObject({ key: { importBatchId: 1, createdAt: 1 }, sparse: true });
    await adminHistoryIndexesMigration.up(connection);
  });
});
