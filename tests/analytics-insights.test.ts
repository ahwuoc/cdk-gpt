import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import mongoose, { type Connection, type Model, Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AnalyticsInsightsService, insightsDateRange } from '../apps/api/src/analytics/insights.service';
import { AnalyticsInsightsQueryDto, RecordCustomerEventDto } from '../apps/api/src/analytics/insights.dto';
import { AnalyticsController } from '../apps/api/src/analytics/analytics.controller';
import { CustomerEventsController } from '../apps/api/src/analytics/customer-events.controller';
import { CustomerEventSchema, CustomerEventType, type CustomerEvent } from '../packages/database/src/schemas/customer-event.schema';
import { OrderSchema, PaymentRequestSchema, ProductSchema, UserSchema, WalletTransactionSchema,
  type Order, type PaymentRequest, type Product, type User, type WalletTransaction } from '@store/database';
import { OrderStatus, PaymentRequestStatus } from '@store/shared';
import { customerAnalyticsIndexesMigration } from '../packages/database/src/migrations/010-customer-analytics-indexes';

describe('analytics date range and event boundaries', () => {
  test('defaults to last 30 inclusive Vietnam calendar days, even at UTC date rollover', () => {
    const range = insightsDateRange({}, new Date('2026-09-20T18:00:00Z'));
    expect(range.from).toBe('2026-08-23');
    expect(range.to).toBe('2026-09-21');
    expect(range.days).toBe(30);
    expect(range.start.toISOString()).toBe('2026-08-22T17:00:00.000Z');
    expect(range.end.toISOString()).toBe('2026-09-21T17:00:00.000Z');
  });

  test('validates actual dates, strict formatting, order and maximum period', () => {
    for (const query of [
      { from: '2026-02-30', to: '2026-03-01' }, { from: 'bad' },
      { from: '2026-1-01', to: '2026-01-10' }, { from: '2026-03-02', to: '2026-03-01' },
      { from: '2025-01-01', to: '2026-01-02' }, { to: '2026-09-21T00:00:00Z' },
    ]) expect(() => insightsDateRange(query)).toThrow();
    expect(insightsDateRange({ from: '2024-01-01', to: '2024-12-31' }).days).toBe(366);
    expect(insightsDateRange({ from: '2026-09-21', to: '2026-09-21' }).days).toBe(1);
  });

  test('DTO admits only whitelisted, structured bot event data and requires product for purchase behavior', async () => {
    const valid = { telegramId: '123', updateId: 1, type: CustomerEventType.PRODUCT_VIEW, productId: new Types.ObjectId().toString() };
    expect(await validate(plainToInstance(RecordCustomerEventDto, valid))).toHaveLength(0);
    expect(await validate(plainToInstance(RecordCustomerEventDto, { telegramId: '123', updateId: 1, type: 'MENU_VIEW' }))).toHaveLength(0);
    for (const payload of [
      { ...valid, productId: undefined }, { ...valid, updateId: -1 }, { ...valid, updateId: 1.5 },
      { ...valid, type: 'PAYMENT_PAYLOAD' }, { ...valid, telegramId: '-123' }, { ...valid, telegramId: 'secret' },
      { ...valid, text: 'raw message should not be collected' }, { ...valid, createdAt: '2020-01-01' },
    ]) expect((await validate(plainToInstance(RecordCustomerEventDto, payload), { whitelist: true, forbidNonWhitelisted: true })).length).toBeGreaterThan(0);
    expect((await validate(plainToInstance(AnalyticsInsightsQueryDto, { from: '2026-09-21T12:00:00Z' }))).length).toBeGreaterThan(0);
  });

  test('admin insights requires analytics.read while bot ingestion still checks its shared secret', () => {
    expect(Reflect.getMetadata('permissions', AnalyticsController.prototype.insights)).toEqual(['analytics.read']);
    expect(Reflect.getMetadata('public-route', CustomerEventsController.prototype.record)).toBe(true);
    const method = CustomerEventsController.prototype.record;
    // Authentication happens before accessing the service, so no fake service is needed.
    expect(() => method.call(Object.create(CustomerEventsController.prototype), {
      telegramId: '123', updateId: 1, type: 'MENU_VIEW',
    }, 'invalid-secret')).toThrow('Invalid bot credential');
  });
});

const integration = process.env.RUN_INTEGRATION === '1' ? describe : describe.skip;

integration('customer growth insights against isolated MongoDB', () => {
  let server: MongoMemoryServer;
  let connection: Connection;
  let orders: Model<Order>;
  let payments: Model<PaymentRequest>;
  let users: Model<User>;
  let products: Model<Product>;
  let events: Model<CustomerEvent>;
  let walletTransactions: Model<WalletTransaction>;
  let service: AnalyticsInsightsService;
  const range = { from: '2026-09-01', to: '2026-09-03' };
  const date = (day: number, hour = 6) => new Date(`2026-09-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00Z`);

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    connection = await new mongoose.Mongoose().createConnection(server.getUri('customer_insights'), { autoIndex: false }).asPromise();
    orders = connection.model<Order>('Order', OrderSchema, 'orders');
    payments = connection.model<PaymentRequest>('PaymentRequest', PaymentRequestSchema, 'payment_requests');
    users = connection.model<User>('User', UserSchema, 'users');
    products = connection.model<Product>('Product', ProductSchema, 'products');
    events = connection.model<CustomerEvent>('CustomerEvent', CustomerEventSchema, 'customer_events');
    walletTransactions = connection.model<WalletTransaction>('WalletTransaction', WalletTransactionSchema, 'wallet_transactions');
    service = new AnalyticsInsightsService(orders, payments, users, products, events, walletTransactions);
    await customerAnalyticsIndexesMigration.up(connection);
  }, 120_000);
  beforeEach(async () => {
    await Promise.all([orders.deleteMany({}), payments.deleteMany({}), users.deleteMany({}),
      products.deleteMany({}), events.deleteMany({}), walletTransactions.deleteMany({})]);
  });
  afterAll(async () => { await connection?.close(); await server?.stop(); }, 30_000);

  async function customer(telegramId: string, createdAt = date(1)) {
    const id = new Types.ObjectId();
    await users.collection.insertOne({ _id: id, telegramId, username: `user${telegramId}`, displayName: `Customer ${telegramId}`,
      status: 'ACTIVE', walletBalance: 0, referralCode: `REFER${telegramId}`, purchaseCount: 0,
      checkoutLockVersion: 0, createdAt, updatedAt: createdAt, deletedAt: null });
    return id;
  }

  async function product(name = 'Chat account') {
    const id = new Types.ObjectId();
    await products.collection.insertOne({ _id: id, name, slug: `product-${id}`, price: 100,
      status: 'ACTIVE', deletedAt: null, description: '', warrantyDays: 0, lowStockThreshold: 1,
      purchaseLimitPerUser: 0, metadata: {}, createdAt: date(1), updatedAt: date(1) });
    return id;
  }

  async function order(userId: Types.ObjectId, productId: Types.ObjectId, overrides: Partial<Order> = {}) {
    const id = new Types.ObjectId();
    await orders.collection.insertOne({ _id: id, orderCode: `ORD-${id}`, userId, productId,
      inventoryItemId: new Types.ObjectId(), quantity: 1, unitPrice: 100, totalAmount: 100,
      status: OrderStatus.DELIVERED, paymentMethod: 'WALLET', deliveryStatus: 'DELIVERED',
      deliveredAt: date(1), createdAt: date(1), updatedAt: date(1), metadata: {}, ...overrides });
    return id;
  }

  async function payment(userId: Types.ObjectId, overrides: Partial<PaymentRequest> = {}) {
    const id = new Types.ObjectId();
    await payments.collection.insertOne({ _id: id, userId, requestCode: `PAY-${id}`, provider: 'BANK', amount: 100,
      status: PaymentRequestStatus.APPROVED, proofUrls: [], idempotencyKey: id.toString(),
      metadata: {}, createdAt: date(1), updatedAt: date(1), reviewedAt: date(1), deletedAt: null, ...overrides });
    return id;
  }

  async function deposit(userId: Types.ObjectId, referenceId: Types.ObjectId, amount: number,
    createdAt: Date, overrides: Partial<WalletTransaction> = {}) {
    const id = new Types.ObjectId();
    await walletTransactions.collection.insertOne({ _id: id, userId, amount, balanceBefore: 0, balanceAfter: amount,
      type: 'DEPOSIT', reason: 'Actual received bank transfer', referenceType: 'PAYMENT_REQUEST', referenceId,
      idempotencyKey: id.toString(), actorType: 'WEBHOOK', metadata: {}, createdAt, updatedAt: createdAt, ...overrides });
    return id;
  }

  async function event(userId: Types.ObjectId, type: CustomerEvent['type'], createdAt: Date, productId?: Types.ObjectId) {
    await events.collection.insertOne({ userId, type, createdAt, updateId: Math.floor(Math.random() * 1e9), ...(productId ? { productId } : {}) });
  }

  test('empty periods are zero-filled with no invented conversion percentages', async () => {
    const result = await service.insights(range);
    expect(result.range).toEqual({ ...range, days: 3 });
    expect(result.timeline.map((row) => [row.date, row.net])).toEqual([['2026-09-01', 0], ['2026-09-02', 0], ['2026-09-03', 0]]);
    expect(result.revenue.net).toBe(0);
    expect(result.topCustomers).toEqual([]);
    expect(result.behavior.viewToPurchaseRate).toBeNull();
    expect(result.behavior.collectionStartedAt).toBeNull();
  });

  test('recognizes only delivered net revenue at inclusive Vietnam boundaries, with legacy date fallback', async () => {
    const buyer = await customer('100');
    const item = await product();
    await order(buyer, item, { deliveredAt: new Date('2026-08-31T16:59:59.999Z'), totalAmount: 9_000 });
    await order(buyer, item, { deliveredAt: new Date('2026-08-31T17:00:00.000Z'), totalAmount: 200 });
    await order(buyer, item, { deliveredAt: new Date('2026-09-03T16:59:59.999Z'), totalAmount: 300 });
    await order(buyer, item, { deliveredAt: new Date('2026-09-03T17:00:00.000Z'), totalAmount: 9_000 });
    const legacy = await order(buyer, item, { totalAmount: 50, createdAt: date(2) });
    await orders.collection.updateOne({ _id: legacy }, { $unset: { deliveredAt: '' } });
    for (const status of [OrderStatus.REFUNDED, OrderStatus.CANCELLED, OrderStatus.PENDING_DELIVERY, OrderStatus.DELIVERY_FAILED]) {
      await order(buyer, item, { totalAmount: 9_000, status });
    }
    const result = await service.insights(range);
    expect(result.revenue.net).toBe(550);
    expect(result.revenue.orderCount).toBe(3);
    expect(result.timeline.map((row) => row.net)).toEqual([200, 50, 300]);
    expect(result.behavior.returningBuyers).toBe(1);
    expect(result.behavior.newBuyers).toBe(0);
  });

  test('ranks real spend instead of deposits and groups wallet/QR purchases independently of inventory count', async () => {
    const richDepositor = await customer('100');
    const buyer = await customer('200');
    const item = await product();
    const group = new Types.ObjectId().toString();
    const topup = await payment(richDepositor, { amount: 1_000_000 });
    await deposit(richDepositor, topup, 1_000_000, date(1));
    await order(richDepositor, item, { totalAmount: 60, grossAmount: 100, discountAmount: 40 });
    for (let index = 0; index < 3; index += 1) {
      await order(buyer, item, { totalAmount: 80, grossAmount: 100, discountAmount: 20,
        metadata: { paymentRequestId: group }, paymentMethod: 'BANK_TRANSFER' });
    }
    await order(buyer, item, { totalAmount: 80, discountAmount: 20, metadata: { purchaseGroupId: 'wallet-batch' } });
    await order(buyer, item, { totalAmount: 80, discountAmount: 20, metadata: { purchaseGroupId: 'wallet-batch' } });
    const result = await service.insights(range);
    expect(result.revenue).toEqual({ net: 460, gross: 600, discount: 140, purchaseCount: 3,
      orderCount: 6, quantity: 6, buyers: 2, averagePurchaseValue: 460 / 3 });
    expect(result.topCustomers.map((row) => [row.userId, row.totalSpent, row.purchaseCount, row.quantity]))
      .toEqual([[buyer.toString(), 400, 2, 5], [richDepositor.toString(), 60, 1, 1]]);
    expect(result.topCustomers[0]?.username).toBe('user200');
    expect(result.topProducts[0]).toMatchObject({ productId: item.toString(), name: 'Chat account', revenue: 460, quantity: 6, buyers: 2, purchaseCount: 3 });
    expect(result.behavior.repeatBuyers).toBe(1);
    expect(result.deposits).toEqual({ amount: 1_000_000, count: 1 });
  });

  test('deposit totals preserve actual overpayments and archived credits but exclude QR and uncredited intentions', async () => {
    const buyer = await customer('100');
    const overpaid = await payment(buyer, { amount: 100, metadata: { amountMismatch: { expected: 100, received: 150 } } });
    await deposit(buyer, overpaid, 150, date(1));
    const regular = await payment(buyer, { amount: 50, reviewedAt: date(3) });
    await deposit(buyer, regular, 50, date(3));
    const quickCheckout = await payment(buyer, { amount: 999, metadata: { quickCheckout: { productId: new Types.ObjectId().toString() } } });
    await deposit(buyer, quickCheckout, 999, date(1));
    await deposit(buyer, quickCheckout, 999, date(2), { metadata: { supplemental: true } });
    await payment(buyer, { amount: 999, status: PaymentRequestStatus.PENDING });
    await payment(buyer, { amount: 999 }); // Legacy APPROVED flag without a ledger is not proof of received money.
    const archived = await payment(buyer, { amount: 30, deletedAt: date(2) });
    await deposit(buyer, archived, 30, date(1));
    const outside = await payment(buyer, { amount: 999 });
    await deposit(buyer, outside, 999, date(4));
    await deposit(buyer, new Types.ObjectId(), 999, date(1)); // Cannot classify an orphan reference as a non-QR topup.
    await deposit(buyer, regular, 999, date(1), { type: 'REFUND' });
    await deposit(buyer, regular, 999, date(1), { referenceType: 'MANUAL' });
    const result = await service.insights(range);
    expect(result.deposits).toEqual({ amount: 230, count: 3 });
    expect(result.revenue.net).toBe(0);
    expect(result.topCustomers).toHaveLength(0);
  });

  test('deposit KPI counts actual partial and supplemental credits on their own Vietnam ledger dates', async () => {
    const buyer = await customer('100');
    const request = await payment(buyer, { amount: 100,
      metadata: { amountMismatch: { expected: 100, received: 60 } } });
    await deposit(buyer, request, 60, new Date('2026-09-01T16:59:59.999Z'));
    await deposit(buyer, request, 40, new Date('2026-09-01T17:00:00.000Z'), { metadata: { supplemental: true } });

    const first = await service.insights({ from: '2026-09-01', to: '2026-09-01' });
    const second = await service.insights({ from: '2026-09-02', to: '2026-09-02' });
    const combined = await service.insights({ from: '2026-09-01', to: '2026-09-02' });
    expect([first.deposits, second.deposits, combined.deposits]).toEqual([
      { amount: 60, count: 1 }, { amount: 40, count: 1 }, { amount: 100, count: 2 },
    ]);
  });

  test('behavior uses unique users and chronological same-period conversions without faking historical views', async () => {
    const converter = await customer('100');
    const browser = await customer('200');
    const oldBuyer = await customer('300', new Date('2026-08-01'));
    const historicalOnly = await customer('400');
    const item = await product();
    await event(converter, 'PRODUCT_VIEW', date(1, 1), item);
    await event(converter, 'PRODUCT_VIEW', date(1, 2), item);
    await event(converter, 'CHECKOUT_START', date(1, 3), item);
    await event(browser, 'MENU_VIEW', date(1));
    await event(browser, 'PRODUCT_VIEW', date(2), item);
    await event(oldBuyer, 'PRODUCT_VIEW', date(3), item); // Its order is before this view: not a conversion.
    await event(oldBuyer, 'CHECKOUT_START', date(3), item);
    await order(converter, item, { deliveredAt: date(1, 4) });
    await order(oldBuyer, item, { deliveredAt: date(1) });
    await order(oldBuyer, item, { deliveredAt: new Date('2026-08-01') });
    await order(historicalOnly, item, { deliveredAt: date(2) });
    const result = await service.insights(range);
    expect(result.behavior).toMatchObject({ productViewers: 3, checkoutStarters: 2, buyers: 3,
      viewerBuyers: 1, checkoutBuyers: 1, checkoutToPurchaseRate: 50, activeUsers: 4,
      newCustomers: 3, newBuyers: 2, returningBuyers: 1, repeatBuyers: 0, eventsInRange: 7 });
    expect(result.behavior.viewToPurchaseRate).toBeCloseTo(100 / 3);
    expect(result.behavior.collectionStartedAt?.toISOString()).toBe(date(1, 1).toISOString());
    expect(result.notes.some((note) => note.includes('không suy diễn lịch sử'))).toBe(true);
  });

  test('abandoned checkouts count only expired unpaid purchase QR created in the selected period', async () => {
    const buyer = await customer('100');
    const quickCheckout = { productId: new Types.ObjectId().toString(), quantity: 1 };
    const expired = { quickCheckout, expiresAt: '2026-09-01T07:00:00.000Z' };
    await payment(buyer, { amount: 100, status: PaymentRequestStatus.EXPIRED, metadata: expired });
    await payment(buyer, { amount: 200, status: PaymentRequestStatus.PENDING, metadata: expired });
    await payment(buyer, { amount: 999, status: PaymentRequestStatus.APPROVED, metadata: expired });
    await payment(buyer, { amount: 999, status: PaymentRequestStatus.REJECTED, metadata: expired });
    await payment(buyer, { amount: 999, status: PaymentRequestStatus.PENDING,
      metadata: { quickCheckout, expiresAt: '2099-01-01T00:00:00.000Z' } });
    await payment(buyer, { amount: 999, status: PaymentRequestStatus.EXPIRED, metadata: {} });
    await payment(buyer, { amount: 999, status: PaymentRequestStatus.EXPIRED, metadata: expired, createdAt: date(4) });
    const result = await service.insights(range);
    expect(result.behavior.abandonedCheckouts).toBe(2);
    expect(result.behavior.abandonedCheckoutAmount).toBe(300);
  });

  test('event ingestion is idempotent under races, server-timestamped and contains no free-form data', async () => {
    await customer('100');
    const item = await product();
    const input = { telegramId: '100', updateId: 123, type: CustomerEventType.PRODUCT_VIEW, productId: item.toString() };
    const before = new Date();
    const results = await Promise.all(Array.from({ length: 8 }, () => service.recordEvent(input)));
    expect(results.filter((result) => result.recorded)).toHaveLength(1);
    expect(await events.countDocuments()).toBe(1);
    const stored = await events.findOne().lean();
    expect(stored!.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(stored!.createdAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect(Object.keys(stored!).sort()).toEqual(['_id', 'createdAt', 'productId', 'type', 'updateId', 'userId']);
    expect(await service.recordEvent({ ...input, type: CustomerEventType.CHECKOUT_START })).toEqual({ recorded: true });
    const unchanged = await events.findById(stored!._id).lean();
    expect(unchanged!.createdAt).toEqual(stored!.createdAt);
  });

  test('ingestion rejects nonexistent/inactive customers, nonexistent products and incomplete event inputs', async () => {
    const id = await customer('100');
    const item = await product();
    await expect(service.recordEvent({ telegramId: '999', updateId: 1, type: 'MENU_VIEW' })).rejects.toThrow('Customer not found');
    await expect(service.recordEvent({ telegramId: '100', updateId: 1, type: 'PRODUCT_VIEW' })).rejects.toThrow('Invalid customer event');
    await expect(service.recordEvent({ telegramId: '100', updateId: 1, type: 'PRODUCT_VIEW', productId: new Types.ObjectId().toString() })).rejects.toThrow('Product not found');
    await users.updateOne({ _id: id }, { $set: { status: 'BLOCKED' } });
    await expect(service.recordEvent({ telegramId: '100', updateId: 1, type: 'PRODUCT_VIEW', productId: item.toString() })).rejects.toThrow('Customer not found');
    expect(await events.countDocuments()).toBe(0);
  });

  test('top lists are bounded and keep sales of removed identities without exposing other account data', async () => {
    for (let index = 1; index <= 22; index += 1) {
      const buyer = await customer(String(index));
      const item = await product(`Product ${index}`);
      await order(buyer, item, { totalAmount: index });
      if (index === 22) {
        await users.deleteOne({ _id: buyer });
        await products.deleteOne({ _id: item });
      }
    }
    const result = await service.insights(range);
    expect(result.topCustomers).toHaveLength(20);
    expect(result.topProducts).toHaveLength(20);
    expect(result.topCustomers[0]?.totalSpent).toBe(22);
    expect(result.topCustomers[0]?.telegramId).toBeNull();
    expect(result.topProducts[0]?.name).toBe('Sản phẩm đã xóa');
    expect(result.revenue.buyers).toBe(22);
    expect(result.revenue.net).toBe(253);
  });

  test('analytics index migration is repeatable and installed against canonical collection names', async () => {
    await customerAnalyticsIndexesMigration.up(connection);
    expect((await events.collection.indexes()).map((index) => index.name)).toContain('customer_event_period_type_user');
    expect((await orders.collection.indexes()).map((index) => index.name)).toContain('analytics_buyer_delivered');
    expect((await payments.collection.indexes()).map((index) => index.name)).toContain('analytics_deposit_period');
    expect((await walletTransactions.collection.indexes()).map((index) => index.name)).toContain('analytics_deposit_ledger_period');
  });
});
