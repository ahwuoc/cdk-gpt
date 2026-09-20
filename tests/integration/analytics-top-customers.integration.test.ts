import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import mongoose, { type Connection, type Model, Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { AnalyticsInsightsService } from '../../apps/api/src/analytics/insights.service';
import {
  OrderSchema, PaymentRequestSchema, ProductSchema, UserSchema, WalletTransactionSchema,
  type Order, type PaymentRequest, type Product, type User,
} from '@store/database';
import { OrderStatus } from '@store/shared';
import {
  CustomerEventSchema, type CustomerEvent,
} from '../../packages/database/src/schemas/customer-event.schema';

const integration = process.env.RUN_INTEGRATION === '1' ? describe : describe.skip;

integration('top spending customers against isolated MongoDB', () => {
  let server: MongoMemoryServer;
  let connection: Connection;
  let orders: Model<Order>;
  let payments: Model<PaymentRequest>;
  let users: Model<User>;
  let products: Model<Product>;
  let events: Model<CustomerEvent>;
  let service: AnalyticsInsightsService;
  const productId = new Types.ObjectId();
  const range = { from: '2026-09-01', to: '2026-09-02' };
  const firstDay = new Date('2026-09-01T06:00:00.000Z');
  const secondDay = new Date('2026-09-02T06:00:00.000Z');

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    connection = await new mongoose.Mongoose().createConnection(server.getUri('top_customers'), {
      autoIndex: false,
    }).asPromise();
    orders = connection.model<Order>('Order', OrderSchema, 'orders');
    payments = connection.model<PaymentRequest>('PaymentRequest', PaymentRequestSchema, 'payment_requests');
    users = connection.model<User>('User', UserSchema, 'users');
    products = connection.model<Product>('Product', ProductSchema, 'products');
    events = connection.model<CustomerEvent>('CustomerEvent', CustomerEventSchema, 'customer_events');
    service = new AnalyticsInsightsService(orders, payments, users, products, events,
      connection.model('WalletTransaction', WalletTransactionSchema, 'wallet_transactions'));
  }, 120_000);

  beforeEach(async () => {
    await Promise.all([
      orders.deleteMany({}), payments.deleteMany({}), users.deleteMany({}),
      products.deleteMany({}), events.deleteMany({}),
    ]);
  });

  afterAll(async () => {
    await connection?.close();
    await server?.stop();
  }, 30_000);

  async function customer(index: number) {
    const id = new Types.ObjectId(index.toString(16).padStart(24, '0'));
    await users.collection.insertOne({
      _id: id, telegramId: String(index), username: `buyer${index}`, displayName: `Buyer ${index}`,
      status: 'ACTIVE', walletBalance: 0, referralCode: `REFER${index}`, purchaseCount: 0,
      checkoutLockVersion: 0, createdAt: firstDay, updatedAt: firstDay, deletedAt: null,
    });
    return id;
  }

  async function order(userId: Types.ObjectId, totalAmount: number, overrides: Partial<Order> = {}) {
    const id = new Types.ObjectId();
    await orders.collection.insertOne({
      _id: id, orderCode: `ORD-${id}`, userId, productId, inventoryItemId: new Types.ObjectId(),
      quantity: 1, unitPrice: totalAmount, totalAmount,
      status: OrderStatus.DELIVERED, paymentMethod: 'WALLET', deliveryStatus: 'SENT',
      deliveredAt: firstDay, createdAt: firstDay, updatedAt: firstDay, metadata: {}, ...overrides,
    });
    return id;
  }

  test('ranks net spend descending and resolves equal totals by purchase count then stable customer ID', async () => {
    const firstSingleBuyer = await customer(1);
    const secondSingleBuyer = await customer(2);
    const repeatBuyer = await customer(3);
    const discountedBuyer = await customer(4);
    await order(secondSingleBuyer, 300);
    await order(discountedBuyer, 100, { grossAmount: 1_000, discountAmount: 900 });
    await order(repeatBuyer, 150);
    await order(firstSingleBuyer, 300);
    await order(repeatBuyer, 150, { deliveredAt: secondDay });

    const result = await service.insights(range);

    expect(result.topCustomers.map(({ rank, userId, totalSpent, purchaseCount }) => ({
      rank, userId, totalSpent, purchaseCount,
    }))).toEqual([
      { rank: 1, userId: repeatBuyer.toString(), totalSpent: 300, purchaseCount: 2 },
      { rank: 2, userId: firstSingleBuyer.toString(), totalSpent: 300, purchaseCount: 1 },
      { rank: 3, userId: secondSingleBuyer.toString(), totalSpent: 300, purchaseCount: 1 },
      { rank: 4, userId: discountedBuyer.toString(), totalSpent: 100, purchaseCount: 1 },
    ]);
    expect(result.topCustomers[0]).toMatchObject({
      telegramId: '3', username: 'buyer3', displayName: 'Buyer 3', lastPurchaseAt: secondDay,
    });
  });

  test('uses inclusive Vietnam delivery dates and keeps cancelled, refunded and pending customers out of the ranking', async () => {
    const buyer = await customer(1);
    const excludedBuyer = await customer(2);
    const beginning = new Date('2026-08-31T17:00:00.000Z');
    const lastMillisecond = new Date('2026-09-01T16:59:59.999Z');
    await order(buyer, 50, { deliveredAt: beginning, createdAt: new Date('2026-08-01T00:00:00.000Z') });
    await order(buyer, 150, { deliveredAt: lastMillisecond });
    await order(buyer, 9_999, { deliveredAt: new Date('2026-08-31T16:59:59.999Z') });
    await order(buyer, 9_999, { deliveredAt: new Date('2026-09-01T17:00:00.000Z') });
    const legacy = await order(buyer, 25);
    await orders.collection.updateOne({ _id: legacy }, { $unset: { deliveredAt: '' } });
    for (const status of [OrderStatus.CANCELLED, OrderStatus.REFUNDED, OrderStatus.PENDING_DELIVERY, OrderStatus.DELIVERY_FAILED]) {
      await order(excludedBuyer, 99_999, { status });
    }

    const result = await service.insights({ from: range.from, to: range.from });

    expect(result.topCustomers).toHaveLength(1);
    expect(result.topCustomers[0]).toMatchObject({
      rank: 1, userId: buyer.toString(), totalSpent: 225, purchaseCount: 3,
      orderCount: 3, quantity: 3, lastPurchaseAt: lastMillisecond,
    });
    expect(result.timeline).toMatchObject([{ date: '2026-09-01', net: 225 }]);
  });

  test('counts a QR purchase once across delivery days while retaining every order amount and each buyer', async () => {
    const buyer = await customer(1);
    const otherBuyer = await customer(2);
    const qr = { paymentRequestId: new Types.ObjectId().toString() };
    const secondQr = { paymentRequestId: new Types.ObjectId().toString() };
    const wallet = { purchaseGroupId: 'wallet-purchase' };
    await order(buyer, 80, { metadata: qr, paymentMethod: 'BANK_TRANSFER' });
    await order(buyer, 120, { metadata: qr, paymentMethod: 'BANK_TRANSFER', deliveredAt: secondDay });
    await order(buyer, 50, { metadata: secondQr, paymentMethod: 'BANK_TRANSFER', deliveredAt: secondDay });
    await order(buyer, 70, { metadata: wallet });
    await order(buyer, 80, { metadata: wallet, deliveredAt: secondDay });
    await order(otherBuyer, 40, { metadata: qr, paymentMethod: 'BANK_TRANSFER', deliveredAt: secondDay });

    const result = await service.insights(range);

    expect(result.topCustomers.map(({ userId, totalSpent, purchaseCount, orderCount, quantity }) => ({
      userId, totalSpent, purchaseCount, orderCount, quantity,
    }))).toEqual([
      { userId: buyer.toString(), totalSpent: 400, purchaseCount: 3, orderCount: 5, quantity: 5 },
      { userId: otherBuyer.toString(), totalSpent: 40, purchaseCount: 1, orderCount: 1, quantity: 1 },
    ]);
    expect(result.revenue).toMatchObject({ net: 440, purchaseCount: 4, orderCount: 6, buyers: 2 });
    expect(result.timeline.map(({ purchaseCount }) => purchaseCount)).toEqual([2, 4]);
  });

  test('returns no ranked customers when the selected period has no delivered purchases', async () => {
    const buyer = await customer(1);
    await order(buyer, 100, { deliveredAt: new Date('2026-08-01T06:00:00.000Z') });

    const result = await service.insights(range);

    expect(result.topCustomers).toEqual([]);
    expect(result.revenue).toMatchObject({ net: 0, purchaseCount: 0, orderCount: 0, buyers: 0 });
  });
});
