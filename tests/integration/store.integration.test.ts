import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Queue, Worker } from 'bullmq';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { validate } from 'class-validator';
import { EncryptionService } from '@store/encryption';
import { redisConnectionOptions } from '@store/config';
import {
  AdminModel, AuditLogModel, CustomerMessageModel, ImportBatchModel, InventoryItemModel, InventoryRepository, NotificationModel,
  OrderModel, OrderRepository, PaymentRequestModel, ProductModel, RoleModel, RuntimeLeaseModel, SettingModel, UserModel,
  UserRepository, WalletTransactionModel, WalletTransactionRepository, WarrantyRequestModel, DatabaseModule,
} from '@store/database';
import { InventoryStatus, OutOfStockError, PaymentRequestStatus, ProductStatus, UserStatus } from '@store/shared';
import { PurchaseService } from '../../apps/api/src/purchase/purchase.service';
import type { PurchaseAlertQueueClient } from '../../apps/api/src/purchase/purchase-alert.queue';
import { DeliveryQueue } from '../../apps/api/src/delivery/delivery.queue';
import { WalletService } from '../../apps/api/src/wallet/wallet.service';
import { PaymentService } from '../../apps/api/src/payment/payment.service';
import { DeliveryProcessor } from '../../apps/bot/src/delivery.processor';
import { StockAlertProcessor } from '../../apps/bot/src/stock-alert.processor';
import { PurchaseAlertProcessor } from '../../apps/bot/src/purchase-alert.processor';
import { InventoryReservationService } from '../../apps/api/src/inventory/inventory-reservation.service';
import { InventoryImportService } from '../../apps/api/src/inventory/inventory-import.service';
import { InventoryAdminService } from '../../apps/api/src/inventory/inventory-admin.service';
import { StockAlertQueue } from '../../apps/api/src/inventory/stock-alert.queue';
import { DeliveryRecoveryService } from '../../apps/api/src/delivery/delivery-recovery.service';
import { BotConfigService } from '../../apps/api/src/bot-config/bot-config.service';
import { ProductService } from '../../apps/api/src/product/product.service';
import { SaveProductDto } from '../../apps/api/src/product/product.dto';
import { AnalyticsService } from '../../apps/api/src/analytics/analytics.service';
import { WarrantyService } from '../../apps/api/src/warranty/warranty.service';
import { MessagingService } from '../../apps/api/src/messaging/messaging.service';
import { AdminBroadcastProcessor } from '../../apps/bot/src/admin-broadcast.processor';

process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef';
process.env.PAYLOAD_HASH_KEY = 'abcdef0123456789abcdef0123456789';
process.env.ENCRYPTION_KEY_VERSION = '1';

const integration = process.env.RUN_INTEGRATION === '1' ? describe : describe.skip;
const encryption = new EncryptionService({ 1: process.env.ENCRYPTION_KEY }, 1, process.env.PAYLOAD_HASH_KEY);
let replica: MongoMemoryReplSet;
let mongoUri: string;
const queued: string[] = [];

const inventoryRepository = () => new InventoryRepository(InventoryItemModel);
const orderRepository = () => new OrderRepository(OrderModel);
const userRepository = () => new UserRepository(UserModel);
const walletRepository = () => new WalletTransactionRepository(WalletTransactionModel);
const reservationService = () => new InventoryReservationService(mongoose.connection, OrderModel,
  inventoryRepository(), userRepository(), walletRepository());
const queueStub = {
  enqueue: async (orderId: string) => { queued.push(orderId); return { id: orderId }; },
  requeue: async (orderId: string) => { queued.push(orderId); return { id: orderId }; },
} as unknown as DeliveryQueue;

function purchaseService(purchaseAlerts?: PurchaseAlertQueueClient) {
  return new PurchaseService(mongoose.connection, ProductModel, OrderModel, userRepository(), reservationService(),
    orderRepository(), walletRepository(), queueStub, purchaseAlerts);
}
function walletService() { return new WalletService(mongoose.connection, userRepository(), walletRepository()); }
function paymentService() { return new PaymentService(mongoose.connection, PaymentRequestModel, walletService()); }
function analyticsService() { return new AnalyticsService(OrderModel, PaymentRequestModel, UserModel, ProductModel,
  InventoryItemModel, WalletTransactionModel, AuditLogModel); }
function warrantyService() { return new WarrantyService(mongoose.connection, WarrantyRequestModel, OrderModel, UserModel,
  CustomerMessageModel, AuditLogModel, { notify: async () => true } as never,
  { sendSupportMessage: async () => ({ message_id: 1 }) } as never); }

async function fixture(stock = 1, balance = 1000, purchaseLimit = 0) {
  const adminId = new Types.ObjectId();
  const product = await ProductModel.create({ name: `Product ${new Types.ObjectId()}`, slug: `product-${new Types.ObjectId()}`,
    description: 'Integration fixture', price: 100, status: ProductStatus.ACTIVE, imageUrls: [], warrantyDays: 7,
    deliveryTemplate: 'Login: {{login}} Password: {{password}}', fieldDefinitions: [
      { name: 'Login', key: 'login', type: 'EMAIL', sensitive: false, visibleToCustomer: true, required: true, sortOrder: 1 },
      { name: 'Password', key: 'password', type: 'STRING', sensitive: true, visibleToCustomer: true, required: true, sortOrder: 2 },
    ], purchaseLimitPerUser: purchaseLimit, lowStockThreshold: 1, sortOrder: 0, createdBy: adminId, updatedBy: adminId, deletedAt: null });
  const user = await UserModel.create({ telegramId: `${Math.floor(Math.random() * 1e12)}`, status: UserStatus.ACTIVE,
    walletBalance: balance, referralCode: `REF${new Types.ObjectId().toString().slice(-8)}`, purchaseCount: 0, deletedAt: null });
  for (let index = 0; index < stock; index++) {
    const payload = { login: `fixture${index}-${product._id}@example.invalid`, password: `secret-${index}` };
    await InventoryItemModel.create({ productId: product._id, encryptedPayload: encryption.encrypt(payload), maskedPreview: { login: payload.login, password: 'se****-0' },
      payloadHash: encryption.normalizedHash(payload), status: InventoryStatus.AVAILABLE, createdBy: adminId, deletedAt: null });
  }
  return { product, user, adminId };
}

integration('digital store on a MongoDB replica set', () => {
  beforeAll(async () => {
    replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
    mongoUri = replica.getUri('digital_store_test');
    await mongoose.connect(mongoUri, { autoIndex: true });
    await Promise.all(Object.values(mongoose.models).map((model) => model.createIndexes()));
  }, 120_000);

  beforeEach(async () => {
    queued.length = 0;
    await Promise.all(Object.values(mongoose.connection.collections).map((collection) => collection.deleteMany({})));
  });

  afterAll(async () => { await mongoose.disconnect(); await replica?.stop(); }, 30_000);

  test('1. two customers racing for the last item produce exactly one order', async () => {
    const { product, user: first } = await fixture(1);
    const second = await UserModel.create({ telegramId: '200000002', status: UserStatus.ACTIVE, walletBalance: 1000,
      referralCode: 'SECONDUSER', purchaseCount: 0, deletedAt: null });
    const results = await Promise.allSettled([
      purchaseService().purchase({ userId: first._id.toString(), productId: product._id.toString(), expectedUnitPrice: 100, idempotencyKey: 'race-last-first' }),
      purchaseService().purchase({ userId: second._id.toString(), productId: product._id.toString(), expectedUnitPrice: 100, idempotencyKey: 'race-last-second' }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await OrderModel.countDocuments()).toBe(1);
    expect(await InventoryItemModel.countDocuments({ status: InventoryStatus.RESERVED })).toBe(1);
    expect((await UserModel.findById(first._id))!.walletBalance + (await UserModel.findById(second._id))!.walletBalance).toBe(1900);
  }, 30_000);

  test('serverless Nest injection shares the static Mongoose model connection used by bot tasks', async () => {
    const previousRuntime = process.env.APP_RUNTIME;
    const previousPoolSize = process.env.MONGODB_MAX_POOL_SIZE;
    process.env.APP_RUNTIME = 'serverless';
    process.env.MONGODB_MAX_POOL_SIZE = '3';
    class ServerlessDatabaseTestModule {}
    Module({ imports: [DatabaseModule.forRoot(mongoUri, true)] })(ServerlessDatabaseTestModule);
    const app = await NestFactory.createApplicationContext(ServerlessDatabaseTestModule, { logger: false });
    try {
      const injectedProduct = app.get<typeof ProductModel>(getModelToken('Product'));
      expect(injectedProduct).toBe(ProductModel);
      expect(injectedProduct.db).toBe(ProductModel.db);
    } finally {
      await app.close();
      if (previousRuntime === undefined) delete process.env.APP_RUNTIME;
      else process.env.APP_RUNTIME = previousRuntime;
      if (previousPoolSize === undefined) delete process.env.MONGODB_MAX_POOL_SIZE;
      else process.env.MONGODB_MAX_POOL_SIZE = previousPoolSize;
    }
  });

  test('2. concurrent duplicate requests from one customer are idempotent', async () => {
    const { product, user } = await fixture(2);
    const input = { userId: user._id.toString(), productId: product._id.toString(), expectedUnitPrice: 100, idempotencyKey: 'same-user-request' };
    const [first, second] = await Promise.all([purchaseService().purchase(input), purchaseService().purchase(input)]);
    expect(first._id.toString()).toBe(second._id.toString());
    expect(await OrderModel.countDocuments()).toBe(1);
    expect((await UserModel.findById(user._id))!.walletBalance).toBe(900);
    expect(await WalletTransactionModel.countDocuments()).toBe(1);
    await expect(purchaseService().purchase({ ...input, productId: new Types.ObjectId().toString() }))
      .rejects.toThrow('Idempotency key was already used');
  }, 30_000);

  test('3. two admins approving the same deposit only credit once', async () => {
    const { user } = await fixture(0, 0);
    const request = await paymentService().create(user._id.toString(), 500, 'manual', 'deposit-request-1');
    const [first, second] = await Promise.all([
      paymentService().approve(request._id.toString(), new Types.ObjectId().toString(), 'approval-request-1'),
      paymentService().approve(request._id.toString(), new Types.ObjectId().toString(), 'approval-request-1'),
    ]);
    expect(first).toBeTruthy(); expect(second).toBeTruthy();
    expect((await UserModel.findById(user._id))!.walletBalance).toBe(500);
    expect(await WalletTransactionModel.countDocuments()).toBe(1);
  });

  test('4. repeated payment webhooks are idempotent', async () => {
    const { user } = await fixture(0, 0);
    await Promise.all(Array.from({ length: 4 }, () => paymentService().processWebhook('bank', 'provider-123', user._id.toString(), 700)));
    expect((await UserModel.findById(user._id))!.walletBalance).toBe(700);
    expect(await PaymentRequestModel.countDocuments()).toBe(1);
    expect(await WalletTransactionModel.countDocuments()).toBe(1);
  });

  test('repeated Cake callbacks credit a matching bank deposit exactly once', async () => {
    const { user } = await fixture(0, 0);
    const bankConfig = {
      getBankConfigForRuntime: async () => ({ token: 'test-bank-token', bankId: 'CAKE', accountNo: '1234567890', template: 'compact2', accountName: 'TEST USER' }),
    } as unknown as BotConfigService;
    const service = new PaymentService(mongoose.connection, PaymentRequestModel, walletService(), bankConfig);
    const deposit = await service.createBankDeposit(user._id.toString(), 3_000, 'cake-callback-deposit');
    const transaction = { transactionID: '479740339', amount: 3_000,
      description: `BUI THANH PHUONG ${deposit.transferContent}`, transactionDate: '08/08/2026', type: 'IN' };
    await Promise.all(Array.from({ length: 5 }, () => service.processCakeCallback([transaction])));
    await service.processCakeCallback([{ ...transaction, transactionID: '479740340', type: 'OUT' }]);
    expect((await UserModel.findById(user._id))!.walletBalance).toBe(3_000);
    expect(await PaymentRequestModel.countDocuments({ providerReference: '479740339', status: PaymentRequestStatus.APPROVED })).toBe(1);
    expect(await WalletTransactionModel.countDocuments({ userId: user._id, type: 'DEPOSIT' })).toBe(1);
  });

  test('the customer history check recovers a missed Cake callback', async () => {
    const { user } = await fixture(0, 0);
    const bankConfig = {
      getBankConfigForRuntime: async () => ({ token: 'test-bank-token', bankId: 'CAKE', accountNo: '1234567890', template: 'compact2', accountName: 'TEST USER' }),
      getBankApiTokenForRuntime: async () => 'test-bank-token',
    } as unknown as BotConfigService;
    let requestedUrl = '';
    let fetchCount = 0;
    let transferContent = '';
    const service = new PaymentService(mongoose.connection, PaymentRequestModel, walletService(), bankConfig, undefined,
      RuntimeLeaseModel, async (input) => {
        fetchCount++;
        requestedUrl = String(input);
        return Response.json({ status: 'success', message: 'Thành công', transactions: [{
          transactionID: 479740341, amount: 4_000, description: `NGUOI MUA ${transferContent} chuyen tien`,
          transactionDate: '08/08/2026', type: 'IN',
        }] });
      });
    const deposit = await service.createBankDeposit(user._id.toString(), 4_000, 'cake-history-recovery');
    transferContent = deposit.transferContent;

    const checked = await service.checkBankDeposit(deposit.id, user._id.toString());

    expect(checked).toMatchObject({ status: PaymentRequestStatus.APPROVED, receivedAmount: 4_000,
      historyCheck: { status: 'MATCHED' } });
    expect(requestedUrl).toBe('https://thueapibank.vn/historyapicakev2/test-bank-token');
    expect(fetchCount).toBe(1);
    expect((await UserModel.findById(user._id))?.walletBalance).toBe(4_000);
    expect(await WalletTransactionModel.countDocuments({ userId: user._id, type: 'DEPOSIT' })).toBe(1);
  });

  test('admin can safely test the saved Cake history token without processing transactions', async () => {
    const bankConfig = {
      getBankApiTokenForRuntime: async () => 'diagnostic-bank-token',
    } as unknown as BotConfigService;
    let requestedUrl = '';
    const service = new PaymentService(mongoose.connection, PaymentRequestModel, walletService(), bankConfig, undefined,
      undefined, async (input) => {
        requestedUrl = String(input);
        return Response.json({ status: 'success', transactions: [
          { transactionID: 479740400, amount: 12_000, description: 'TEST DONABC', transactionDate: '02/09/2026', type: 'IN' },
          { transactionID: 479740401, amount: 5_000, description: 'TEST OUT', transactionDate: '02/09/2026', type: 'OUT' },
        ] });
      });

    const result = await service.testCakeHistoryConnection();

    expect(requestedUrl).toBe('https://thueapibank.vn/historyapicakev2/diagnostic-bank-token');
    expect(result).toMatchObject({ ok: true, provider: 'CAKE', totalTransactions: 2, incomingTransactions: 1 });
    expect(result.endpoint).not.toContain('diagnostic-bank-token');
    expect(result.transactions).toHaveLength(2);
    expect(await WalletTransactionModel.countDocuments()).toBe(0);
    expect(await PaymentRequestModel.countDocuments()).toBe(0);
  });

  test('a manual Cake history check racing the webhook never credits twice', async () => {
    const { user } = await fixture(0, 0);
    const bankConfig = {
      getBankConfigForRuntime: async () => ({ token: 'test-bank-token', bankId: 'CAKE', accountNo: '1234567890', template: 'compact2', accountName: 'TEST USER' }),
      getBankApiTokenForRuntime: async () => 'test-bank-token',
    } as unknown as BotConfigService;
    let historyStarted!: () => void;
    let releaseHistory!: () => void;
    const started = new Promise<void>((resolve) => { historyStarted = resolve; });
    const release = new Promise<void>((resolve) => { releaseHistory = resolve; });
    let transaction: { transactionID: string; amount: number; description: string; transactionDate: string; type: string };
    const service = new PaymentService(mongoose.connection, PaymentRequestModel, walletService(), bankConfig, undefined,
      RuntimeLeaseModel, async () => {
        historyStarted();
        await release;
        return Response.json({ status: 'success', transactions: [transaction] });
      });
    const deposit = await service.createBankDeposit(user._id.toString(), 5_000, 'cake-history-webhook-race');
    transaction = { transactionID: '479740342', amount: 5_000,
      description: `BUI THANH PHUONG ${deposit.transferContent}`, transactionDate: '08/08/2026', type: 'IN' };

    const manualCheck = service.checkBankDeposit(deposit.id, user._id.toString());
    await started;
    const webhook = service.processCakeCallback([transaction]);
    releaseHistory();
    await Promise.all([manualCheck, webhook]);

    expect((await UserModel.findById(user._id))?.walletBalance).toBe(5_000);
    expect(await PaymentRequestModel.countDocuments({ providerReference: transaction.transactionID,
      status: PaymentRequestStatus.APPROVED })).toBe(1);
    expect(await WalletTransactionModel.countDocuments({ userId: user._id, type: 'DEPOSIT' })).toBe(1);
  });

  test('Cake quick checkout calculates the total and atomically buys every requested item once', async () => {
    const { product, user } = await fixture(2, 0);
    const bankConfig = {
      getBankConfigForRuntime: async () => ({ token: 'test-bank-token', bankId: 'CAKE', accountNo: '1234567890', template: 'compact2', accountName: 'TEST USER' }),
    } as unknown as BotConfigService;
    const queuedPurchaseAlerts: Array<{ purchaseGroupId: string; productId: string; buyerId: string; quantity: number }> = [];
    const purchases = purchaseService({ enqueue: async (job) => { queuedPurchaseAlerts.push(job); return { id: job.purchaseGroupId }; } });
    const service = new PaymentService(mongoose.connection, PaymentRequestModel, walletService(), bankConfig, purchases);
    const checkouts = await Promise.all(Array.from({ length: 5 }, () => service.createBankCheckout(
      user._id.toString(), product._id.toString(), 2, 100, 'quick-checkout-request')));
    const checkout = checkouts[0]!;
    expect(new Set(checkouts.map((item) => item.id)).size).toBe(1);
    expect(await PaymentRequestModel.countDocuments({ idempotencyKey: 'quick-checkout-request' })).toBe(1);
    expect(checkout).toMatchObject({ amount: 200, quantity: 2, unitPrice: 100, productName: product.name, status: PaymentRequestStatus.PENDING });
    expect(checkout.qrUrl).toContain('amount=200');
    expect(checkout.transferContent).toMatch(/^DON[A-F0-9]+$/);
    // Creating a QR is only a payment intent. Unpaid customers must never be
    // able to hold real inventory and block everyone else from buying it.
    expect(await InventoryItemModel.countDocuments({ productId: product._id, status: InventoryStatus.AVAILABLE })).toBe(2);
    expect(await InventoryItemModel.countDocuments({ productId: product._id,
      reservedPaymentRequestId: { $exists: true } })).toBe(0);
    await ProductModel.updateOne({ _id: product._id }, { $set: { price: 999, status: ProductStatus.INACTIVE } });

    const transaction = { transactionID: '579740339', amount: 200,
      description: `THANH TOAN ${checkout.transferContent}`, transactionDate: '25/08/2026', type: 'IN' };
    await Promise.all(Array.from({ length: 4 }, () => service.processCakeCallback([transaction])));

    expect(await OrderModel.countDocuments({ userId: user._id, productId: product._id })).toBe(2);
    expect(await InventoryItemModel.countDocuments({ productId: product._id, status: InventoryStatus.RESERVED })).toBe(2);
    expect(await InventoryItemModel.countDocuments({ productId: product._id,
      reservedPaymentRequestId: { $exists: true } })).toBe(0);
    const orderReservations = await InventoryItemModel.find({ productId: product._id, status: InventoryStatus.RESERVED }).lean();
    expect(orderReservations.every((item) => (item.reservationExpiresAt?.getTime() ?? 0) > Date.now() + 14 * 60_000)).toBeTrue();
    expect((await OrderModel.findOne({ userId: user._id }))?.unitPrice).toBe(100);
    expect((await UserModel.findById(user._id))!.walletBalance).toBe(0);
    expect(await WalletTransactionModel.countDocuments({ userId: user._id, type: 'DEPOSIT' })).toBe(1);
    expect(await WalletTransactionModel.countDocuments({ userId: user._id, type: 'PURCHASE' })).toBe(2);
    expect(await PaymentRequestModel.countDocuments({ providerReference: '579740339', status: PaymentRequestStatus.APPROVED })).toBe(1);
    expect(queuedPurchaseAlerts).toHaveLength(1);
    expect(queuedPurchaseAlerts[0]).toMatchObject({ productId: product._id.toString(), buyerId: user._id.toString(), quantity: 2 });
    expect(new Set(queued).size).toBe(2);
    const retried = await service.createBankCheckout(user._id.toString(), product._id.toString(), 2, 100, 'quick-checkout-request');
    expect(retried.id).toBe(checkout.id);
  });

  test('a stock race cannot create a partial quick-checkout order or lose the bank payment', async () => {
    const { product, user } = await fixture(2, 0);
    const bankConfig = {
      getBankConfigForRuntime: async () => ({ token: 'test-bank-token', bankId: 'CAKE', accountNo: '1234567890', template: 'compact2', accountName: 'TEST USER' }),
    } as unknown as BotConfigService;
    const service = new PaymentService(mongoose.connection, PaymentRequestModel, walletService(), bankConfig, purchaseService());
    const checkout = await service.createBankCheckout(user._id.toString(), product._id.toString(), 2, 100, 'quick-checkout-stock-race');
    await InventoryItemModel.updateOne({ productId: product._id, status: InventoryStatus.AVAILABLE },
      { $set: { status: InventoryStatus.DISABLED } });

    await service.processCakeCallback([{ transactionID: '579740340', amount: 200,
      description: `THANH TOAN ${checkout.transferContent}`, transactionDate: '25/08/2026', type: 'IN' }]);

    expect(await OrderModel.countDocuments({ userId: user._id, productId: product._id })).toBe(0);
    expect(await InventoryItemModel.countDocuments({ productId: product._id, status: InventoryStatus.RESERVED })).toBe(0);
    expect(await InventoryItemModel.countDocuments({ productId: product._id, status: InventoryStatus.AVAILABLE })).toBe(1);
    expect((await UserModel.findById(user._id))!.walletBalance).toBe(200);
    expect(await WalletTransactionModel.countDocuments({ userId: user._id, type: 'DEPOSIT' })).toBe(1);
    expect(await WalletTransactionModel.countDocuments({ userId: user._id, type: 'PURCHASE' })).toBe(0);
    const checked = await service.checkBankDeposit(checkout.id, user._id.toString());
    expect(checked.checkout).toMatchObject({ status: 'FAILED', quantity: 2, totalAmount: 200 });
  });

  test('an expected fulfillment failure still credits a paid QR in the same callback attempt', async () => {
    const { product, user } = await fixture(1, 0);
    const bankConfig = {
      getBankConfigForRuntime: async () => ({ token: 'test-bank-token', bankId: 'CAKE', accountNo: '1234567890', template: 'compact2', accountName: 'TEST USER' }),
    } as unknown as BotConfigService;
    const realPurchases = purchaseService();
    const faultingPurchases = new Proxy(realPurchases, { get(target, property, receiver) {
      if (property === 'purchaseBatchInSession') return async () => { throw new OutOfStockError(); };
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
    const service = new PaymentService(mongoose.connection, PaymentRequestModel, walletService(), bankConfig,
      faultingPurchases);
    const checkout = await service.createBankCheckout(user._id.toString(), product._id.toString(), 1, 100,
      'fallback-wallet-credit');

    const result = await service.processCakeCallback([{ transactionID: '579740353', amount: 100,
      description: `THANH TOAN ${checkout.transferContent}`, transactionDate: '25/08/2026', type: 'IN' }]);

    expect(result.approved).toBe(1);
    expect((await UserModel.findById(user._id))?.walletBalance).toBe(100);
    expect(await OrderModel.countDocuments({ userId: user._id })).toBe(0);
    expect(await WalletTransactionModel.countDocuments({ type: 'DEPOSIT' })).toBe(1);
    const payment = await PaymentRequestModel.findById(checkout.id).lean();
    expect(payment?.providerReference).toBe('579740353');
    expect((payment?.metadata.quickCheckout as { status?: string }).status).toBe('FAILED');
  });

  test('an in-flight legacy QR hold still fulfills after the soft-checkout deployment', async () => {
    const { product, user } = await fixture(6, 0);
    const bankConfig = {
      getBankConfigForRuntime: async () => ({ token: 'test-bank-token', bankId: 'CAKE', accountNo: '1234567890', template: 'compact2', accountName: 'TEST USER' }),
    } as unknown as BotConfigService;
    const purchases = purchaseService();
    const requestId = new Types.ObjectId();
    const requestCode = 'DON1111111111111111';
    const expiresAt = new Date(Date.now() + 10 * 60_000);
    const session = await mongoose.connection.startSession();
    try {
      await session.withTransaction(async () => {
        await purchases.reserveBatchForPayment({ userId: user._id.toString(), productId: product._id.toString(),
          quantity: 6, expectedUnitPrice: 100, paymentRequestId: requestId.toString(), expiresAt }, session);
        await PaymentRequestModel.create([{ _id: requestId, requestCode, userId: user._id, amount: 600,
          provider: 'BANK_API', status: PaymentRequestStatus.PENDING, proofUrls: [],
          idempotencyKey: 'legacy-hard-hold-checkout', deletedAt: null, metadata: {
            source: 'telegram-bank-quick-checkout', transferContent: requestCode,
            expiresAt: expiresAt.toISOString(), quickCheckout: {
              productId: product._id.toString(), productName: product.name, quantity: 6, unitPrice: 100,
              totalAmount: 600, idempotencyPrefix: `quickpay:${requestCode}`, status: 'PENDING_PAYMENT',
            },
          } }], { session });
      });
    } finally { await session.endSession(); }

    const service = new PaymentService(mongoose.connection, PaymentRequestModel, walletService(), bankConfig, purchases);
    const retried = await service.createBankCheckout(user._id.toString(), product._id.toString(), 6, 100,
      'legacy-hard-hold-checkout');
    expect(retried.id).toBe(requestId.toString());
    await service.processCakeCallback([{ transactionID: '579740350', amount: 600,
      description: `THANH TOAN ${requestCode}`, transactionDate: '25/08/2026', type: 'IN' }]);

    expect(await OrderModel.countDocuments({ userId: user._id, productId: product._id })).toBe(6);
    expect((await UserModel.findById(user._id))?.walletBalance).toBe(0);
    expect(await InventoryItemModel.countDocuments({ productId: product._id,
      reservedPaymentRequestId: { $exists: true } })).toBe(0);
  });

  test('a late quick-checkout transfer credits the wallet but never consumes expired held stock', async () => {
    const { product, user } = await fixture(2, 0);
    const bankConfig = {
      getBankConfigForRuntime: async () => ({ token: 'test-bank-token', bankId: 'CAKE', accountNo: '1234567890', template: 'compact2', accountName: 'TEST USER' }),
    } as unknown as BotConfigService;
    const service = new PaymentService(mongoose.connection, PaymentRequestModel, walletService(), bankConfig, purchaseService());
    const checkout = await service.createBankCheckout(user._id.toString(), product._id.toString(), 2, 100, 'late-quick-checkout');
    const past = new Date(Date.now() - 60_000);
    await PaymentRequestModel.updateOne({ _id: checkout.id }, { $set: { 'metadata.expiresAt': past.toISOString() } });

    const result = await service.processCakeCallback([{ transactionID: '579740341', amount: 200,
      description: `THANH TOAN ${checkout.transferContent}`, transactionDate: '25/08/2026', type: 'IN' }]);

    expect(result.approved).toBe(1);
    expect((await UserModel.findById(user._id))!.walletBalance).toBe(200);
    expect(await OrderModel.countDocuments({ userId: user._id })).toBe(0);
    expect(await WalletTransactionModel.countDocuments({ userId: user._id, type: 'DEPOSIT' })).toBe(1);
    expect(await WalletTransactionModel.countDocuments({ userId: user._id, type: 'PURCHASE' })).toBe(0);
    expect(await InventoryItemModel.countDocuments({ productId: product._id, status: InventoryStatus.AVAILABLE })).toBe(2);
    const payment = await PaymentRequestModel.findById(checkout.id).lean();
    expect(payment?.status).toBe(PaymentRequestStatus.APPROVED);
    expect((payment?.metadata.quickCheckout as { status?: string; fulfillmentError?: string }).status).toBe('FAILED');
    expect((payment?.metadata.quickCheckout as { fulfillmentError?: string }).fulfillmentError).toContain('sau thời hạn');
  });

  test('an expired QR can be replaced without ever holding inventory', async () => {
    const { product, user } = await fixture(2, 0);
    const bankConfig = {
      getBankConfigForRuntime: async () => ({ token: 'test-bank-token', bankId: 'CAKE', accountNo: '1234567890', template: 'compact2', accountName: 'TEST USER' }),
    } as unknown as BotConfigService;
    const service = new PaymentService(mongoose.connection, PaymentRequestModel, walletService(), bankConfig, purchaseService());
    const abandoned = await service.createBankCheckout(user._id.toString(), product._id.toString(), 2, 100, 'abandoned-checkout');
    const past = new Date(Date.now() - 60_000);
    await PaymentRequestModel.updateOne({ _id: abandoned.id }, { $set: { 'metadata.expiresAt': past.toISOString() } });

    const replacement = await service.createBankCheckout(user._id.toString(), product._id.toString(), 2, 100, 'replacement-checkout');

    expect(replacement.id).not.toBe(abandoned.id);
    expect(await InventoryItemModel.countDocuments({ reservedPaymentRequestId: abandoned.id })).toBe(0);
    expect(await InventoryItemModel.countDocuments({ reservedPaymentRequestId: replacement.id })).toBe(0);
    expect(await InventoryItemModel.countDocuments({ productId: product._id,
      status: InventoryStatus.AVAILABLE })).toBe(2);
  });

  test('one customer can create only one active QR without holding inventory', async () => {
    const { product, user } = await fixture(4, 0, 2);
    const bankConfig = {
      getBankConfigForRuntime: async () => ({ token: 'test-bank-token', bankId: 'CAKE', accountNo: '1234567890', template: 'compact2', accountName: 'TEST USER' }),
    } as unknown as BotConfigService;
    const service = new PaymentService(mongoose.connection, PaymentRequestModel, walletService(), bankConfig, purchaseService());

    const results = await Promise.allSettled([
      service.createBankCheckout(user._id.toString(), product._id.toString(), 2, 100, 'parallel-checkout-one'),
      service.createBankCheckout(user._id.toString(), product._id.toString(), 2, 100, 'parallel-checkout-two'),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(await PaymentRequestModel.countDocuments({ userId: user._id, status: PaymentRequestStatus.PENDING })).toBe(1);
    expect(await InventoryItemModel.countDocuments({ productId: product._id,
      status: InventoryStatus.AVAILABLE })).toBe(4);
    expect(await InventoryItemModel.countDocuments({ productId: product._id,
      reservedPaymentRequestId: { $exists: true } })).toBe(0);
  });

  test('a customer can cancel an unpaid quick-checkout, create another QR, and a late transfer is preserved in the wallet', async () => {
    const { product, user } = await fixture(3, 0);
    const bankConfig = {
      getBankConfigForRuntime: async () => ({ token: 'test-bank-token', bankId: 'CAKE', accountNo: '1234567890', template: 'compact2', accountName: 'TEST USER' }),
    } as unknown as BotConfigService;
    const service = new PaymentService(mongoose.connection, PaymentRequestModel, walletService(), bankConfig, purchaseService());
    const abandoned = await service.createBankCheckout(user._id.toString(), product._id.toString(), 2, 100, 'cancel-unpaid-checkout');
    const stranger = await UserModel.create({ telegramId: '81234567890', status: UserStatus.ACTIVE, walletBalance: 0,
      referralCode: 'CANCELSTRANGER', purchaseCount: 0, deletedAt: null });

    await expect(service.cancelBankCheckout(abandoned.id, stranger._id.toString())).rejects.toThrow('Không tìm thấy mã thanh toán');
    const cancelled = await service.cancelBankCheckout(abandoned.id, user._id.toString());
    const replacement = await service.createBankCheckout(user._id.toString(), product._id.toString(), 1, 100, 'checkout-after-cancel');
    const transaction = { transactionID: '579740347', amount: 200,
      description: `THANH TOAN ${abandoned.transferContent}`, transactionDate: '25/08/2026', type: 'IN' };
    await service.processCakeCallback([transaction]);

    expect(cancelled).toMatchObject({ id: abandoned.id, status: PaymentRequestStatus.EXPIRED, cancelled: true });
    expect(replacement.id).not.toBe(abandoned.id);
    expect((await UserModel.findById(user._id))?.walletBalance).toBe(200);
    expect(await OrderModel.countDocuments({ userId: user._id })).toBe(0);
    expect(await WalletTransactionModel.countDocuments({ userId: user._id, type: 'DEPOSIT' })).toBe(1);
  });

  test('cancelling while the Cake callback arrives either fulfills once or preserves the whole payment', async () => {
    const { product, user } = await fixture(1, 0);
    const bankConfig = {
      getBankConfigForRuntime: async () => ({ token: 'test-bank-token', bankId: 'CAKE', accountNo: '1234567890', template: 'compact2', accountName: 'TEST USER' }),
    } as unknown as BotConfigService;
    const service = new PaymentService(mongoose.connection, PaymentRequestModel, walletService(), bankConfig, purchaseService());
    const checkout = await service.createBankCheckout(user._id.toString(), product._id.toString(), 1, 100, 'cancel-callback-race');
    const transaction = { transactionID: '579740349', amount: 100,
      description: `THANH TOAN ${checkout.transferContent}`, transactionDate: '25/08/2026', type: 'IN' };

    await Promise.all([service.cancelBankCheckout(checkout.id, user._id.toString()), service.processCakeCallback([transaction])]);

    const balance = (await UserModel.findById(user._id))?.walletBalance ?? -1;
    const orderCount = await OrderModel.countDocuments({ userId: user._id });
    expect(balance + orderCount * 100).toBe(100);
    expect(orderCount).toBeLessThanOrEqual(1);
    expect(await WalletTransactionModel.countDocuments({ userId: user._id, type: 'DEPOSIT' })).toBe(1);
  });

  test('an unpaid QR does not block a wallet buyer and a later transfer is kept in their wallet', async () => {
    const { product, user } = await fixture(2, 100, 1);
    const bankConfig = {
      getBankConfigForRuntime: async () => ({ token: 'test-bank-token', bankId: 'CAKE', accountNo: '1234567890', template: 'compact2', accountName: 'TEST USER' }),
    } as unknown as BotConfigService;
    const purchases = purchaseService();
    const service = new PaymentService(mongoose.connection, PaymentRequestModel, walletService(), bankConfig, purchases);
    const checkout = await service.createBankCheckout(user._id.toString(), product._id.toString(), 1, 100,
      'wallet-limit-active-qr');

    await expect(purchases.purchase({ userId: user._id.toString(), productId: product._id.toString(),
      expectedUnitPrice: 100, idempotencyKey: 'wallet-during-active-qr' })).resolves.toBeTruthy();

    await service.processCakeCallback([{ transactionID: '579740349', amount: 100,
      description: `THANH TOAN ${checkout.transferContent}`, transactionDate: '25/08/2026', type: 'IN' }]);
    expect(await OrderModel.countDocuments({ userId: user._id, productId: product._id })).toBe(1);
    expect((await UserModel.findById(user._id))?.walletBalance).toBe(100);
    const payment = await PaymentRequestModel.findById(checkout.id).lean();
    expect((payment?.metadata.quickCheckout as { status?: string }).status).toBe('FAILED');
  });

  test('many unpaid customers cannot lock scarce stock and direct QR quantity is capped', async () => {
    const { product } = await fixture(2, 0);
    const bankConfig = {
      getBankConfigForRuntime: async () => ({ token: 'test-bank-token', bankId: 'CAKE', accountNo: '1234567890', template: 'compact2', accountName: 'TEST USER' }),
    } as unknown as BotConfigService;
    const service = new PaymentService(mongoose.connection, PaymentRequestModel, walletService(), bankConfig, purchaseService());
    const attackers = await UserModel.insertMany(Array.from({ length: 8 }, (_, index) => ({
      telegramId: `90000000${index}`, status: UserStatus.ACTIVE, walletBalance: 0,
      referralCode: `ATTACK${index}`, purchaseCount: 0, deletedAt: null,
    })));

    await Promise.all(attackers.map((user, index) => service.createBankCheckout(user._id.toString(),
      product._id.toString(), 2, 100, `anti-hoarding-${index}`)));
    await expect(service.createBankCheckout(attackers[0]!._id.toString(), product._id.toString(),
      6, 100, 'anti-hoarding-too-many')).rejects.toThrow('tối đa 5');

    expect(await PaymentRequestModel.countDocuments({ status: PaymentRequestStatus.PENDING })).toBe(8);
    expect(await InventoryItemModel.countDocuments({ productId: product._id,
      status: InventoryStatus.AVAILABLE })).toBe(2);
    expect(await InventoryItemModel.countDocuments({ productId: product._id,
      reservedPaymentRequestId: { $exists: true } })).toBe(0);
  });

  test('two paid QR callbacks racing for the last item create one order and preserve the losing transfer', async () => {
    const { product, user: first } = await fixture(1, 0);
    const second = await UserModel.create({ telegramId: '900000099', status: UserStatus.ACTIVE, walletBalance: 0,
      referralCode: 'PAIDRACE', purchaseCount: 0, deletedAt: null });
    const bankConfig = {
      getBankConfigForRuntime: async () => ({ token: 'test-bank-token', bankId: 'CAKE', accountNo: '1234567890', template: 'compact2', accountName: 'TEST USER' }),
    } as unknown as BotConfigService;
    const service = new PaymentService(mongoose.connection, PaymentRequestModel, walletService(), bankConfig, purchaseService());
    const [firstCheckout, secondCheckout] = await Promise.all([
      service.createBankCheckout(first._id.toString(), product._id.toString(), 1, 100, 'paid-stock-race-first'),
      service.createBankCheckout(second._id.toString(), product._id.toString(), 1, 100, 'paid-stock-race-second'),
    ]);

    const results = await Promise.all([
      service.processCakeCallback([{ transactionID: '579740351', amount: 100,
        description: `THANH TOAN ${firstCheckout.transferContent}`, transactionDate: '25/08/2026', type: 'IN' }]),
      service.processCakeCallback([{ transactionID: '579740352', amount: 100,
        description: `THANH TOAN ${secondCheckout.transferContent}`, transactionDate: '25/08/2026', type: 'IN' }]),
    ]);

    expect(results.every((result) => result.approved === 1)).toBeTrue();
    expect(await OrderModel.countDocuments({ productId: product._id })).toBe(1);
    expect((await UserModel.findById(first._id))!.walletBalance +
      (await UserModel.findById(second._id))!.walletBalance).toBe(100);
    expect(await WalletTransactionModel.countDocuments({ type: 'DEPOSIT' })).toBe(2);
    expect(await WalletTransactionModel.countDocuments({ type: 'PURCHASE' })).toBe(1);
    const requests = await PaymentRequestModel.find({ _id: { $in: [firstCheckout.id, secondCheckout.id] } }).lean();
    expect(requests.map((request) => (request.metadata.quickCheckout as { status?: string }).status).sort())
      .toEqual(['FAILED', 'FULFILLED']);
  });

  test('Cake matches a transfer code directly even after more than 100 equal-amount pending requests', async () => {
    const { user } = await fixture(0, 0);
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const requests = Array.from({ length: 101 }, (_, index) => {
      const requestCode = `NAP${index.toString(16).toUpperCase().padStart(16, '0')}`;
      return { requestCode, userId: user._id, amount: 777, provider: 'BANK_API', status: PaymentRequestStatus.PENDING,
        proofUrls: [], idempotencyKey: `same-amount-${index.toString().padStart(3, '0')}`,
        metadata: { transferContent: requestCode, expiresAt }, deletedAt: null };
    });
    await PaymentRequestModel.insertMany(requests);
    const target = requests[100]!;
    const service = new PaymentService(mongoose.connection, PaymentRequestModel, walletService());

    const result = await service.processCakeCallback([{ transactionID: '579740342', amount: 777,
      description: `THANH TOAN ${target.requestCode}`, transactionDate: '25/08/2026', type: 'IN' }]);

    expect(result.approved).toBe(1);
    expect((await UserModel.findById(user._id))!.walletBalance).toBe(777);
    expect((await PaymentRequestModel.findOne({ requestCode: target.requestCode }))?.status).toBe(PaymentRequestStatus.APPROVED);
  });

  test('a retried Cake callback resumes an older approved checkout that has no orders yet', async () => {
    const { product, user } = await fixture(2, 0);
    const bankConfig = {
      getBankConfigForRuntime: async () => ({ token: 'test-bank-token', bankId: 'CAKE', accountNo: '1234567890', template: 'compact2', accountName: 'TEST USER' }),
    } as unknown as BotConfigService;
    const service = new PaymentService(mongoose.connection, PaymentRequestModel, walletService(), bankConfig, purchaseService());
    const checkout = await service.createBankCheckout(user._id.toString(), product._id.toString(), 2, 100, 'resume-approved-checkout');
    await UserModel.updateOne({ _id: user._id }, { $set: { walletBalance: 200 } });
    await PaymentRequestModel.updateOne({ _id: checkout.id }, { $set: {
      status: PaymentRequestStatus.APPROVED, providerReference: '579740344', reviewedAt: new Date(),
    } });

    const result = await service.processCakeCallback([{ transactionID: '579740344', amount: 200,
      description: `THANH TOAN ${checkout.transferContent}`, transactionDate: '25/08/2026', type: 'IN' }]);

    expect(result.approved).toBe(1);
    expect(await OrderModel.countDocuments({ userId: user._id })).toBe(2);
    expect((await UserModel.findById(user._id))?.walletBalance).toBe(0);
    const checked = await service.checkBankDeposit(checkout.id, user._id.toString());
    expect(checked.checkout).toMatchObject({ status: 'FULFILLED', quantity: 2 });
  });

  test('a second real transfer to the same QR credits the wallet without duplicating its orders', async () => {
    const { product, user } = await fixture(1, 0);
    const bankConfig = {
      getBankConfigForRuntime: async () => ({ token: 'test-bank-token', bankId: 'CAKE', accountNo: '1234567890', template: 'compact2', accountName: 'TEST USER' }),
    } as unknown as BotConfigService;
    const service = new PaymentService(mongoose.connection, PaymentRequestModel, walletService(), bankConfig, purchaseService());
    const checkout = await service.createBankCheckout(user._id.toString(), product._id.toString(), 1, 100, 'duplicate-real-transfer');
    const first = { transactionID: '579740345', amount: 100,
      description: `THANH TOAN ${checkout.transferContent}`, transactionDate: '25/08/2026', type: 'IN' };
    const second = { ...first, transactionID: '579740346' };

    await Promise.all([service.processCakeCallback([first]), service.processCakeCallback([second])]);
    await service.processCakeCallback([second]);

    expect(await OrderModel.countDocuments({ userId: user._id })).toBe(1);
    expect((await UserModel.findById(user._id))?.walletBalance).toBe(100);
    expect(await WalletTransactionModel.countDocuments({ userId: user._id, type: 'DEPOSIT' })).toBe(2);
    expect(await WalletTransactionModel.countDocuments({ userId: user._id, type: 'PURCHASE' })).toBe(1);
  });

  test('an underpayment with a valid checkout code is credited but never creates the quoted order', async () => {
    const { product, user } = await fixture(1, 0);
    const bankConfig = {
      getBankConfigForRuntime: async () => ({ token: 'test-bank-token', bankId: 'CAKE', accountNo: '1234567890', template: 'compact2', accountName: 'TEST USER' }),
    } as unknown as BotConfigService;
    const service = new PaymentService(mongoose.connection, PaymentRequestModel, walletService(), bankConfig, purchaseService());
    const checkout = await service.createBankCheckout(user._id.toString(), product._id.toString(), 1, 100, 'underpaid-checkout');
    const transaction = { transactionID: '579740348', amount: 90,
      description: `THANH TOAN ${checkout.transferContent}`, transactionDate: '25/08/2026', type: 'IN' };

    await service.processCakeCallback([transaction]);
    await service.processCakeCallback([transaction]);

    expect((await UserModel.findById(user._id))?.walletBalance).toBe(90);
    expect(await OrderModel.countDocuments({ userId: user._id })).toBe(0);
    expect(await WalletTransactionModel.countDocuments({ userId: user._id, type: 'DEPOSIT' })).toBe(1);
    expect(await InventoryItemModel.countDocuments({ productId: product._id, status: InventoryStatus.AVAILABLE })).toBe(1);
    const payment = await PaymentRequestModel.findById(checkout.id).lean();
    expect(payment?.status).toBe(PaymentRequestStatus.APPROVED);
    expect(payment?.metadata.amountMismatch).toEqual({ expected: 100, received: 90 });
    expect((payment?.metadata.quickCheckout as { status?: string }).status).toBe('FAILED');
    const checked = await service.checkBankDeposit(checkout.id, user._id.toString());
    expect(checked).toMatchObject({ amount: 100, receivedAmount: 90, status: PaymentRequestStatus.APPROVED });
    expect(checked.checkout?.fulfillmentError).toContain('90');
  });

  test('a bank transfer is reconciled to the wallet when the checkout user became inactive', async () => {
    const { product, user } = await fixture(1, 0);
    const bankConfig = {
      getBankConfigForRuntime: async () => ({ token: 'test-bank-token', bankId: 'CAKE', accountNo: '1234567890', template: 'compact2', accountName: 'TEST USER' }),
    } as unknown as BotConfigService;
    const service = new PaymentService(mongoose.connection, PaymentRequestModel, walletService(), bankConfig, purchaseService());
    const checkout = await service.createBankCheckout(user._id.toString(), product._id.toString(), 1, 100, 'inactive-user-transfer');
    await UserModel.updateOne({ _id: user._id }, { $set: { status: UserStatus.BLOCKED } });

    const result = await service.processCakeCallback([{ transactionID: '579740347', amount: 100,
      description: `THANH TOAN ${checkout.transferContent}`, transactionDate: '25/08/2026', type: 'IN' }]);

    expect(result.approved).toBe(1);
    expect((await UserModel.findById(user._id))?.walletBalance).toBe(100);
    expect(await OrderModel.countDocuments({ userId: user._id })).toBe(0);
    expect(await InventoryItemModel.countDocuments({ productId: product._id, status: InventoryStatus.AVAILABLE })).toBe(1);
    const payment = await PaymentRequestModel.findById(checkout.id).lean();
    expect((payment?.metadata.quickCheckout as { status?: string; fulfillmentError?: string }).status).toBe('FAILED');
    expect((payment?.metadata.quickCheckout as { fulfillmentError?: string }).fulfillmentError).toContain('tạm ngưng');
  });

  test('a delivery queue outage does not mark committed quick-checkout orders as failed', async () => {
    const { product, user } = await fixture(2, 0);
    const bankConfig = {
      getBankConfigForRuntime: async () => ({ token: 'test-bank-token', bankId: 'CAKE', accountNo: '1234567890', template: 'compact2', accountName: 'TEST USER' }),
    } as unknown as BotConfigService;
    let queueAvailable = false;
    const recoveringQueue = { enqueue: async (orderId: string) => {
      if (!queueAvailable) throw new Error('QStash unavailable');
      queued.push(orderId); return { id: orderId };
    } } as unknown as DeliveryQueue;
    const purchases = new PurchaseService(mongoose.connection, ProductModel, OrderModel, userRepository(), reservationService(),
      orderRepository(), walletRepository(), recoveringQueue);
    const service = new PaymentService(mongoose.connection, PaymentRequestModel, walletService(), bankConfig, purchases);
    const checkout = await service.createBankCheckout(user._id.toString(), product._id.toString(), 2, 100, 'queue-outage-checkout');

    const transaction = { transactionID: '579740343', amount: 200,
      description: `THANH TOAN ${checkout.transferContent}`, transactionDate: '25/08/2026', type: 'IN' };
    await service.processCakeCallback([transaction]);

    expect(await OrderModel.countDocuments({ userId: user._id })).toBe(2);
    expect(queued).toHaveLength(0);
    queueAvailable = true;
    await service.processCakeCallback([transaction]);
    expect(queued).toHaveLength(2);
    const payment = await PaymentRequestModel.findById(checkout.id).lean();
    expect((payment?.metadata.quickCheckout as { status?: string }).status).toBe('FULFILLED');
  });

  test('admin history pages expose users, wallet ledger, and redacted audit traces', async () => {
    const { user, adminId } = await fixture(0, 500);
    user.displayName = 'Trace Customer'; await user.save();
    await WalletTransactionModel.create({ userId: user._id, balanceBefore: 500, balanceAfter: 700, amount: 200,
      type: 'ADMIN_CREDIT', reason: 'History test credit', referenceType: 'USER', referenceId: user._id,
      idempotencyKey: 'history-test-credit', actorType: 'ADMIN', actorId: adminId, metadata: {} });
    await AuditLogModel.create({ actorType: 'ADMIN', actorId: adminId, action: 'HISTORY_TESTED', resourceType: 'User',
      resourceId: user._id, requestId: 'trace-history-test', metadata: {
        token: 'must-not-leak', authorization: 'Bearer secret', apiKey: 'private-api-key',
        nested: { credential: 'private-credential' }, safe: 'visible',
      } });
    const analytics = analyticsService();
    const users = await analytics.users({ page: 1, limit: 20, search: user.telegramId });
    const ledger = await analytics.walletTransactions({ page: 1, limit: 20, search: 'History test' });
    const traces = await analytics.auditLogs({ page: 1, limit: 20, requestId: 'trace-history-test' });
    expect(users.items).toHaveLength(1); expect(users.items[0]?.walletBalance).toBe(500);
    expect(ledger.items).toHaveLength(1); expect(ledger.items[0]?.idempotencyKey).toBe('history-test-credit');
    expect(traces.items).toHaveLength(1);
    expect(traces.items[0]?.metadata).toEqual({ token: '[REDACTED]', authorization: '[REDACTED]',
      apiKey: '[REDACTED]', nested: { credential: '[REDACTED]' }, safe: 'visible' });
  });

  test('admin wallet corrections are idempotent, audited in the ledger, and never create a negative balance', async () => {
    const { user, adminId } = await fixture(0, 500);
    user.status = UserStatus.SUSPENDED; await user.save();
    const wallets = walletService();

    const first = await wallets.adminAdjust(user._id, 250, 'CREDIT', 'Bù giao dịch chuyển khoản thiếu', adminId, 'admin-wallet:adjust-credit');
    const retry = await wallets.adminAdjust(user._id, 250, 'CREDIT', 'Bù giao dịch chuyển khoản thiếu', adminId, 'admin-wallet:adjust-credit');
    expect(first._id.toString()).toBe(retry._id.toString());
    expect((await UserModel.findById(user._id))?.walletBalance).toBe(750);
    expect(await WalletTransactionModel.countDocuments({ idempotencyKey: 'admin-wallet:adjust-credit' })).toBe(1);

    await wallets.adminAdjust(user._id, 125, 'DEBIT', 'Thu hồi số dư cộng nhầm', adminId, 'admin-wallet:adjust-debit');
    expect((await UserModel.findById(user._id))?.walletBalance).toBe(625);
    await expect(wallets.adminAdjust(user._id, 626, 'DEBIT', 'Không được âm ví', adminId, 'admin-wallet:adjust-too-much'))
      .rejects.toThrow('Insufficient wallet balance');
    expect((await UserModel.findById(user._id))?.walletBalance).toBe(625);
    await expect(wallets.adminAdjust(user._id, 250, 'CREDIT', 'Lý do khác cùng request', adminId, 'admin-wallet:adjust-credit'))
      .rejects.toThrow('Idempotency key was already used');
  });

  test('admin can identify and find an order buyer by Telegram @username', async () => {
    const { product, user } = await fixture(1, 100);
    user.username = 'buyer_handle';
    user.displayName = 'Buyer Name';
    await user.save();
    const order = await purchaseService().purchase({ userId: user._id.toString(), productId: product._id.toString(),
      expectedUnitPrice: 100, idempotencyKey: 'buyer-identity-order' });

    const result = await analyticsService().orders({ page: 1, limit: 20, search: '@buyer_handle' });

    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({ id: order._id.toString(), user: {
      id: user._id.toString(), username: 'buyer_handle', displayName: 'Buyer Name', telegramId: user.telegramId,
    } });
  });

  test('admin order detail joins customer, product, masked stock, and wallet accounting without encrypted payloads', async () => {
    const { product, user } = await fixture(1, 100);
    product.instructions = 'Đăng nhập và đổi mật khẩu ngay.';
    product.warrantyPolicy = 'Bảo hành nếu tài khoản sai.';
    await product.save();
    const order = await purchaseService().purchase({ userId: user._id.toString(), productId: product._id.toString(),
      expectedUnitPrice: 100, idempotencyKey: 'order-detail-admin' });

    const detail = await analyticsService().orderDetail(order._id.toString());

    expect(detail).toMatchObject({ id: order._id.toString(), orderCode: order.orderCode,
      user: { id: user._id.toString(), telegramId: user.telegramId, walletBalance: 0 },
      product: { id: product._id.toString(), instructions: 'Đăng nhập và đổi mật khẩu ngay.' },
      inventory: { id: order.inventoryItemId.toString(), maskedPreview: { password: 'se****-0' } },
      walletTransaction: { amount: -100, balanceBefore: 100, balanceAfter: 0, type: 'PURCHASE' },
    });
    expect(JSON.stringify(detail)).not.toContain('encryptedPayload');
    expect(JSON.stringify(detail)).not.toContain('secret-0');
  });

  test('a customer can report only their order once and an admin can resolve it', async () => {
    const { product, user, adminId } = await fixture(1);
    const order = await purchaseService().purchase({ userId: user._id.toString(), productId: product._id.toString(),
      expectedUnitPrice: 100, idempotencyKey: 'complaint-order' });
    const service = warrantyService();
    const first = await service.create({ userId: user._id.toString(), orderId: order._id.toString(),
      category: 'INVALID_CREDENTIALS', description: 'Tài khoản được giao không thể đăng nhập.' });
    const duplicate = await service.create({ userId: user._id.toString(), orderId: order._id.toString(),
      category: 'OTHER', description: 'Telegram gửi lại callback tạo khiếu nại.' });
    expect(duplicate.id).toBe(first.id);
    expect(duplicate.existing).toBeTrue();
    expect((await service.messages(first.id)).items).toHaveLength(1);

    const adminReply = await service.reply(first.id, adminId.toString(), 'Shop đang kiểm tra tài khoản cho bạn.',
      'complaint-chat-admin');
    expect(adminReply.status).toBe('SENT');
    await service.userReply(first.id, user._id.toString(), 'Mình vẫn chưa đăng nhập được.', 'complaint-chat-user');
    await service.userReply(first.id, user._id.toString(), 'Mình vẫn chưa đăng nhập được.', 'complaint-chat-user');
    const conversation = await service.messages(first.id);
    expect(conversation.items).toHaveLength(3);
    expect(conversation.items.map((item) => item.direction)).toEqual([
      'USER_TO_ADMIN', 'ADMIN_TO_USER', 'USER_TO_ADMIN',
    ]);

    const stranger = await fixture(0);
    await expect(service.create({ userId: stranger.user._id.toString(), orderId: order._id.toString(),
      category: 'OTHER', description: 'Không được báo cáo đơn của người khác.' })).rejects.toThrow('Order not found');

    const listed = await service.list({ page: 1, limit: 20, search: order.orderCode });
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0]).toMatchObject({ requestCode: first.requestCode, category: 'INVALID_CREDENTIALS',
      status: 'REVIEWING', order: { orderCode: order.orderCode }, user: { telegramId: user.telegramId },
      product: { name: product.name } });
    const resolved = await service.update(first.id, adminId.toString(), {
      status: 'RESOLVED', resolutionNote: 'Đã cấp sản phẩm thay thế cho khách.',
    }, 'resolve-complaint');
    expect(resolved).toMatchObject({ status: 'RESOLVED', resolutionNote: 'Đã cấp sản phẩm thay thế cho khách.',
      notificationSent: true });
    expect(await AuditLogModel.countDocuments({ action: 'WARRANTY_REQUEST_UPDATED', requestId: 'resolve-complaint' })).toBe(1);
    await expect(service.update(first.id, adminId.toString(), {
      status: 'RESOLVED', resolutionNote: 'Không được xử lý lặp lại.',
    }, 'duplicate-resolution')).rejects.toThrow('Invalid report status transition');
    expect(await AuditLogModel.countDocuments({ requestId: 'duplicate-resolution' })).toBe(0);
  });

  test('direct support chat and broadcasts are durable and idempotent', async () => {
    const { user, adminId } = await fixture(0);
    let directSends = 0;
    const messaging = new MessagingService(UserModel, CustomerMessageModel, NotificationModel, AuditLogModel,
      { sendSupportMessage: async () => { directSends++; return { message_id: directSends }; } } as never,
      { enqueue: async () => ({ id: 'queued' }) } as never);

    await Promise.all([
      messaging.sendDirect(adminId.toString(), user.telegramId, 'Shop trả lời khách.', 'same-direct-request'),
      messaging.sendDirect(adminId.toString(), user.telegramId, 'Shop trả lời khách.', 'same-direct-request'),
    ]);
    expect(directSends).toBe(1);
    await messaging.receiveUser({ userId: user._id.toString(), body: 'Khách phản hồi lại.',
      idempotencyKey: 'same-user-support-reply' });
    await messaging.receiveUser({ userId: user._id.toString(), body: 'Khách phản hồi lại.',
      idempotencyKey: 'same-user-support-reply' });
    const conversation = await messaging.list({ telegramId: user.telegramId, page: 1, limit: 20 });
    expect(conversation.total).toBe(2);
    expect(conversation.items.map((item) => item.direction)).toEqual(['ADMIN_TO_USER', 'USER_TO_ADMIN']);

    const second = await UserModel.create({ telegramId: '991122334455', status: UserStatus.ACTIVE, walletBalance: 0,
      referralCode: 'BROADCAST2', purchaseCount: 0, deletedAt: null });
    const campaign = await NotificationModel.create({ adminId, channel: 'ADMIN_WEB', title: 'Telegram broadcast',
      body: 'Thông báo thử nghiệm.', status: 'PENDING', referenceType: 'ADMIN_BROADCAST', metadata: {} });
    const deliveredTo: string[] = [];
    const processor = new AdminBroadcastProcessor({ telegram: { sendMessage: async (telegramId: string) => {
      deliveredTo.push(telegramId); return { message_id: deliveredTo.length };
    } } } as never);
    await processor.processBatch({ campaignId: campaign._id.toString() });
    await processor.processBatch({ campaignId: campaign._id.toString() });
    expect(deliveredTo.sort()).toEqual([user.telegramId, second.telegramId].sort());
    expect(await CustomerMessageModel.countDocuments({ campaignId: campaign._id, status: 'SENT' })).toBe(2);
    expect((await NotificationModel.findById(campaign._id))?.status).toBe('SENT');
  });

  test('5. rerunning a completed delivery job does not resend or resell', async () => {
    const { product, user } = await fixture(1);
    const order = await purchaseService().purchase({ userId: user._id.toString(), productId: product._id.toString(), expectedUnitPrice: 100, idempotencyKey: 'delivery-repeat' });
    let sends = 0;
    const bot = { telegram: { sendMessage: async () => { sends++; return { message_id: 42 }; } } };
    const processor = new DeliveryProcessor(bot as never, []);
    const job = { id: order._id.toString(), data: { orderId: order._id.toString() }, attemptsMade: 0, opts: { attempts: 3 } } as never;
    await processor.process(job); await processor.process(job);
    expect(sends).toBe(1);
    expect((await OrderModel.findById(order._id))!.status).toBe('DELIVERED');
    expect(await InventoryItemModel.countDocuments({ soldOrderId: order._id, status: InventoryStatus.SOLD })).toBe(1);
  });

  test('6. aborting between wallet debit and order completion rolls all writes back', async () => {
    const { product, user } = await fixture(1);
    const realOrders = orderRepository();
    const faultingOrders = new Proxy(realOrders, { get(target, property, receiver) {
      if (property === 'attachWalletTransaction') return async () => { throw new Error('injected transaction failure'); };
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
    const service = new PurchaseService(mongoose.connection, ProductModel, OrderModel, userRepository(), reservationService(),
      faultingOrders, walletRepository(), queueStub);
    await expect(service.purchase({ userId: user._id.toString(), productId: product._id.toString(), expectedUnitPrice: 100,
      idempotencyKey: 'rollback-order-test' })).rejects.toThrow('injected transaction failure');
    expect((await UserModel.findById(user._id))!.walletBalance).toBe(1000);
    expect(await OrderModel.countDocuments()).toBe(0);
    expect(await WalletTransactionModel.countDocuments()).toBe(0);
    expect((await InventoryItemModel.findOne({ productId: product._id }))!.status).toBe(InventoryStatus.AVAILABLE);
  });

  test('7. a temporary MongoDB disconnect fails closed without charging', async () => {
    const { product, user } = await fixture(1);
    await mongoose.disconnect();
    await expect(purchaseService().purchase({ userId: user._id.toString(), productId: product._id.toString(), expectedUnitPrice: 100,
      idempotencyKey: 'database-offline' })).rejects.toThrow();
    await mongoose.connect(mongoUri, { autoIndex: false });
    expect((await UserModel.findById(user._id))!.walletBalance).toBe(1000);
    expect(await OrderModel.countDocuments()).toBe(0);
  }, 20_000);

  test('8. a queued job survives a Redis worker restart', async () => {
    const port = 16_000 + Math.floor(Math.random() * 1000); let redisProcess: ChildProcess | undefined;
    try {
      redisProcess = spawn('redis-server', ['--port', String(port), '--save', '', '--appendonly', 'no'], { stdio: 'ignore' });
      await new Promise((resolve) => setTimeout(resolve, 300));
      const connection = redisConnectionOptions(`redis://127.0.0.1:${port}`);
      const queue = new Queue('restart-test', { connection });
      await queue.add('delivery', { orderId: 'order-1' }, { jobId: 'order-1' });
      const workerCode = `import { Worker } from 'bullmq';
        const worker = new Worker('restart-test', async () => { console.log('ACTIVE'); await new Promise(() => {}); },
          { connection: { host: '127.0.0.1', port: ${port} }, lockDuration: 500, stalledInterval: 200 });
        process.on('SIGTERM', () => worker.close(true));`;
      const firstWorker = spawn(process.execPath, ['-e', workerCode], { stdio: ['ignore', 'pipe', 'ignore'] });
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('first worker did not claim job')), 5000);
        firstWorker.stdout!.on('data', (chunk) => { if (String(chunk).includes('ACTIVE')) { clearTimeout(timeout); resolve(); } });
      });
      firstWorker.kill('SIGKILL'); await once(firstWorker, 'exit');
      const completed = new Promise<string>((resolve) => {
        const secondWorker = new Worker('restart-test', async (job) => job.data.orderId,
          { connection, lockDuration: 500, stalledInterval: 200, maxStalledCount: 2 });
        secondWorker.on('completed', async (_, result) => { await secondWorker.close(); resolve(result as string); });
      });
      expect(await Promise.race([completed, new Promise((_, reject) => setTimeout(() => reject(new Error('job was not recovered')), 10_000))])).toBe('order-1');
      await queue.add('delivery', { orderId: 'order-2' }, { jobId: 'order-2', attempts: 1 });
      const failingWorker = new Worker('restart-test', async () => { throw new Error('permanent delivery failure'); }, { connection });
      await once(failingWorker, 'failed'); await failingWorker.close();
      await new DeliveryQueue(queue).requeue('order-2');
      const retried = new Promise<string>((resolve) => {
        const retryWorker = new Worker('restart-test', async (job) => job.data.orderId, { connection });
        retryWorker.on('completed', async (_, result) => { await retryWorker.close(); resolve(result as string); });
      });
      expect(await Promise.race([retried, new Promise((_, reject) => setTimeout(() => reject(new Error('failed job was not requeued')), 5000))])).toBe('order-2');
      await queue.close();
    } finally { redisProcess?.kill('SIGTERM'); }
  }, 20_000);

  test('9. an unattempted expired reservation is released and refunded atomically', async () => {
    const { product, user } = await fixture(1);
    const order = await purchaseService().purchase({ userId: user._id.toString(), productId: product._id.toString(), expectedUnitPrice: 100, idempotencyKey: 'expiry-test' });
    await InventoryItemModel.updateOne({ reservedOrderId: order._id }, { $set: { reservationExpiresAt: new Date(Date.now() - 1000) } });
    const service = new InventoryReservationService(mongoose.connection, OrderModel, inventoryRepository(), userRepository(), walletRepository());
    expect((await service.releaseExpired()).released).toBe(1);
    expect((await UserModel.findById(user._id))!.walletBalance).toBe(1000);
    expect((await InventoryItemModel.findOne({ productId: product._id }))!.status).toBe(InventoryStatus.AVAILABLE);
    const processor = new DeliveryProcessor({ telegram: { sendMessage: async () => ({ message_id: 1 }) } } as never, []);
    await processor.onFailed({ data: { orderId: order._id.toString() }, attemptsMade: 1 } as never, new Error('stale worker failure'));
    expect((await OrderModel.findById(order._id))!.status).toBe('CANCELLED');
  });

  test('10. inventory import rejects duplicates by default and overwrites an available duplicate only after confirmation', async () => {
    const { product, adminId } = await fixture(0);
    const importer = new InventoryImportService(ProductModel, InventoryItemModel, ImportBatchModel);
    const row = { login: 'duplicate@example.invalid', password: 'secret' };
    const preview = await importer.preview(product._id.toString(), [row, {}]);
    expect('prepared' in preview).toBeFalse();
    expect(JSON.stringify(preview)).not.toContain('"password":"secret"');
    expect(preview.errors).toContainEqual({ line: 2, reason: 'Blank row skipped' });
    const first = await importer.commit(product._id.toString(), [row, row], adminId.toString(), 'first.csv');
    const second = await importer.commit(product._id.toString(), [row], adminId.toString(), 'second.csv');
    expect(first.importedRows).toBe(1); expect(first.duplicateRows).toBe(1);
    expect(second.importedRows).toBe(0); expect(second.duplicateRows).toBe(1);
    const overwritten = await importer.commit(product._id.toString(), [row], adminId.toString(), 'confirmed.csv', true);
    expect(overwritten).toMatchObject({ importedRows: 0, overwrittenRows: 1, duplicateRows: 1 });
    expect(await InventoryItemModel.countDocuments()).toBe(1);
    const item = await InventoryItemModel.findOne().select('+encryptedPayload');
    expect(item?.importBatchId?.toString()).toBe(overwritten.batchId.toString());
    expect(encryption.decrypt<Record<string, unknown>>(item!.encryptedPayload)).toEqual(row);

    const safeBatchId = item!.importBatchId!.toString();
    const ciphertext = item!.encryptedPayload;
    const beforeRace = await importer.preview(product._id.toString(), [row]);
    expect(beforeRace).toMatchObject({ duplicateRows: 1, overwriteableRows: 1 });
    await InventoryItemModel.updateOne({ _id: item!._id }, { $set: { status: InventoryStatus.RESERVED } });
    const protectedReserved = await importer.commit(product._id.toString(), [row], adminId.toString(),
      'reserved-protected.csv', true);
    expect(protectedReserved).toMatchObject({ importedRows: 0, overwrittenRows: 0, duplicateRows: 1 });
    expect(protectedReserved.skipped.some((entry) => entry.reason.includes('cannot be overwritten'))).toBeTrue();
    let protectedItem = await InventoryItemModel.findById(item!._id).select('+encryptedPayload');
    expect(protectedItem?.importBatchId?.toString()).toBe(safeBatchId);
    expect(protectedItem?.encryptedPayload).toBe(ciphertext);

    await InventoryItemModel.updateOne({ _id: item!._id }, { $set: { status: InventoryStatus.SOLD } });
    const protectedSold = await importer.commit(product._id.toString(), [row], adminId.toString(),
      'sold-protected.csv', true);
    expect(protectedSold).toMatchObject({ importedRows: 0, overwrittenRows: 0, duplicateRows: 1 });
    protectedItem = await InventoryItemModel.findById(item!._id).select('+encryptedPayload');
    expect(protectedItem?.importBatchId?.toString()).toBe(safeBatchId);
    expect(protectedItem?.encryptedPayload).toBe(ciphertext);
  });

  test('successful stock import queues one restock announcement batch', async () => {
    const { product, adminId } = await fixture(0);
    const queuedAlerts: Array<{ productId: string; importBatchId: string; importedRows: number }> = [];
    const alerts = { enqueue: async (job: { productId: string; importBatchId: string; importedRows: number }) => {
      queuedAlerts.push(job); return { id: job.importBatchId };
    } } as unknown as StockAlertQueue;
    const importer = new InventoryImportService(ProductModel, InventoryItemModel, ImportBatchModel, alerts);
    const result = await importer.commit(product._id.toString(), [{ login: 'restock@example.invalid', password: 'secret' }], adminId.toString(), 'restock.txt');
    expect(result.importedRows).toBe(1);
    expect(result.restockNotificationQueued).toBeTrue();
    expect(queuedAlerts).toHaveLength(1);
    expect(queuedAlerts[0]).toMatchObject({ productId: product._id.toString(), importedRows: 1 });
  });

  test('restock queue uses a BullMQ-safe idempotency key', async () => {
    let options: { jobId?: string } | undefined;
    const queue = { add: async (_name: string, _job: unknown, next: { jobId?: string }) => {
      options = next; return { id: next.jobId };
    } };
    const alerts = new StockAlertQueue(queue as never);
    await alerts.enqueue({ productId: new Types.ObjectId().toString(), importBatchId: new Types.ObjectId().toString(), importedRows: 1 });
    expect(options?.jobId).toStartWith('product-restocked-');
    expect(options?.jobId).not.toContain(':');
  });

  test('a restock batch notifies each Telegram customer at most once', async () => {
    const { product, user } = await fixture(0);
    let messages = 0;
    const processor = new StockAlertProcessor({ telegram: { sendMessage: async () => {
      messages++; return { message_id: 1 };
    } } } as never);
    const job = { id: 'restock-batch-test', data: { productId: product._id.toString(), importBatchId: new Types.ObjectId().toString(), importedRows: 3 } } as never;
    await processor.process(job);
    await processor.process(job);
    expect(messages).toBe(1);
    expect(await NotificationModel.countDocuments({ userId: user._id, channel: 'TELEGRAM', status: 'SENT' })).toBe(1);
  });

  test('a real purchase sends one anonymous social-proof message to other customers', async () => {
    const { product, user: buyer } = await fixture(0);
    const observer = await UserModel.create({ telegramId: '900000777', status: UserStatus.ACTIVE,
      walletBalance: 0, referralCode: 'PROOFOBSERVER', purchaseCount: 0, deletedAt: null });
    const messages: Array<{ chatId: string | number; text: string }> = [];
    const processor = new PurchaseAlertProcessor({ telegram: { sendMessage: async (chatId: string | number, text: string) => {
      messages.push({ chatId, text }); return { message_id: 1 };
    } } } as never);
    const task = { purchaseGroupId: new Types.ObjectId().toString(), productId: product._id.toString(),
      buyerId: buyer._id.toString(), quantity: 3 };

    await processor.processBatch(task);
    await processor.processBatch(task);

    expect(messages).toHaveLength(1);
    expect(messages[0]?.chatId).toBe(observer.telegramId);
    expect(messages[0]?.text).toContain(product.name);
    expect(messages[0]?.text).toContain('Số lượng: *3*');
    expect(messages[0]?.text).not.toContain(buyer.telegramId);
    expect(await NotificationModel.countDocuments({ userId: observer._id,
      referenceType: 'PURCHASE_SOCIAL_PROOF', status: 'SENT' })).toBe(1);
  });

  test('11. an unknown encryption key version cannot be decrypted', () => {
    const old = new EncryptionService({ 1: '0123456789abcdef0123456789abcdef' }, 1);
    const encrypted = old.encrypt({ secret: 'value' });
    const rotatedWithoutOldKey = new EncryptionService({ 2: 'abcdef0123456789abcdef0123456789' }, 2);
    expect(() => rotatedWithoutOldKey.decrypt(encrypted)).toThrow('Unknown encryption key version 1');
  });

  test('12. an admin without sensitive inventory permission is denied', async () => {
    const { adminId } = await fixture(1);
    const item = await InventoryItemModel.findOne();
    const service = new InventoryAdminService(InventoryItemModel, AuditLogModel);
    await expect(service.readFullPayload(item!._id.toString(), adminId.toString(), ['inventory.list'])).rejects.toThrow('Sensitive inventory permission required');
    expect(await AuditLogModel.countDocuments()).toBe(0);
  });

  test('admin can explicitly refund a failed delivery without returning ambiguous inventory to stock', async () => {
    const { product, user, adminId } = await fixture(1);
    const order = await purchaseService().purchase({ userId: user._id.toString(), productId: product._id.toString(),
      expectedUnitPrice: 100, idempotencyKey: 'manual-delivery-refund' });
    await OrderModel.updateOne({ _id: order._id }, { $set: { status: 'DELIVERY_FAILED', deliveryStatus: 'FAILED' } });
    const recovery = new DeliveryRecoveryService(mongoose.connection, OrderModel, InventoryItemModel,
      inventoryRepository(), walletService(), queueStub);
    await recovery.refund(order._id.toString(), adminId.toString());
    expect((await OrderModel.findById(order._id))!.status).toBe('REFUNDED');
    expect((await UserModel.findById(user._id))!.walletBalance).toBe(1000);
    expect((await InventoryItemModel.findOne({ productId: product._id }))!.status).toBe(InventoryStatus.DISABLED);
  });

  test('admin bot token configuration is encrypted, masked, and audited', async () => {
    const adminId = new Types.ObjectId();
    const rawToken = '123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcd123456';
    const service = new BotConfigService(SettingModel, AuditLogModel, async () => ({
      id: 123456789, username: 'fixture_bot', first_name: 'Fixture',
    }));
    const result = await service.updateToken(rawToken, adminId.toString(), 'request-bot-token');
    expect(result.botUsername).toBe('fixture_bot');
    expect(result.maskedToken).toEndWith('3456');
    const setting = await SettingModel.findOne({ key: 'telegram.bot_token' }).lean();
    expect(JSON.stringify(setting!.value)).not.toContain(rawToken);
    const stored = setting!.value as { encryptedToken: string };
    expect(encryption.decrypt<string>(stored.encryptedToken)).toBe(rawToken);
    const publicConfig = await service.getPublicConfig();
    expect(JSON.stringify(publicConfig)).not.toContain('encryptedToken');
    expect(await AuditLogModel.countDocuments({ action: 'TELEGRAM_BOT_TOKEN_UPDATED' })).toBe(1);
  });

  test('admin runtime configuration hot-reloads and never exposes the QStash token', async () => {
    const adminId = new Types.ObjectId();
    const rawQstashToken = 'qstash-runtime-secret-that-must-not-be-returned';
    const service = new BotConfigService(SettingModel, AuditLogModel, async () => ({
      id: 123456789, username: 'fixture_bot', first_name: 'Fixture',
    }));
    const saved = await service.updateRuntimeConfig({
      shopName: 'Runtime Shop', adminTelegramIds: '123456789,987654321', apiUrl: 'http://api:3001',
      telegramWebhookUrl: '', qstashUrl: 'https://qstash-us-east-1.upstash.io', taskBaseUrl: '',
      qstashToken: rawQstashToken,
    }, adminId.toString(), 'request-runtime-config');
    expect(saved.runtime.maskedQstashToken).toEndWith('rned');
    expect(JSON.stringify(saved)).not.toContain(rawQstashToken);
    const setting = await SettingModel.findOne({ key: 'runtime.operational_config' }).lean();
    expect(JSON.stringify(setting!.value)).not.toContain(rawQstashToken);
    const runtime = await service.getRuntimeOperationalConfig();
    expect(runtime).toMatchObject({ shopName: 'Runtime Shop', apiUrl: 'http://api:3001',
      adminTelegramIds: ['123456789', '987654321'], qstashToken: rawQstashToken, source: 'database' });
    const publicConfig = await service.getPublicConfig();
    expect(JSON.stringify(publicConfig)).not.toContain(rawQstashToken);
    expect(await AuditLogModel.countDocuments({ action: 'RUNTIME_CONFIG_UPDATED' })).toBe(1);
  });

  test('admin can create, list, update, and archive products', async () => {
    const adminId = new Types.ObjectId();
    const service = new ProductService(mongoose.connection, ProductModel, InventoryItemModel, AuditLogModel);
    const input = {
      name: 'Managed Product', slug: 'managed-product', description: 'Created from the admin product form',
      price: 250, status: ProductStatus.DRAFT, imageUrls: [], instructions: '', warrantyPolicy: '', warrantyDays: 7,
      deliveryTemplate: 'Login: {{login}}', fieldDefinitions: [
        { name: 'Login', key: 'login', type: 'EMAIL' as const, sensitive: false, visibleToCustomer: true, required: true, sortOrder: 1 },
      ], purchaseLimitPerUser: 0, lowStockThreshold: 2, sortOrder: 1,
    };
    const created = await service.create(input, adminId.toString(), 'create-product');
    expect(created.slug).toBe('managed-product');
    expect((await service.list())[0]).toMatchObject({ name: 'Managed Product', availableStock: 0 });
    const updated = await service.update(created._id.toString(), { ...input, price: 300, status: ProductStatus.ACTIVE },
      adminId.toString(), 'update-product');
    expect(updated.price).toBe(300); expect(updated.status).toBe(ProductStatus.ACTIVE);
    const payload = { login: 'managed@example.invalid' };
    await InventoryItemModel.create({ productId: created._id, encryptedPayload: encryption.encrypt(payload),
      maskedPreview: payload, payloadHash: encryption.normalizedHash(payload), status: InventoryStatus.AVAILABLE,
      createdBy: adminId, deletedAt: null });
    const compatibleFields = [...input.fieldDefinitions,
      { name: 'Ghi chú', key: 'note', type: 'STRING' as const, sensitive: false, visibleToCustomer: true, required: false, sortOrder: 2 }];
    await service.update(created._id.toString(), { ...input, price: 300, status: ProductStatus.ACTIVE,
      fieldDefinitions: compatibleFields }, adminId.toString(), 'compatible-fields');
    const renamedFields = compatibleFields.map((field) => field.key === 'login' ? { ...field, key: 'api' } : field);
    const renamed = await service.update(created._id.toString(), { ...input, price: 300, status: ProductStatus.ACTIVE,
      fieldDefinitions: renamedFields, inventoryPattern: 'login----note' }, adminId.toString(), 'rename-login-to-api');
    expect(renamed.inventoryPattern).toBe('api----note');
    expect(renamed.deliveryTemplate).toContain('{{api}}');
    const renamedItem = await InventoryItemModel.findOne({ productId: created._id }).select('+encryptedPayload +payloadHash');
    expect(encryption.decrypt<Record<string, unknown>>(renamedItem!.encryptedPayload)).toEqual({ api: 'managed@example.invalid' });
    expect(renamedItem!.maskedPreview).toMatchObject({ api: 'managed@example.invalid' });
    expect(renamedItem!.payloadHash).toBe(encryption.normalizedHash({ api: 'managed@example.invalid' }));
    await expect(service.update(created._id.toString(), { ...input, deliveryTemplate: 'Static', fieldDefinitions: [compatibleFields[1]!] },
      adminId.toString(), 'unsafe-fields')).rejects.toThrow('cannot be removed');
    await expect(service.update(created._id.toString(), { ...input, price: 300, status: ProductStatus.ACTIVE,
      fieldDefinitions: compatibleFields.map((field) => field.key === 'login' ? { ...field, sensitive: true } : field) },
    adminId.toString(), 'unsafe-visibility')).rejects.toThrow('visibility cannot change');
    const archivedInput = Object.assign(new SaveProductDto(), { ...input, status: ProductStatus.ARCHIVED });
    expect((await validate(archivedInput)).some((error) => error.property === 'status')).toBeTrue();
    await service.archive(created._id.toString(), adminId.toString(), 'archive-product');
    expect(await service.list()).toHaveLength(0);
    expect(await AuditLogModel.countDocuments({ resourceType: 'Product' })).toBe(5);
  });

  test('admin can create a text-only product with a free-form inventory key and pattern', async () => {
    const adminId = new Types.ObjectId();
    const service = new ProductService(mongoose.connection, ProductModel, InventoryItemModel, AuditLogModel);
    const created = await service.create({
      name: 'Numeric Key Product', slug: 'numeric-key-product', description: 'Supports a 2FA field',
      price: 100, status: ProductStatus.DRAFT, imageUrls: [], instructions: '', warrantyPolicy: '', warrantyDays: 0,
      deliveryTemplate: '2FA: {{Mã 2FA tùy ý}}',
      inventoryPattern: 'Email={{email}} | Password={{password}} / OTP={{Mã 2FA tùy ý}}', fieldDefinitions: [
        { name: 'Email', key: 'email', type: 'EMAIL', sensitive: false, visibleToCustomer: true, required: true, sortOrder: 1 },
        { name: 'Mật khẩu', key: 'password', type: 'STRING', sensitive: true, visibleToCustomer: true, required: true, sortOrder: 2 },
        { name: '2FA', key: 'Mã 2FA tùy ý', type: 'EMAIL', sensitive: true, visibleToCustomer: true, required: true, sortOrder: 3 },
      ], purchaseLimitPerUser: 0, lowStockThreshold: 1, sortOrder: 0,
    }, adminId.toString(), 'numeric-product-key');
    expect(created.fieldDefinitions.map((field) => field.key)).toEqual(['email', 'password', 'Mã 2FA tùy ý']);
    expect(created.fieldDefinitions.every((field) => field.type === 'STRING')).toBeTrue();
    expect(created.inventoryPattern).toBe('Email={{email}} | Password={{password}} / OTP={{Mã 2FA tùy ý}}');
    const preview = await new InventoryImportService(ProductModel, InventoryItemModel, ImportBatchModel).preview(
      created._id.toString(), [{ email: 'không cần đúng định dạng email', password: 123456, 'Mã 2FA tùy ý': true }],
    );
    expect(preview.validRows).toBe(1);
    expect(preview.invalidRows).toBe(0);
  });

  test('a rejected key rename leaves every product and inventory payload unchanged', async () => {
    const adminId = new Types.ObjectId();
    const product = await ProductModel.create({ name: 'Rename rollback', slug: `rename-rollback-${new Types.ObjectId()}`,
      description: 'Rename rollback fixture', price: 100, status: ProductStatus.ACTIVE, imageUrls: [], warrantyDays: 0,
      deliveryTemplate: 'Login: {{login}}', inventoryPattern: 'login', fieldDefinitions: [
        { name: 'Login', key: 'login', type: 'STRING', sensitive: true, visibleToCustomer: true, required: true, sortOrder: 1 },
      ], purchaseLimitPerUser: 0, lowStockThreshold: 1, sortOrder: 0, createdBy: adminId, updatedBy: adminId, deletedAt: null });
    const validPayload = { login: 'still-here' };
    const valid = await InventoryItemModel.create({ productId: product._id, encryptedPayload: encryption.encrypt(validPayload),
      maskedPreview: { login: 'st******re' }, payloadHash: encryption.normalizedHash(validPayload), status: InventoryStatus.AVAILABLE,
      createdBy: adminId, deletedAt: null });
    await InventoryItemModel.create({ productId: product._id, encryptedPayload: encryption.encrypt({}), maskedPreview: {},
      payloadHash: encryption.normalizedHash({}), status: InventoryStatus.AVAILABLE, createdBy: adminId, deletedAt: null });
    const service = new ProductService(mongoose.connection, ProductModel, InventoryItemModel, AuditLogModel);
    const renamedInput = {
      name: product.name, slug: product.slug, description: product.description, price: product.price, status: ProductStatus.ACTIVE,
      imageUrls: [], instructions: '', warrantyPolicy: '', warrantyDays: 0, deliveryTemplate: 'Login: {{login}}', inventoryPattern: 'login',
      fieldDefinitions: [{ name: 'API', key: 'api', type: 'STRING' as const, sensitive: true, visibleToCustomer: true, required: true, sortOrder: 1 }],
      purchaseLimitPerUser: 0, lowStockThreshold: 1, sortOrder: 0,
    };
    await expect(service.update(product._id.toString(), renamedInput, adminId.toString(), 'rename-rollback')).rejects.toThrow('missing required field login');
    expect((await ProductModel.findById(product._id))!.fieldDefinitions[0]!.key).toBe('login');
    const unchanged = await InventoryItemModel.findById(valid._id).select('+encryptedPayload +payloadHash');
    expect(encryption.decrypt<Record<string, unknown>>(unchanged!.encryptedPayload)).toEqual(validPayload);
    expect(unchanged!.payloadHash).toBe(encryption.normalizedHash(validPayload));
  });

  test('admin inventory list is paginated, masked, and can search an import batch safely', async () => {
    const { product, adminId } = await fixture(0);
    const imported = await new InventoryImportService(ProductModel, InventoryItemModel, ImportBatchModel).commit(product._id.toString(), [
      { login: 'listed-one@example.invalid', password: 'raw-password-one' },
      { login: 'listed-two@example.invalid', password: 'raw-password-two' },
      { login: 'listed-three@example.invalid', password: 'raw-password-three' },
    ], adminId.toString(), 'listed.txt');
    const service = new InventoryAdminService(InventoryItemModel, AuditLogModel, mongoose.connection,
      ImportBatchModel, ProductModel);
    const page = await service.list({ page: 1, limit: 2, search: imported.batchId.toString() });
    expect(page).toMatchObject({ page: 1, limit: 2, total: 3, totalPages: 2 });
    expect(page.items).toHaveLength(2);
    expect(page.items[0]).toMatchObject({ productId: product._id.toString(), status: InventoryStatus.AVAILABLE, importBatchId: imported.batchId.toString() });
    expect(JSON.stringify(page.items)).not.toContain('raw-password-one');
    expect((await service.list({ page: 2, limit: 2, query: imported.batchId.toString() })).items).toHaveLength(1);
    const revealed = await service.readFullPayload(page.items[0]!.id, adminId.toString(),
      ['inventory.read_sensitive'], 'formatted-reveal');
    expect(revealed).toMatchObject({ productId: product._id.toString(),
      inventoryPattern: '{{login}}----{{password}}' });
    expect(revealed.formatted).toMatch(/^listed-(?:one|two|three)@example\.invalid----raw-password-(?:one|two|three)$/);
    expect('payload' in revealed).toBeFalse();
    expect(await AuditLogModel.countDocuments({ action: 'INVENTORY_PAYLOAD_READ',
      requestId: 'formatted-reveal' })).toBe(1);
  });

  test('admin can remove only available inventory and bulk removal preserves reserved and sold rows', async () => {
    const { product, adminId } = await fixture(0);
    const imported = await new InventoryImportService(ProductModel, InventoryItemModel, ImportBatchModel).commit(product._id.toString(), [
      { login: 'remove-one@example.invalid', password: 'delete-me-1' },
      { login: 'remove-two@example.invalid', password: 'delete-me-2' },
      { login: 'reserved@example.invalid', password: 'protect-reserved' },
      { login: 'sold@example.invalid', password: 'protect-sold' },
    ], adminId.toString(), 'mistake.txt');
    const rows = await InventoryItemModel.find({ importBatchId: imported.batchId }).sort({ createdAt: 1, _id: 1 });
    const [firstAvailable, secondAvailable, reserved, sold] = rows;
    await InventoryItemModel.updateOne({ _id: reserved!._id }, { $set: { status: InventoryStatus.RESERVED } });
    await InventoryItemModel.updateOne({ _id: sold!._id }, { $set: { status: InventoryStatus.SOLD } });
    const service = new InventoryAdminService(InventoryItemModel, AuditLogModel, mongoose.connection,
      ImportBatchModel, ProductModel);

    expect(await service.removeItem(firstAvailable!._id.toString(), adminId.toString(), 'remove-one')).toMatchObject({ removed: true });
    expect((await InventoryItemModel.findById(firstAvailable!._id))!.deletedAt).toBeTruthy();
    await expect(service.removeItem(reserved!._id.toString(), adminId.toString(), 'remove-reserved')).rejects.toThrow('Chỉ có thể xóa hàng đang có sẵn');

    const cleared = await service.removeBatch(imported.batchId.toString(), adminId.toString(), 'remove-batch');
    expect(cleared).toMatchObject({ removedCount: 1, protectedCount: 2 });
    expect((await InventoryItemModel.findById(secondAvailable!._id))!.deletedAt).toBeTruthy();
    expect((await InventoryItemModel.findById(reserved!._id))!).toMatchObject({ status: InventoryStatus.RESERVED, deletedAt: null });
    expect((await InventoryItemModel.findById(sold!._id))!).toMatchObject({ status: InventoryStatus.SOLD, deletedAt: null });
    expect(await AuditLogModel.countDocuments({ action: 'INVENTORY_ITEM_REMOVED' })).toBe(1);
    expect(await AuditLogModel.countDocuments({ action: 'INVENTORY_BATCH_AVAILABLE_REMOVED' })).toBe(1);
  });
});
