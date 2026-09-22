import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import mongoose, { type Connection, type Model, Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import {
  InventoryItemSchema, OrderSchema, ProductSchema, UserSchema,
  type InventoryItem, type Product,
} from '@store/database';
import { InventoryAdminService } from '../../apps/api/src/inventory/inventory-admin.service';

const integration = process.env.RUN_INTEGRATION === '1' ? describe : describe.skip;

integration('inventory search against isolated MongoDB', () => {
  let server: MongoMemoryServer;
  let connection: Connection;
  let items: Model<InventoryItem>;
  let products: Model<Product>;
  let service: InventoryAdminService;
  const productId = new Types.ObjectId();
  const adminId = new Types.ObjectId();
  const createdAt = new Date('2026-09-01T00:00:00.000Z');

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    connection = await new mongoose.Mongoose().createConnection(server.getUri('inventory_search'), {
      autoIndex: false, monitorCommands: true,
    }).asPromise();
    items = connection.model('InventoryItem', InventoryItemSchema, 'inventory_items');
    products = connection.model('Product', ProductSchema, 'products');
    connection.model('Order', OrderSchema, 'orders');
    connection.model('User', UserSchema, 'users');
    // list() never decrypts inventory; avoid depending on real environment keys.
    service = Object.assign(Object.create(InventoryAdminService.prototype), { items, products });
    await items.createIndexes();
  }, 120_000);

  beforeEach(async () => {
    await Promise.all(Object.values(connection.collections).map((collection) => collection.deleteMany({})));
    await products.collection.insertOne({ _id: productId, name: 'Default product' });
  });

  afterAll(async () => { await connection?.close(); await server?.stop(); }, 30_000);

  async function inventory(overrides: Partial<InventoryItem> = {}) {
    const id = new Types.ObjectId();
    await items.collection.insertOne({ _id: id, productId, status: 'AVAILABLE',
      maskedPreview: { login: `${id}@example.invalid`, password: 'se****et' },
      encryptedPayload: 'encrypted-payload-must-not-be-returned', payloadHash: id.toString().padStart(64, '0'),
      createdBy: adminId, createdAt, updatedAt: createdAt, deletedAt: null, ...overrides });
    return id;
  }

  test('ID-only searches combine inventory and batch IDs with paging, filters and no preview substring matches', async () => {
    const batchId = new Types.ObjectId();
    const first = await inventory({ importBatchId: batchId });
    const second = await inventory({ importBatchId: batchId });
    await inventory({ importBatchId: batchId, status: 'SOLD' });
    await inventory({ importBatchId: batchId, deletedAt: new Date() });
    await inventory({ maskedPreview: { login: `prefix-${batchId}-suffix` } });
    const otherProduct = new Types.ObjectId();
    await inventory({ productId: otherProduct, importBatchId: batchId });
    const search = `${first.toString().toUpperCase()}\n${batchId}`;
    const filter = { search, productId: productId.toString(), status: 'AVAILABLE' as const, limit: 1 };

    const page1 = await service.list({ ...filter, page: 1 });
    const page2 = await service.list({ ...filter, page: 2 });

    expect(page1).toMatchObject({ page: 1, total: 2, totalPages: 2 });
    expect([page1.items[0]?.id, page2.items[0]?.id].sort()).toEqual([first.toString(), second.toString()].sort());
    expect(JSON.stringify(page1)).not.toContain('encrypted-payload');
    expect((await service.list({ page: 1, limit: 20, search: new Types.ObjectId().toString() })).total).toBe(0);
  });

  test('mixed ID/text searches preserve literal substring, bulk credentials and product-name matches', async () => {
    const direct = await inventory();
    const byPreview = await inventory({ maskedPreview: { login: 'bulk@example.invalid' } });
    const byIdSubstring = await inventory({ maskedPreview: { login: `prefix-${direct}-suffix` } });
    const namedProduct = new Types.ObjectId();
    await products.collection.insertOne({ _id: namedProduct, name: 'Studio + kit' });
    const byProduct = await inventory({ productId: namedProduct });
    await inventory({ maskedPreview: { login: 'studiooooo kit' } });
    await inventory({ maskedPreview: { login: 'bulk@example.invalid' }, deletedAt: new Date() });

    const page = await service.list({ page: 1, limit: 20,
      search: `${direct}\nSTUDIO + KIT\nBULK@EXAMPLE.INVALID----private-password----2fa` });

    expect(page.total).toBe(4);
    expect(page.items.map((item) => item.id).sort()).toEqual([direct, byPreview, byIdSubstring, byProduct].map(String).sort());
    expect(page.items.find((item) => item.id === byProduct.toString())?.productName).toBe('Studio + kit');
    expect((await service.list({ page: 1, limit: 20, search: 'LK@EXAMPLE' })).total).toBe(1);
  });

  test('ID searches hydrate both direct and historical sold-order buyer links', async () => {
    const userId = new Types.ObjectId();
    const directOrder = new Types.ObjectId();
    const historicalOrder = new Types.ObjectId();
    const direct = await inventory({ status: 'SOLD', soldToUserId: userId, soldOrderId: directOrder, soldAt: createdAt });
    const historical = await inventory({ status: 'SOLD', soldAt: createdAt });
    await connection.collection('users').insertOne({ _id: userId, telegramId: '123456', username: 'buyer', displayName: 'Buyer' });
    await connection.collection('orders').insertMany([
      { _id: directOrder, inventoryItemId: direct, orderCode: 'ORD-DIRECT', userId, unitPrice: 100, totalAmount: 100, paymentMethod: 'WALLET', createdAt },
      { _id: historicalOrder, inventoryItemId: historical, orderCode: 'ORD-LEGACY', userId, unitPrice: 200, totalAmount: 200, paymentMethod: 'WALLET', createdAt },
    ]);

    const page = await service.list({ page: 1, limit: 20, search: `${direct}\n${historical}` });

    expect(page.total).toBe(2);
    for (const item of page.items) {
      expect(item).toMatchObject({ productName: 'Default product', sale: { soldAt: createdAt,
        buyer: { id: userId.toString(), telegramId: '123456', username: 'buyer', displayName: 'Buyer' } } });
    }
    expect(page.items.find((item) => item.id === historical.toString())?.sale?.order).toMatchObject({ id: historicalOrder.toString(), totalAmount: 200 });
    expect(page.items.find((item) => item.id === direct.toString())?.sale?.order).toMatchObject({ id: directOrder.toString(), totalAmount: 100 });
  });

  test('ID and batch searches examine only matching rows for both the page and total', async () => {
    const batchId = new Types.ObjectId();
    const otherBatchId = new Types.ObjectId();
    const rows = Array.from({ length: 2_000 }, (_, index) => ({
      _id: new Types.ObjectId(), productId, status: 'AVAILABLE', maskedPreview: { login: `user-${index}` },
      importBatchId: index < 10 ? batchId : otherBatchId, payloadHash: String(index).padStart(64, '0'),
      deletedAt: null, createdAt: new Date(createdAt.getTime() + index), updatedAt: createdAt,
    }));
    await items.collection.insertMany(rows);

    for (const [search, matches] of [[rows[0]!._id.toString(), 1], [batchId.toString(), 10]] as const) {
      let filter: Record<string, unknown> = {};
      const capture = (event: { commandName: string; command: Record<string, any> }) => {
        if (event.commandName === 'find' && event.command.find === 'inventory_items') filter = event.command.filter;
      };
      connection.getClient().on('commandStarted', capture);
      try {
        expect((await service.list({ page: 1, limit: 20, search })).total).toBe(matches);
      } finally { connection.getClient().off('commandStarted', capture); }
      const page = await items.collection.find(filter).sort({ createdAt: -1, _id: -1 }).limit(20).explain('executionStats');
      const count = await items.collection.aggregate([{ $match: filter }, { $count: 'total' }]).explain('executionStats');
      const countStats = count.executionStats ?? count.stages[0].$cursor.executionStats;
      expect(page.executionStats.totalDocsExamined).toBeLessThanOrEqual(matches);
      expect(countStats.totalDocsExamined).toBeLessThanOrEqual(matches);
    }
  });
});
