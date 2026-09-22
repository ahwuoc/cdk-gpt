import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import mongoose, { type Connection, type Model, type PipelineStage, Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { AuditLogSchema, CustomerMessageSchema, OrderSchema, ProductSchema, UserSchema, WarrantyRequestSchema,
  WarrantyStatus, type Order, type User, type WarrantyRequest } from '@store/database';
import { ComplaintCategory } from '@store/shared';
import { WarrantyService } from '../../apps/api/src/warranty/warranty.service';

const integration = process.env.RUN_INTEGRATION === '1' ? describe : describe.skip;

integration('indexed warranty history pages against isolated MongoDB', () => {
  let server: MongoMemoryServer;
  let connection: Connection;
  let reports: Model<WarrantyRequest>;
  let service: WarrantyService;
  const buyer = new Types.ObjectId();
  const product = new Types.ObjectId();
  const day = new Date('2026-08-31T17:00:00.000Z');
  const ids = Array.from({ length: 120 }, () => new Types.ObjectId());
  const orderIds = ids.map(() => new Types.ObjectId());

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    connection = await new mongoose.Mongoose().createConnection(server.getUri('warranty_history'), { autoIndex: false }).asPromise();
    reports = connection.model('WarrantyRequest', WarrantyRequestSchema, 'warranty_requests');
    const orders = connection.model<Order>('Order', OrderSchema, 'orders');
    const users = connection.model<User>('User', UserSchema, 'users');
    const products = connection.model('Product', ProductSchema, 'products');
    const messages = connection.model('CustomerMessage', CustomerMessageSchema, 'customer_messages');
    const audits = connection.model('AuditLog', AuditLogSchema, 'audit_logs');
    service = new WarrantyService(connection, reports, orders, users, messages, audits, {} as never, {} as never);
    await reports.createIndexes();
    await users.collection.insertOne({ _id: buyer, telegramId: '10001', username: 'reportbuyer', displayName: 'Report Buyer',
      status: 'ACTIVE', walletBalance: 500, referralCode: 'FAKEBUYER', deletedAt: null, createdAt: day, updatedAt: day });
    await products.collection.insertOne({ _id: product, name: 'Report product', slug: 'report-product', status: 'ACTIVE',
      deliveryTemplate: 'do-not-expose', deletedAt: null, createdAt: day, updatedAt: day });
    await orders.collection.insertMany(orderIds.slice(1).map((_id) => ({ _id, orderCode: `ORD-${_id}`, userId: buyer,
      productId: product, inventoryItemId: new Types.ObjectId(), quantity: 1, unitPrice: 100, totalAmount: 100,
      status: 'DELIVERED', paymentMethod: 'WALLET', deliveryStatus: 'SENT', metadata: { private: 'do-not-expose' },
      createdAt: day, updatedAt: day, deliveredAt: day })));
    await reports.collection.insertMany(ids.map((_id, index) => ({ _id, requestCode: `REP-${index}`, orderId: orderIds[index],
      userId: index ? buyer : new Types.ObjectId(), inventoryItemId: new Types.ObjectId(),
      status: index % 2 ? WarrantyStatus.PENDING : WarrantyStatus.RESOLVED,
      category: index % 3 ? ComplaintCategory.OTHER : ComplaintCategory.INVALID_CREDENTIALS,
      reason: 'Cannot use the purchased account', evidenceUrls: ['https://example.invalid/report.png'],
      resolutionNote: index % 2 ? undefined : 'Customer confirmed replacement', metadata: { private: 'do-not-expose' },
      createdAt: day, updatedAt: day })));
  }, 120_000);

  afterAll(async () => { await connection?.close(); await server?.stop(); }, 30_000);

  test('normal and status pages read only eight indexed rows before joining, with exact totals', async () => {
    let pipeline: PipelineStage[] = [];
    const original = reports.aggregate.bind(reports);
    const aggregate = spyOn(reports, 'aggregate').mockImplementation(((stages: PipelineStage[]) => {
      pipeline = stages; return original(stages);
    }) as typeof reports.aggregate);
    try {
      for (const status of [undefined, WarrantyStatus.PENDING]) {
        const matching = ids.filter((_, index) => !status || index % 2).reverse();
        const first = await service.list({ page: 1, limit: 8, status });
        expect(first).toMatchObject({ total: matching.length, totalPages: Math.ceil(matching.length / 8), page: 1, limit: 8 });
        expect(first.items.map((item) => item.id)).toEqual(matching.slice(0, 8).map(String));
        expect(first.items[0]).toMatchObject({ user: { username: 'reportbuyer' }, product: { name: 'Report product' },
          order: { totalAmount: 100 }, evidenceUrls: ['https://example.invalid/report.png'] });
        expect(JSON.stringify(first)).not.toContain('do-not-expose');
        expect(first.items[0]!.user).not.toHaveProperty('walletBalance');
        const plan = await original(pipeline).explain('executionStats');
        const cursor = plan.stages.find((stage: { $cursor?: unknown }) => stage.$cursor).$cursor;
        expect(cursor.executionStats.totalDocsExamined).toBe(8);
        expect(cursor.executionStats.totalKeysExamined).toBe(8);
        expect(JSON.stringify(cursor.queryPlanner.winningPlan)).toContain(status ? 'report_history_status_created_id' : 'report_history_created_id');
        const second = await service.list({ page: 2, limit: 8, status });
        expect(second.items.map((item) => item.id)).toEqual(matching.slice(8, 16).map(String));
        expect((await service.list({ page: 99, limit: 8, status })).items).toEqual([]);
      }
    } finally { aggregate.mockRestore(); }
  });

  test('filters, missing joins, joined search and literal regex characters keep their behavior', async () => {
    const page = { page: 1, limit: 20 };
    expect((await service.list({ ...page, userId: buyer.toString() })).total).toBe(119);
    expect((await service.list({ ...page, category: ComplaintCategory.INVALID_CREDENTIALS })).total).toBe(40);
    const orphan = await service.list({ ...page, orderId: orderIds[0]!.toString() });
    expect(orphan.total).toBe(1);
    expect(orphan.items[0]).toMatchObject({ order: null, user: null, product: null,
      resolutionNote: 'Customer confirmed replacement' });
    for (const search of ['reportbuyer', 'Report product', 'report-product']) {
      expect((await service.list({ ...page, search })).total).toBe(119);
    }
    expect((await service.list({ ...page, search: `ORD-${orderIds[119]}` })).items[0]?.id).toBe(String(ids[119]));
    expect((await service.list({ ...page, search: '.*' })).total).toBe(0);
    expect((await service.list({ ...page, search: '   ' })).total).toBe(120);
  });

  test('Vietnam date boundaries apply equally to page results and counts', async () => {
    const page = { page: 1, limit: 20 };
    expect((await service.list({ ...page, from: '2026-09-01', to: '2026-09-01' })).total).toBe(120);
    expect((await service.list({ ...page, from: '2026-08-31', to: '2026-08-31' })).total).toBe(0);
    await expect(service.list({ ...page, from: '2026-09-02', to: '2026-09-01' })).rejects.toThrow('from date');
  });
});
