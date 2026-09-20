import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import mongoose, { Types, type Connection } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { createHash } from 'node:crypto';
import {
  AuditLogSchema, CouponSchema, CouponRedemptionSchema, InventoryItemSchema, OrderSchema,
  PaymentRequestSchema, ProductSchema, UserSchema, WalletTransactionSchema,
  InventoryRepository, OrderRepository, UserRepository, WalletTransactionRepository,
} from '@store/database';
import { DeliveryStatus, InventoryStatus, OrderStatus, ProductStatus, UserStatus } from '@store/shared';
import { CouponsService } from '../../apps/api/src/coupons/coupons.service';
import { CouponQueryDto, CreateCouponDto, UpdateCouponDto } from '../../apps/api/src/coupons/coupons.dto';
import { PurchaseService, type PurchaseBatchInput } from '../../apps/api/src/purchase/purchase.service';
import { InventoryReservationService } from '../../apps/api/src/inventory/inventory-reservation.service';
import { PaymentService } from '../../apps/api/src/payment/payment.service';
import { WalletService } from '../../apps/api/src/wallet/wallet.service';
import type { BotConfigService } from '../../apps/api/src/bot-config/bot-config.service';
import { DeliveryRecoveryService } from '../../apps/api/src/delivery/delivery-recovery.service';

const integration = process.env.RUN_INTEGRATION === '1' ? describe : describe.skip;
integration('coupon admin, atomic wallet checkout and bank payment', () => {
  let replica: MongoMemoryReplSet;
  let connection: Connection;
  const models = (db: Connection) => ({
    coupons: db.model('Coupon', CouponSchema, 'coupons'),
    redemptions: db.model('CouponRedemption', CouponRedemptionSchema, 'coupon_redemptions'),
    products: db.model('Product', ProductSchema, 'products'),
    inventory: db.model('InventoryItem', InventoryItemSchema, 'inventory_items'),
    users: db.model('User', UserSchema, 'users'), orders: db.model('Order', OrderSchema, 'orders'),
    wallets: db.model('WalletTransaction', WalletTransactionSchema, 'wallet_transactions'),
    requests: db.model('PaymentRequest', PaymentRequestSchema, 'payment_requests'),
    audits: db.model('AuditLog', AuditLogSchema, 'audit_logs'),
  });
  let db: ReturnType<typeof models>;
  let coupons: CouponsService;
  let purchases: PurchaseService;
  let reservations: InventoryReservationService;
  let wallet: WalletService;
  let payments: PaymentService;
  const deliveries: string[] = [];
  const queue = { enqueue: async (id: string) => { deliveries.push(id); return { id }; }, requeue: async (id: string) => ({ id }) };
  const actor = new Types.ObjectId();

  beforeAll(async () => {
    replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
    connection = await mongoose.createConnection(replica.getUri('coupon_suite')).asPromise();
    db = models(connection);
    await Promise.all(Object.values(db).map((model) => model.createIndexes()));
    const users = new UserRepository(db.users), transactions = new WalletTransactionRepository(db.wallets);
    reservations = new InventoryReservationService(connection, db.orders, new InventoryRepository(db.inventory), users, transactions);
    coupons = new CouponsService(connection, db.coupons, db.redemptions, db.products, db.audits);
    purchases = new PurchaseService(connection, db.products, db.orders, users, reservations,
      new OrderRepository(db.orders), transactions, queue, undefined, coupons);
    wallet = new WalletService(connection, users, transactions);
    const bank = { getBankConfigForRuntime: async () => ({ token: 'isolated-test-only', bankId: 'CAKE',
      accountNo: '12345', accountName: 'TEST', template: 'compact2' }) } as unknown as BotConfigService;
    payments = new PaymentService(connection, db.requests, wallet, bank, purchases);
  }, 120_000);
  beforeEach(async () => { await Promise.all(Object.values(connection.collections).map((collection) => collection.deleteMany({}))); deliveries.length = 0; });
  afterAll(async () => { await connection?.close(); await replica?.stop(); }, 30_000);

  async function user(balance = 1000) {
    return db.users.create({ telegramId: BigInt(`0x${new Types.ObjectId()}`).toString(), walletBalance: balance,
      status: UserStatus.ACTIVE, referralCode: new Types.ObjectId().toString(), deletedAt: null });
  }
  async function fixture(stock = 8, balance = 1000) {
    const product = await db.products.create({ name: 'Coupon test', description: 'Isolated coupon test', slug: `coupon-${new Types.ObjectId()}`, price: 100,
      status: ProductStatus.ACTIVE, fieldDefinitions: [], deliveryTemplate: '{{payload}}',
      createdBy: actor, updatedBy: actor, deletedAt: null });
    const customer = await user(balance);
    await db.inventory.insertMany(Array.from({ length: stock }, (_, index) => ({ productId: product._id,
      encryptedPayload: 'isolated-test-payload-not-delivered',
      payloadHash: createHash('sha256').update(`${product._id}:${index}`).digest('hex'), maskedPreview: {}, status: InventoryStatus.AVAILABLE,
      createdBy: actor, deletedAt: null })));
    const input: PurchaseBatchInput = { userId: customer._id.toString(), productId: product._id.toString(),
      quantity: 3, expectedUnitPrice: 100, idempotencyPrefix: `coupon-batch-${new Types.ObjectId()}` };
    return { product, customer, input };
  }
  const save = (input: Partial<CreateCouponDto> = {}) => coupons.create({ code: 'SAVE10', type: 'PERCENT', value: 10,
    perUserLimit: 10, ...input }, actor.toString(), 'coupon-test-request');

  test('admin normalizes codes, validates rules/products and audits create/update/disable', async () => {
    const { product } = await fixture();
    const coupon = await save({ code: ' save10 ', productIds: [product._id.toString()], minSubtotal: 200,
      maxDiscount: 40, usageLimit: 8, startsAt: '2026-01-01T00:00:00Z', endsAt: '2099-01-01T00:00:00Z' });
    expect(coupon.code).toBe('SAVE10');
    expect(coupon.usageCount).toBe(0);
    await expect(save({ code: 'save10' })).rejects.toThrow('đã tồn tại');
    await expect(save({ code: 'WRONG', value: 101 })).rejects.toThrow('1–100');
    await expect(save({ code: 'DATES', startsAt: '2099-01-01', endsAt: '2020-01-01' })).rejects.toThrow('Khoảng thời gian');
    await expect(save({ code: 'NODATA', productIds: [new Types.ObjectId().toString()] })).rejects.toThrow('sản phẩm');
    await coupons.update(coupon._id.toString(), { active: false, maxDiscount: null, startsAt: null, endsAt: null }, actor.toString());
    expect(await db.audits.countDocuments({ resourceType: 'Coupon' })).toBe(2);
    const page = await coupons.list(Object.assign(new CouponQueryDto(), { q: 'save', active: 'false', limit: 1 }));
    expect(page).toMatchObject({ page: 1, limit: 1, total: 1, totalPages: 1 });
    expect(page.items[0]).toMatchObject({ active: false, maxDiscount: null, startsAt: null, endsAt: null });
  });

  test('DTO rejects malformed money, code, product IDs and limits while partial updates support explicit clearing', async () => {
    expect(await validate(plainToInstance(CreateCouponDto, { code: ' hi ', type: 'FIXED', value: 1.5,
      usageLimit: 0, perUserLimit: 0, productIds: ['bad'] }))).not.toHaveLength(0);
    expect(await validate(plainToInstance(UpdateCouponDto, { maxDiscount: null, usageLimit: null,
      startsAt: null, endsAt: null, active: false }))).toHaveLength(0);
    for (const field of ['type', 'value', 'minSubtotal', 'perUserLimit', 'active', 'productIds']) {
      expect(await validate(plainToInstance(UpdateCouponDto, { [field]: null }))).not.toHaveLength(0);
    }
  });

  test('quotes percent/minimum/cap and fixed discounts without reserving stock or consuming usage', async () => {
    const { product, input } = await fixture();
    await save({ value: 50, minSubtotal: 200, maxDiscount: 80, productIds: [product._id.toString()] });
    expect(await purchases.quoteBatch({ ...input, couponCode: 'save10' })).toMatchObject({ subtotal: 300,
      discountAmount: 80, totalAmount: 220, couponCode: 'SAVE10', available: 8 });
    expect(await db.redemptions.countDocuments()).toBe(0);
    expect((await db.coupons.findOne())!.usageCount).toBe(0);
    expect(await db.inventory.countDocuments({ status: InventoryStatus.AVAILABLE })).toBe(8);
    await expect(purchases.quoteBatch({ ...input, quantity: 1, couponCode: 'SAVE10' })).rejects.toThrow('tối thiểu');
    await save({ code: 'FIXED', type: 'FIXED', value: 25 });
    expect(await purchases.quoteBatch({ ...input, couponCode: 'FIXED' })).toMatchObject({ discountAmount: 25, totalAmount: 275 });
  });

  test('expired/future/disabled and product-restricted coupons are rejected', async () => {
    const { input } = await fixture();
    const { product: otherProduct } = await fixture();
    await save({ code: 'EXPIRED', endsAt: '2020-01-01' });
    await save({ code: 'FUTURE', startsAt: '2099-01-01' });
    await save({ code: 'DISABLED', active: false });
    await save({ code: 'RESTRICTED', productIds: [otherProduct._id.toString()] });
    for (const code of ['EXPIRED', 'FUTURE', 'DISABLED', 'RESTRICTED', 'MISSING']) {
      await expect(purchases.quoteBatch({ ...input, couponCode: code })).rejects.toThrow();
    }
  });

  test('batch wallet applies rounded discounts once and conserves every đồng in orders and ledger', async () => {
    const { customer, input } = await fixture();
    await save({ type: 'FIXED', value: 101 });
    const orders = await purchases.purchaseBatch({ ...input, couponCode: 'SAVE10', expectedTotalAmount: 199 });
    expect(orders.map((order) => order.discountAmount)).toEqual([34, 34, 33]);
    expect(orders.map((order) => order.totalAmount)).toEqual([66, 66, 67]);
    expect(orders.every((order) => order.grossAmount === 100 && order.couponCode === 'SAVE10')).toBe(true);
    expect((await db.users.findById(customer._id))!.walletBalance).toBe(801);
    expect((await db.wallets.find()).reduce((sum, row) => sum + row.amount, 0)).toBe(-199);
    expect(await db.redemptions.countDocuments()).toBe(1);
    expect((await db.coupons.findOne())!.usageCount).toBe(1);
  });

  test('simultaneous idempotent retries produce one discounted batch and one redemption', async () => {
    const { input } = await fixture();
    await save({ perUserLimit: 1 });
    const request = { ...input, couponCode: 'SAVE10', expectedTotalAmount: 270 };
    const results = await Promise.all(Array.from({ length: 4 }, () => purchases.purchaseBatch(request)));
    expect(new Set(results.map((rows) => rows[0]!._id.toString())).size).toBe(1);
    expect(await db.orders.countDocuments()).toBe(3);
    expect(await db.redemptions.countDocuments()).toBe(1);
    expect((await db.coupons.findOne())!.usageCount).toBe(1);
    await expect(purchases.purchaseBatch({ ...request, expectedTotalAmount: 300 })).rejects.toThrow('Idempotency');
    await expect(purchases.purchaseBatch({ ...request, couponCode: undefined })).rejects.toThrow('Idempotency');
    await expect(purchases.purchaseBatch({ ...request, quantity: 1, expectedTotalAmount: 90 })).rejects.toThrow('Idempotency');
  }, 30_000);

  test('last global coupon use across customers is atomic', async () => {
    const { input } = await fixture();
    const second = await user();
    await save({ usageLimit: 1 });
    const results = await Promise.allSettled([
      purchases.purchaseBatch({ ...input, couponCode: 'SAVE10', expectedTotalAmount: 270 }),
      purchases.purchaseBatch({ ...input, userId: second._id.toString(), idempotencyPrefix: 'second-coupon-batch', couponCode: 'SAVE10', expectedTotalAmount: 270 }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await db.orders.countDocuments()).toBe(3);
    expect(await db.redemptions.countDocuments()).toBe(1);
    expect((await db.coupons.findOne())!.usageCount).toBe(1);
  });

  test('per-customer coupon usage holds under competing checkout keys', async () => {
    const { input } = await fixture();
    await save({ perUserLimit: 1 });
    const results = await Promise.allSettled([1, 2].map((index) => purchases.purchaseBatch({ ...input,
      idempotencyPrefix: `customer-race-${index}`, couponCode: 'SAVE10', expectedTotalAmount: 270 })));
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await db.redemptions.countDocuments()).toBe(1);
  });

  test('stock, insufficient funds and stale expected totals roll back coupon usage', async () => {
    const { input } = await fixture(2, 0);
    await save();
    await expect(purchases.purchaseBatch({ ...input, couponCode: 'SAVE10', expectedTotalAmount: 270 })).rejects.toThrow();
    await db.users.updateOne({ _id: input.userId }, { $set: { walletBalance: 1000 } });
    await expect(purchases.purchaseBatch({ ...input, couponCode: 'SAVE10', expectedTotalAmount: 270 })).rejects.toThrow();
    await expect(purchases.purchaseBatch({ ...input, quantity: 1, couponCode: 'SAVE10', expectedTotalAmount: 80 })).rejects.toThrow('thay đổi');
    await expect(purchases.purchaseBatch({ ...input, quantity: 1, couponCode: 'SAVE10' })).rejects.toThrow('xác nhận');
    expect(await db.redemptions.countDocuments()).toBe(0);
    expect((await db.coupons.findOne())!.usageCount).toBe(0);
    expect(await db.orders.countDocuments()).toBe(0);
    expect(await db.wallets.countDocuments()).toBe(0);
  });

  test('zero-total coupons purchase without a fake ledger then safely cancel expired reservations', async () => {
    const { customer, input } = await fixture(3, 0);
    await save({ value: 100 });
    const orders = await purchases.purchaseBatch({ ...input, couponCode: 'SAVE10', expectedTotalAmount: 0 });
    expect(orders.every((order) => order.totalAmount === 0)).toBe(true);
    expect(await db.wallets.countDocuments()).toBe(0);
    expect((await db.users.findById(customer._id))!.purchaseCount).toBe(3);
    await db.inventory.updateMany({ reservedByUserId: customer._id }, { $set: { reservationExpiresAt: new Date(0) } });
    expect((await reservations.releaseExpired()).released).toBe(3);
    expect(await db.orders.countDocuments({ status: OrderStatus.CANCELLED })).toBe(3);
    expect(await db.wallets.countDocuments()).toBe(0);
  });

  test('failed-delivery refunds use net paid amount and support fully discounted units', async () => {
    const { input } = await fixture();
    await save({ type: 'FIXED', value: 298 });
    const orders = await purchases.purchaseBatch({ ...input, couponCode: 'SAVE10', expectedTotalAmount: 2 });
    expect(orders.map((order) => order.totalAmount)).toEqual([0, 1, 1]);
    await db.orders.updateMany({}, { $set: { status: OrderStatus.DELIVERY_FAILED, deliveryStatus: DeliveryStatus.FAILED } });
    const recovery = new DeliveryRecoveryService(connection, db.orders, db.inventory, new InventoryRepository(db.inventory), wallet, queue);
    for (const order of orders) await recovery.refund(order._id.toString(), actor.toString());
    expect(await db.orders.countDocuments({ status: OrderStatus.REFUNDED })).toBe(3);
    expect((await db.users.findById(input.userId))!.walletBalance).toBe(1000);
    expect((await db.wallets.find({ type: 'REFUND' })).reduce((sum, row) => sum + row.amount, 0)).toBe(2);
  });

  test('unpaid QR does not consume discount, callback charges discounted total once', async () => {
    const { customer, input } = await fixture(3, 0);
    await save({ perUserLimit: 1, usageLimit: 1 });
    const checkout = await payments.createBankCheckout(input.userId, input.productId, 3, 100, 'bank-coupon-quote', 'SAVE10', 270);
    expect(checkout).toMatchObject({ amount: 270, subtotal: 300, discountAmount: 30, couponCode: 'SAVE10' });
    expect(checkout.qrUrl).toContain('amount=270');
    expect(await db.redemptions.countDocuments()).toBe(0);
    expect((await db.coupons.findOne())!.usageCount).toBe(0);
    expect(await db.inventory.countDocuments({ status: InventoryStatus.AVAILABLE })).toBe(3);
    const transaction = { transactionID: 'bank-coupon-1', amount: 270, description: checkout.transferContent, type: 'IN' };
    await Promise.all([payments.processCakeCallback([transaction]), payments.processCakeCallback([transaction])]);
    expect(await db.orders.countDocuments()).toBe(3);
    expect(await db.redemptions.countDocuments()).toBe(1);
    expect((await db.coupons.findOne())!.usageCount).toBe(1);
    expect((await db.users.findById(customer._id))!.walletBalance).toBe(0);
    expect((await db.wallets.find()).reduce((sum, row) => sum + row.amount, 0)).toBe(0);
    expect((await db.requests.findById(checkout.id))!.metadata.quickCheckout).toMatchObject({ status: 'FULFILLED', couponCode: 'SAVE10' });
    await expect(payments.createBankCheckout(input.userId, input.productId, 3, 100, 'bank-coupon-quote', undefined, 270)).rejects.toThrow('idempotency');
  }, 30_000);

  test('two paid QRs competing for the final coupon use fulfill one and credit the other', async () => {
    const { input } = await fixture(8, 0);
    const second = await user(0);
    await save({ usageLimit: 1 });
    const firstQr = await payments.createBankCheckout(input.userId, input.productId, 3, 100, 'coupon-race-qr-first', 'SAVE10', 270);
    const secondQr = await payments.createBankCheckout(second._id.toString(), input.productId, 3, 100, 'coupon-race-qr-second', 'SAVE10', 270);
    expect(await db.redemptions.countDocuments()).toBe(0);
    await Promise.all([firstQr, secondQr].map((qr, index) => payments.processCakeCallback([
      { transactionID: `coupon-paid-race-${index}`, amount: 270, description: qr.transferContent, type: 'IN' },
    ])));
    expect(await db.orders.countDocuments()).toBe(3);
    expect(await db.redemptions.countDocuments()).toBe(1);
    expect((await db.coupons.findOne())!.usageCount).toBe(1);
    expect((await db.users.find()).reduce((sum, customer) => sum + customer.walletBalance, 0)).toBe(270);
    expect(await db.requests.countDocuments({ 'metadata.quickCheckout.status': 'FULFILLED' })).toBe(1);
    expect(await db.requests.countDocuments({ 'metadata.quickCheckout.status': 'FAILED' })).toBe(1);
    expect(await db.wallets.countDocuments({ type: 'DEPOSIT' })).toBe(2);
  }, 30_000);

  test.each(['disabled', 'changed', 'exhausted', 'expired'] as const)('QR coupon becomes %s before callback: all transferred funds credited, no full-price order', async (reason) => {
    const { input } = await fixture(8, 0);
    const coupon = await save({ usageLimit: 1 });
    const checkout = await payments.createBankCheckout(input.userId, input.productId, 3, 100, `stale-coupon-${reason}`, 'SAVE10', 270);
    if (reason === 'disabled') await coupons.update(coupon._id.toString(), { active: false }, actor.toString());
    if (reason === 'changed') await coupons.update(coupon._id.toString(), { value: 20 }, actor.toString());
    if (reason === 'expired') await coupons.update(coupon._id.toString(), { endsAt: '2020-01-01' }, actor.toString());
    if (reason === 'exhausted') {
      const other = await user();
      await purchases.purchaseBatch({ ...input, userId: other._id.toString(), quantity: 1,
        idempotencyPrefix: 'other-coupon-customer', couponCode: 'SAVE10', expectedTotalAmount: 90 });
    }
    const transaction = { transactionID: `stale-transfer-${reason}`, amount: 270, description: checkout.transferContent, type: 'IN' };
    await payments.processCakeCallback([transaction]);
    await payments.processCakeCallback([transaction]);
    expect((await db.users.findById(input.userId))!.walletBalance).toBe(270);
    expect(await db.orders.countDocuments({ userId: input.userId })).toBe(0);
    expect(await db.wallets.countDocuments({ userId: input.userId, type: 'DEPOSIT' })).toBe(1);
    expect((await db.requests.findById(checkout.id))!.metadata.quickCheckout).toMatchObject({ status: 'FAILED' });
    expect(await db.redemptions.countDocuments({ userId: input.userId })).toBe(0);
  }, 30_000);

  test('free QR and unconfirmed coupon QR are rejected without payment requests or usage', async () => {
    const { input } = await fixture();
    await save({ value: 100 });
    await expect(payments.createBankCheckout(input.userId, input.productId, 3, 100, 'unconfirmed-free', 'SAVE10')).rejects.toThrow('xác nhận');
    await expect(payments.createBankCheckout(input.userId, input.productId, 3, 100, 'confirmed-free', 'SAVE10', 0)).rejects.toThrow('không cần chuyển khoản');
    expect(await db.requests.countDocuments()).toBe(0);
    expect(await db.redemptions.countDocuments()).toBe(0);
  });
});
