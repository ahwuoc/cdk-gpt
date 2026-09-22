import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import mongoose, { type Connection, type Model, Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import {
  InventoryItemSchema, OrderSchema, ProductSchema, UserSchema,
  type InventoryItem, type Product,
} from '@store/database';
import { InventoryAdminService } from '../../apps/api/src/inventory/inventory-admin.service';
import type { InventoryListQueryDto } from '../../apps/api/src/inventory/inventory.dto';
import { inventorySearchValues } from '@store/shared';
import { backfillInventorySearchValues, inventorySearchMigration } from '../../packages/database/src/migrations/013-inventory-search';

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

  async function explainList(query: InventoryListQueryDto) {
    let filter: Record<string, unknown> = {};
    const capture = (event: { commandName: string; command: Record<string, any> }) => {
      if (event.commandName === 'find' && event.command.find === 'inventory_items') filter = event.command.filter;
    };
    connection.getClient().on('commandStarted', capture);
    let result;
    try { result = await service.list(query); } finally { connection.getClient().off('commandStarted', capture); }
    const page = await items.collection.find(filter).sort({ createdAt: -1, _id: -1 }).limit(query.limit).explain('executionStats');
    const count = await items.collection.aggregate([{ $match: filter }, { $count: 'total' }]).explain('executionStats');
    return { result, pageStats: page.executionStats, countStats: count.executionStats ?? count.stages[0].$cursor.executionStats };
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

  test('exact mode matches complete case-insensitive values and IDs, including unmigrated rows, without exposing secrets', async () => {
    const preview = { login: ' Alice+Test@Example.invalid ', password: 'se****et' };
    const indexed = await inventory({ maskedPreview: preview, searchValues: inventorySearchValues(preview) });
    const legacy = await inventory({ maskedPreview: { login: ' Bob@example.invalid ' } });
    const nullIndex = await inventory({ maskedPreview: { login: 'ĐẶNG@example.invalid' } });
    await items.collection.updateOne({ _id: nullIndex }, { $set: { searchValues: null } });
    await inventory({ maskedPreview: { login: 'prefix-alice+test@example.invalid' }, searchValues: ['prefix-alice+test@example.invalid'] });
    await inventory({ maskedPreview: preview, searchValues: inventorySearchValues(preview), deletedAt: new Date() });
    const byId = await inventory({ maskedPreview: {}, searchValues: inventorySearchValues({}) });

    const found = await service.list({ page: 1, limit: 20, searchMode: 'exact',
      search: `ALICE+TEST@example.invalid----private-password----2fa\nbob@EXAMPLE.invalid\nđặng@example.invalid\n${byId}` });
    expect(found.items.map((item) => item.id).sort()).toEqual([indexed, legacy, nullIndex, byId].map(String).sort());
    expect(JSON.stringify(found)).not.toContain('searchValues');
    expect(JSON.stringify(found)).not.toContain('private-password');
    expect((await service.list({ page: 1, limit: 20, searchMode: 'exact', search: 'test@example.invalid' })).total).toBe(0);
    expect((await service.list({ page: 1, limit: 20, searchMode: 'exact', search: 'Default product' })).total).toBe(0);
    expect((await service.list({ page: 1, limit: 20, searchMode: 'contains', search: 'test@example.invalid' })).total).toBe(2);
    expect((await service.list({ page: 1, limit: 20, searchMode: 'exact', search: 'secret' })).total).toBe(0);
  });

  test('backfill compares preview snapshots, handles old concurrent writers and remains idempotent', async () => {
    const stable = await inventory({ maskedPreview: { login: 'STABLE@example.invalid', password: 'se****et' } });
    const changed = await inventory({ maskedPreview: { login: 'old@example.invalid' } });
    const modern = await inventory({ maskedPreview: { login: 'modern-old@example.invalid' } });
    const collection = connection.collection('inventory_items');
    const write = collection.bulkWrite.bind(collection);
    const intercepted = spyOn(collection, 'bulkWrite').mockImplementationOnce(async (operations, options) => {
      await collection.updateOne({ _id: changed }, { $set: { maskedPreview: { login: 'new@example.invalid' } } });
      await collection.updateOne({ _id: modern }, { $set: {
        maskedPreview: { login: 'modern-new@example.invalid' }, searchValues: ['modern-new@example.invalid'],
      } });
      return write(operations, options);
    });
    try { await backfillInventorySearchValues(connection); } finally { intercepted.mockRestore(); }
    expect((await items.findById(stable).select('+searchValues').lean())?.searchValues).toEqual(['stable@example.invalid', 'se****et']);
    expect((await items.findById(changed).select('+searchValues').lean())?.searchValues).toBeUndefined();
    expect((await items.findById(modern).select('+searchValues').lean())?.searchValues).toEqual(['modern-new@example.invalid']);
    expect((await service.list({ page: 1, limit: 20, searchMode: 'exact', search: 'new@example.invalid' })).items[0]?.id).toBe(changed.toString());

    await inventorySearchMigration.up(connection);
    await inventorySearchMigration.up(connection);
    expect((await items.findById(changed).select('+searchValues').lean())?.searchValues).toEqual(['new@example.invalid']);
    expect(await collection.countDocuments({ searchValues: null })).toBe(0);
    // An old instance may insert after the migration's cursor has completed.
    const late = await inventory({ maskedPreview: { login: 'late@example.invalid' } });
    expect((await service.list({ page: 1, limit: 20, searchMode: 'exact', search: 'late@example.invalid' })).items[0]?.id).toBe(late.toString());
    await backfillInventorySearchValues(connection);
    expect((await items.findById(late).select('+searchValues').lean())?.searchValues).toEqual(['late@example.invalid']);

    // An old instance can also change an already-backfilled preview. A full
    // post-rollout repair is required once those old invocations have drained.
    await collection.updateOne({ _id: stable }, { $set: { maskedPreview: { login: 'replaced@example.invalid' } } });
    expect((await service.list({ page: 1, limit: 20, searchMode: 'exact', search: 'replaced@example.invalid' })).total).toBe(0);
    await backfillInventorySearchValues(connection, { includeExisting: true });
    expect((await service.list({ page: 1, limit: 20, searchMode: 'exact', search: 'replaced@example.invalid' })).items[0]?.id).toBe(stable.toString());
    const repaired = await items.findById(stable).select('+searchValues').lean();
    expect(repaired?.searchValues).toEqual(['replaced@example.invalid']);
    expect(repaired?.updatedAt).toEqual(createdAt);
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
      const { result, pageStats, countStats } = await explainList({ page: 1, limit: 20, search });
      expect(result.total).toBe(matches);
      expect(pageStats.totalDocsExamined).toBeLessThanOrEqual(matches);
      expect(countStats.totalDocsExamined).toBeLessThanOrEqual(matches);
    }
  });

  test('exact search only scans matching and legacy rows; ordinary paging reads one page with covered counts', async () => {
    const otherProduct = new Types.ObjectId();
    const rows = Array.from({ length: 2_000 }, (_, index) => {
      const maskedPreview = index >= 1_900 ? {} : { login: `user-${index}@example.invalid` };
      return { _id: new Types.ObjectId(), productId: index % 3 ? productId : otherProduct,
        status: index % 2 ? 'AVAILABLE' : 'SOLD', maskedPreview, searchValues: inventorySearchValues(maskedPreview),
        payloadHash: String(index).padStart(64, '0'), deletedAt: null,
        createdAt: new Date(createdAt.getTime() + index), updatedAt: createdAt };
    });
    await items.collection.insertMany(rows);
    for (let index = 0; index < 5; index++) await inventory({ maskedPreview: {
      login: index === 0 ? 'user-17@example.invalid' : `legacy-${index}@example.invalid`,
    } });
    const exact = await explainList({ page: 1, limit: 20, searchMode: 'exact', search: 'USER-17@EXAMPLE.INVALID' });
    expect(exact.result.total).toBe(2);
    expect(exact.pageStats.totalDocsExamined).toBeLessThanOrEqual(6);
    expect(exact.countStats.totalDocsExamined).toBeLessThanOrEqual(6);
    for (const filter of [{}, { status: 'SOLD' as const }, { productId: productId.toString() },
      { productId: productId.toString(), status: 'SOLD' as const }]) {
      const { result, pageStats, countStats } = await explainList({ page: 1, limit: 20, ...filter });
      expect(result.items).toHaveLength(20);
      expect(pageStats.totalDocsExamined).toBeLessThanOrEqual(20);
      expect(countStats.totalDocsExamined).toBe(0);
    }
  });
});
