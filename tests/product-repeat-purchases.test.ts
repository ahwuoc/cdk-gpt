import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import mongoose, { type Connection, type Model, Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { OrderSchema, ProductSchema, UserSchema, type Order, type Product, type User } from '@store/database';
import { OrderStatus } from '@store/shared';
import { AnalyticsController } from '../apps/api/src/analytics/analytics.controller';
import { ProductRepeatPurchasesQueryDto } from '../apps/api/src/analytics/product-repeat-purchases.dto';
import { ProductRepeatPurchasesService } from '../apps/api/src/analytics/product-repeat-purchases.service';

describe('product repeat-purchase query boundaries', () => {
  test('transforms query strings and validates threshold, product identity, dates, and pagination', async () => {
    const defaults = plainToInstance(ProductRepeatPurchasesQueryDto, {});
    expect(defaults).toMatchObject({ days: 2, page: 1, limit: 20 });
    expect(await validate(defaults)).toHaveLength(0);
    const valid = plainToInstance(ProductRepeatPurchasesQueryDto, {
      from: '2026-09-01', to: '2026-09-30', days: '3', page: '2', limit: '100', productId: new Types.ObjectId().toString(),
    });
    expect(valid).toMatchObject({ days: 3, page: 2, limit: 100 });
    expect(await validate(valid)).toHaveLength(0);
    for (const payload of [
      { days: '1' }, { days: '4' }, { days: '2.5' }, { productId: 'bad' }, { productId: '' },
      { page: '0' }, { page: '1.5' }, { page: Number.MAX_SAFE_INTEGER + 1 },
      { limit: '0' }, { limit: '101' }, { from: '2026-09-01T00:00:00Z' }, { to: 'bad' },
      { unexpected: 'field' },
    ]) expect((await validate(plainToInstance(ProductRepeatPurchasesQueryDto, payload), {
      whitelist: true, forbidNonWhitelisted: true,
    })).length).toBeGreaterThan(0);
  });

  test('service rejects invalid dates and unsafe direct inputs before querying MongoDB', async () => {
    const report = ProductRepeatPurchasesService.prototype.report;
    const receiver = Object.create(ProductRepeatPurchasesService.prototype);
    for (const payload of [
      { from: '2026-02-30', to: '2026-03-01' }, { from: '2026-09-03', to: '2026-09-01' },
      { from: '2025-01-01', to: '2026-01-02' }, { days: 4 }, { days: 2.5 },
      { page: 0 }, { page: 1.5 }, { page: Number.MAX_SAFE_INTEGER, limit: 100 },
      { limit: 0 }, { limit: 101 }, { productId: '' }, { productId: 'not-an-object-id' },
    ]) await expect(report.call(receiver, plainToInstance(ProductRepeatPurchasesQueryDto, payload))).rejects.toThrow();
  });

  test('the endpoint requires analytics.read and is not public', () => {
    expect(Reflect.getMetadata('permissions', AnalyticsController.prototype.repeatPurchases)).toEqual(['analytics.read']);
    expect(Reflect.getMetadata('public-route', AnalyticsController.prototype.repeatPurchases)).not.toBe(true);
    expect(Reflect.getMetadata('path', AnalyticsController.prototype.repeatPurchases)).toBe('analytics/product-repeat-purchases');
  });
});

const integration = process.env.RUN_INTEGRATION === '1' ? describe : describe.skip;

integration('product repeat purchases against isolated MongoDB', () => {
  let server: MongoMemoryServer;
  let connection: Connection;
  let orders: Model<Order>;
  let products: Model<Product>;
  let users: Model<User>;
  let service: ProductRepeatPurchasesService;
  const range = { from: '2026-09-01', to: '2026-09-07' };
  const date = (day: number) => new Date(`2026-09-${String(day).padStart(2, '0')}T06:00:00.000Z`);

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    connection = await new mongoose.Mongoose().createConnection(server.getUri('product_repeat_purchases'), { autoIndex: false }).asPromise();
    orders = connection.model<Order>('Order', OrderSchema, 'orders');
    products = connection.model<Product>('Product', ProductSchema, 'products');
    users = connection.model<User>('User', UserSchema, 'users');
    service = new ProductRepeatPurchasesService(orders);
  }, 120_000);

  beforeEach(async () => { await Promise.all([orders.deleteMany({}), products.deleteMany({}), users.deleteMany({})]); });
  afterAll(async () => { await connection?.close(); await server?.stop(); }, 30_000);

  async function customer(index: number) {
    const id = new Types.ObjectId(index.toString(16).padStart(24, '0'));
    await users.collection.insertOne({ _id: id, telegramId: String(index), username: `buyer${index}`, displayName: `Buyer ${index}`,
      status: 'ACTIVE', walletBalance: 99_999, referralCode: `REFER${index}`, purchaseCount: 0,
      checkoutLockVersion: 0, createdAt: date(1), updatedAt: date(1), deletedAt: null });
    return id;
  }

  async function product(name = 'Chat account', index?: number) {
    const id = index === undefined ? new Types.ObjectId() : new Types.ObjectId(index.toString(16).padStart(24, '0'));
    await products.collection.insertOne({ _id: id, name, slug: `product-${id}`, price: 100,
      status: 'ACTIVE', deletedAt: null, description: '', warrantyDays: 0, lowStockThreshold: 1,
      purchaseLimitPerUser: 0, metadata: {}, createdAt: date(1), updatedAt: date(1) });
    return id;
  }

  async function order(userId: Types.ObjectId, productId: Types.ObjectId, day: number, overrides: Partial<Order> = {}) {
    const id = new Types.ObjectId();
    await orders.collection.insertOne({ _id: id, orderCode: `ORD-${id}`, userId, productId,
      inventoryItemId: new Types.ObjectId(), quantity: 1, unitPrice: 100, totalAmount: 100,
      status: OrderStatus.DELIVERED, paymentMethod: 'WALLET', deliveryStatus: 'DELIVERED',
      deliveredAt: date(20), createdAt: date(day), updatedAt: date(20), metadata: {}, ...overrides });
    return id;
  }

  test('empty periods return zero counts, null rate, defaults, and no fabricated customers', async () => {
    const result = await service.report(range);
    expect(result).toEqual({
      range: { ...range, days: 7 }, timezone: 'Asia/Ho_Chi_Minh', days: 2,
      summary: { buyers: 0, repeatBuyers: 0, repeatRate: null }, products: [], items: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    });
  });

  test('a three-day streak qualifies for both thresholds while gaps and same-day purchases do not', async () => {
    const daily = await customer(1);
    const skippedDay = await customer(2);
    const sameDay = await customer(3);
    const single = await customer(4);
    const item = await product();
    for (const day of [1, 2, 3]) await order(daily, item, day);
    for (const day of [1, 3]) await order(skippedDay, item, day);
    for (let index = 0; index < 3; index++) await order(sameDay, item, 2);
    await order(single, item, 1);

    for (const days of [2, 3] as const) {
      const result = await service.report({ ...range, days });
      expect(result.summary).toEqual({ buyers: 4, repeatBuyers: 1, repeatRate: 25 });
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toEqual({ userId: daily.toString(), telegramId: '1', username: 'buyer1', displayName: 'Buyer 1',
        productId: item.toString(), productName: 'Chat account', purchaseCount: 3, quantity: 3, totalSpent: 300,
        purchaseDays: ['2026-09-01', '2026-09-02', '2026-09-03'], longestStreak: 3,
        streakFrom: '2026-09-01', streakTo: '2026-09-03', lastPurchaseAt: date(3) });
    }
    const shortened = await service.report({ from: range.from, to: '2026-09-02', days: 3 });
    expect(shortened.summary).toEqual({ buyers: 4, repeatBuyers: 0, repeatRate: 0 });
    expect(shortened.items).toEqual([]);
  });

  test('days are scoped to one customer and one product, not combined across either', async () => {
    const first = await customer(1);
    const second = await customer(2);
    const firstItem = await product('First');
    const secondItem = await product('Second');
    await order(first, firstItem, 1);
    await order(first, secondItem, 2);
    await order(second, firstItem, 2);
    const result = await service.report(range);
    expect(result.summary).toEqual({ buyers: 2, repeatBuyers: 0, repeatRate: 0 });
    expect(result.items).toEqual([]);
  });

  test('groups QR and wallet batches once per customer/product and keeps net spend and every unit', async () => {
    const first = await customer(1);
    const second = await customer(2);
    const item = await product('First');
    const otherItem = await product('Second');
    const qr = { paymentRequestId: new Types.ObjectId().toString() };
    const wallet = { purchaseGroupId: 'wallet-batch' };
    await order(first, item, 1, { metadata: { ...qr, purchaseGroupId: 'ignored-group-1' }, totalAmount: 50, grossAmount: 100, discountAmount: 50 });
    await order(first, item, 1, { metadata: { ...qr, purchaseGroupId: 'ignored-group-2' }, deliveredAt: date(2) });
    await order(first, item, 2, { metadata: wallet });
    await order(first, item, 2, { metadata: wallet, deliveredAt: date(3) });
    await order(second, item, 1, { metadata: qr });
    await order(second, item, 2, { metadata: wallet });
    await order(first, otherItem, 1, { metadata: qr });
    await order(first, otherItem, 2, { metadata: wallet });

    const result = await service.report(range);
    expect(result.summary).toEqual({ buyers: 2, repeatBuyers: 2, repeatRate: 100 });
    expect(result.pagination.total).toBe(3);
    expect(result.items[0]).toMatchObject({ userId: first.toString(), productId: item.toString(),
      purchaseCount: 2, quantity: 4, totalSpent: 350, purchaseDays: ['2026-09-01', '2026-09-02'], longestStreak: 2 });
    expect(result.items.every((row) => row.purchaseCount === 2)).toBe(true);
  });

  test('one checkout delivered on different days and multiple checkouts on one day do not create consecutive purchases', async () => {
    const buyer = await customer(1);
    const item = await product();
    const metadata = { paymentRequestId: new Types.ObjectId().toString() };
    for (const day of [1, 2, 3]) await order(buyer, item, 1, { metadata, deliveredAt: date(day) });
    await order(buyer, item, 1);
    const result = await service.report(range);
    expect(result.summary).toEqual({ buyers: 1, repeatBuyers: 0, repeatRate: 0 });
    expect(result.items).toEqual([]);
  });

  test('uses Vietnam purchase dates at both inclusive boundaries regardless of delivery time', async () => {
    const buyer = await customer(1);
    const item = await product();
    await order(buyer, item, 1, { createdAt: new Date('2026-08-31T16:59:59.999Z'), totalAmount: 9_999 });
    await order(buyer, item, 1, { createdAt: new Date('2026-08-31T17:00:00.000Z') });
    const last = new Date('2026-09-02T16:59:59.999Z');
    await order(buyer, item, 2, { createdAt: last });
    await order(buyer, item, 3, { createdAt: new Date('2026-09-02T17:00:00.000Z'), totalAmount: 9_999 });
    const result = await service.report({ from: range.from, to: '2026-09-02' });
    expect(result.items[0]).toMatchObject({ purchaseCount: 2, totalSpent: 200,
      purchaseDays: ['2026-09-01', '2026-09-02'], longestStreak: 2, lastPurchaseAt: last });
  });

  test('midnight one millisecond apart is consecutive days, not an elapsed 48-hour interval', async () => {
    const buyer = await customer(1);
    const item = await product();
    await order(buyer, item, 1, { createdAt: new Date('2026-09-01T16:59:59.999Z') });
    await order(buyer, item, 1, { createdAt: new Date('2026-09-01T17:00:00.000Z') });
    expect((await service.report(range)).items[0]).toMatchObject({ longestStreak: 2,
      purchaseDays: ['2026-09-01', '2026-09-02'] });
  });

  test('cancelled, refunded, pending, delivering, and failed orders cannot bridge a missing purchase day', async () => {
    const buyer = await customer(1);
    const item = await product();
    await order(buyer, item, 1);
    await order(buyer, item, 3);
    for (const status of [OrderStatus.CANCELLED, OrderStatus.REFUNDED, OrderStatus.PENDING_DELIVERY,
      OrderStatus.DELIVERING, OrderStatus.DELIVERY_FAILED]) await order(buyer, item, 2, { status });
    expect((await service.report(range)).summary).toEqual({ buyers: 1, repeatBuyers: 0, repeatRate: 0 });
  });

  test('a batch beginning before the date range is wholly excluded even if a later unit was created in the range', async () => {
    const buyer = await customer(1);
    const item = await product();
    const metadata = { purchaseGroupId: 'cross-start-boundary' };
    await order(buyer, item, 1, { metadata, createdAt: new Date('2026-09-01T16:59:59.999Z'), totalAmount: 9_000 });
    await order(buyer, item, 2, { metadata, createdAt: new Date('2026-09-01T17:00:00.000Z'), totalAmount: 9_000 });
    await order(buyer, item, 2);
    await order(buyer, item, 3);
    const result = await service.report({ from: '2026-09-02', to: '2026-09-03' });
    expect(result.items[0]).toMatchObject({ purchaseCount: 2, quantity: 2, totalSpent: 200,
      purchaseDays: ['2026-09-02', '2026-09-03'] });
  });

  test('a batch beginning inside the range retains units created after the upper boundary', async () => {
    const buyer = await customer(1);
    const item = await product();
    const metadata = { paymentRequestId: new Types.ObjectId().toString() };
    await order(buyer, item, 1);
    await order(buyer, item, 2, { metadata, createdAt: new Date('2026-09-02T16:59:59.999Z'), totalAmount: 200 });
    await order(buyer, item, 3, { metadata, createdAt: new Date('2026-09-02T17:00:00.000Z'), totalAmount: 300 });
    const result = await service.report({ from: range.from, to: '2026-09-02' });
    expect(result.items[0]).toMatchObject({ purchaseCount: 2, quantity: 3, totalSpent: 600,
      purchaseDays: ['2026-09-01', '2026-09-02'], lastPurchaseAt: new Date('2026-09-02T16:59:59.999Z') });
  });

  test('a non-delivered first unit fixes the checkout date while only delivered units count toward successful purchases', async () => {
    const buyer = await customer(1);
    const item = await product();
    const metadata = { purchaseGroupId: 'partial-checkout-crossing-midnight' };
    const first = await order(buyer, item, 1, { metadata, createdAt: new Date('2026-09-01T16:59:59.999Z'),
      status: OrderStatus.PENDING_DELIVERY, totalAmount: 9_000 });
    await order(buyer, item, 2, { metadata, createdAt: new Date('2026-09-01T17:00:00.000Z'), totalAmount: 200 });
    await order(buyer, item, 3);

    // The successful checkout belongs to day 1, leaving a gap before day 3.
    for (const status of [OrderStatus.PENDING_DELIVERY, OrderStatus.DELIVERY_FAILED, OrderStatus.REFUNDED, OrderStatus.DELIVERED]) {
      await orders.updateOne({ _id: first }, { $set: { status } });
      expect((await service.report(range)).summary).toEqual({ buyers: 1, repeatBuyers: 0, repeatRate: 0 });
      expect((await service.report({ from: '2026-09-02', to: '2026-09-03' })).items).toEqual([]);
    }

    await orders.updateOne({ _id: first }, { $set: { status: OrderStatus.REFUNDED } });
    await order(buyer, item, 2, { totalAmount: 300 });
    const result = await service.report(range);
    expect(result.items[0]).toMatchObject({ longestStreak: 3, purchaseCount: 3, quantity: 3, totalSpent: 600,
      purchaseDays: ['2026-09-01', '2026-09-02', '2026-09-03'] });
  });

  test('reports the earliest longest run when separate consecutive runs tie', async () => {
    const buyer = await customer(1);
    const item = await product();
    for (const day of [1, 2, 4, 5, 7]) await order(buyer, item, day);
    const result = await service.report(range);
    expect(result.items[0]).toMatchObject({ longestStreak: 2, streakFrom: '2026-09-01', streakTo: '2026-09-02',
      purchaseCount: 5, purchaseDays: ['2026-09-01', '2026-09-02', '2026-09-04', '2026-09-05', '2026-09-07'] });
    expect((await service.report({ ...range, days: 3 })).items).toEqual([]);
  });

  test('paginates customer-product pairs stably by longest run, spend, customer ID, then product ID', async () => {
    const first = await customer(1);
    const second = await customer(2);
    const highSpender = await customer(4);
    const longest = await customer(5);
    const firstItem = await product('First', 10);
    const secondItem = await product('Second', 11);
    for (const day of [1, 2]) {
      await order(first, firstItem, day);
      await order(first, secondItem, day);
      await order(second, firstItem, day);
      await order(highSpender, firstItem, day, { totalAmount: 500 });
      await order(longest, firstItem, day, { totalAmount: 10 });
    }
    await order(longest, firstItem, 3, { totalAmount: 10 });
    const pages = await Promise.all([1, 2, 3, 4].map((page) => service.report({ ...range, page, limit: 2 })));
    expect(pages.map((result) => result.items.map((row) => [row.userId, row.productId]))).toEqual([
      [[longest.toString(), firstItem.toString()], [highSpender.toString(), firstItem.toString()]],
      [[first.toString(), firstItem.toString()], [first.toString(), secondItem.toString()]],
      [[second.toString(), firstItem.toString()]], [],
    ]);
    for (const result of pages) {
      expect(result.pagination).toMatchObject({ limit: 2, total: 5, totalPages: 3 });
      expect(result.summary).toEqual({ buyers: 4, repeatBuyers: 4, repeatRate: 100 });
    }
    const filtered = await service.report({ ...range, productId: secondItem.toString() });
    expect(filtered.summary).toEqual({ buyers: 1, repeatBuyers: 1, repeatRate: 100 });
    expect(filtered.items).toHaveLength(1);
    expect(filtered.products.map(({ productId }) => productId)).toEqual([firstItem.toString(), secondItem.toString()]);
  });

  test('product options include more than twenty products and remain available with an empty selected product', async () => {
    const buyer = await customer(1);
    const productIds: Types.ObjectId[] = [];
    for (let index = 0; index < 22; index++) {
      const item = await product(`Product ${String(index).padStart(2, '0')}`);
      productIds.push(item);
      await order(buyer, item, 1);
    }
    const result = await service.report({ ...range, productId: new Types.ObjectId().toString() });
    expect(result.products.map(({ productId }) => productId)).toEqual(productIds.map((id) => id.toString()));
    expect(result.summary).toEqual({ buyers: 0, repeatBuyers: 0, repeatRate: null });
    expect(result.items).toEqual([]);
  });

  test('missing customer and product records retain historical purchases with safe identity fallbacks', async () => {
    const buyer = await customer(1);
    const item = await product();
    await order(buyer, item, 1);
    await order(buyer, item, 2);
    await users.deleteOne({ _id: buyer });
    await products.deleteOne({ _id: item });
    const result = await service.report(range);
    expect(result.items[0]).toMatchObject({ userId: buyer.toString(), productId: item.toString(),
      telegramId: null, username: null, displayName: null, productName: 'Sản phẩm đã xóa', longestStreak: 2 });
    expect(result.products).toEqual([{ productId: item.toString(), name: 'Sản phẩm đã xóa' }]);
    expect(result.summary).toEqual({ buyers: 1, repeatBuyers: 1, repeatRate: 100 });
  });
});
