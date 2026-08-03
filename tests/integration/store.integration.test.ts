import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Queue, Worker } from 'bullmq';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { validate } from 'class-validator';
import { EncryptionService } from '@store/encryption';
import { redisConnectionOptions } from '@store/config';
import {
  AdminModel, AuditLogModel, ImportBatchModel, InventoryItemModel, InventoryRepository, NotificationModel,
  OrderModel, OrderRepository, PaymentRequestModel, ProductModel, RoleModel, SettingModel, UserModel,
  UserRepository, WalletTransactionModel, WalletTransactionRepository, WarrantyRequestModel,
} from '@store/database';
import { InventoryStatus, ProductStatus, UserStatus } from '@store/shared';
import { PurchaseService } from '../../apps/api/src/purchase/purchase.service';
import { DeliveryQueue } from '../../apps/api/src/delivery/delivery.queue';
import { WalletService } from '../../apps/api/src/wallet/wallet.service';
import { PaymentService } from '../../apps/api/src/payment/payment.service';
import { DeliveryProcessor } from '../../apps/bot/src/delivery.processor';
import { InventoryReservationService } from '../../apps/api/src/inventory/inventory-reservation.service';
import { InventoryImportService } from '../../apps/api/src/inventory/inventory-import.service';
import { InventoryAdminService } from '../../apps/api/src/inventory/inventory-admin.service';
import { DeliveryRecoveryService } from '../../apps/api/src/delivery/delivery-recovery.service';
import { BotConfigService } from '../../apps/api/src/bot-config/bot-config.service';
import { ProductService } from '../../apps/api/src/product/product.service';
import { SaveProductDto } from '../../apps/api/src/product/product.dto';

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

function purchaseService() {
  return new PurchaseService(mongoose.connection, ProductModel, OrderModel, userRepository(), reservationService(),
    orderRepository(), walletRepository(), queueStub);
}
function walletService() { return new WalletService(mongoose.connection, userRepository(), walletRepository()); }
function paymentService() { return new PaymentService(mongoose.connection, PaymentRequestModel, walletService()); }

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

  test('10. inventory import rejects duplicates in-file and in-database', async () => {
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
    expect(await InventoryItemModel.countDocuments()).toBe(1);
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
    await expect(service.update(created._id.toString(), { ...input, deliveryTemplate: 'Static', fieldDefinitions: [compatibleFields[1]!] },
      adminId.toString(), 'unsafe-fields')).rejects.toThrow('cannot be removed');
    await expect(service.update(created._id.toString(), { ...input, price: 300, status: ProductStatus.ACTIVE,
      fieldDefinitions: compatibleFields.map((field) => field.key === 'login' ? { ...field, sensitive: true } : field) },
    adminId.toString(), 'unsafe-visibility')).rejects.toThrow('visibility cannot change');
    const archivedInput = Object.assign(new SaveProductDto(), { ...input, status: ProductStatus.ARCHIVED });
    expect((await validate(archivedInput)).some((error) => error.property === 'status')).toBeTrue();
    await service.archive(created._id.toString(), adminId.toString(), 'archive-product');
    expect(await service.list()).toHaveLength(0);
    expect(await AuditLogModel.countDocuments({ resourceType: 'Product' })).toBe(4);
  });
});
