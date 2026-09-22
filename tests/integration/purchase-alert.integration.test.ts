import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import mongoose, { type Connection, Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import {
  NotificationChannel, NotificationModel, NotificationSchema, NotificationStatus, ProductModel, ProductSchema,
  UserModel, UserSchema, customerMessageId,
} from '@store/database';
import { ProductStatus, UserStatus } from '@store/shared';
import { PurchaseAlertProcessor, type PurchaseAlertBatch } from '../../apps/bot/src/purchase-alert.processor';
import { BroadcastRetryError, type BroadcastSender } from '../../apps/bot/src/broadcast-sender';

const integration = process.env.RUN_INTEGRATION === '1' ? describe : describe.skip;
const immediateSender: BroadcastSender = { send: async (_chatId, deliver) => deliver() };

integration('purchase announcement claims against isolated MongoDB', () => {
  let server: MongoMemoryServer;
  let connection: Connection;
  const models = (db: Connection) => ({
    notifications: db.model('Notification', NotificationSchema, 'notifications'),
    products: db.model('Product', ProductSchema, 'products'),
    users: db.model('User', UserSchema, 'users'),
  });
  let db: ReturnType<typeof models>;
  const notificationWrites: string[] = [];

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    connection = await new mongoose.Mongoose().createConnection(server.getUri('purchase_alerts'), {
      autoIndex: false, monitorCommands: true,
    }).asPromise();
    db = models(connection);
    await Promise.all(Object.values(db).map((model) => model.createIndexes()));
    connection.getClient().on('commandStarted', (event) => {
      if (event.command.findAndModify === 'notifications' || event.command.update === 'notifications'
        || event.command.insert === 'notifications') notificationWrites.push(event.commandName);
    });
  }, 120_000);

  beforeEach(async () => {
    await Promise.all([db.notifications.deleteMany({}), db.products.deleteMany({}), db.users.deleteMany({})]);
    spyOn(ProductModel, 'findOne').mockImplementation(db.products.findOne.bind(db.products) as never);
    spyOn(UserModel, 'find').mockImplementation(db.users.find.bind(db.users) as never);
    spyOn(NotificationModel, 'findOne').mockImplementation(db.notifications.findOne.bind(db.notifications) as never);
    spyOn(NotificationModel, 'findOneAndUpdate').mockImplementation(db.notifications.findOneAndUpdate.bind(db.notifications) as never);
    spyOn(NotificationModel, 'updateOne').mockImplementation(db.notifications.updateOne.bind(db.notifications) as never);
    notificationWrites.length = 0;
  });
  afterEach(() => mock.restore());
  afterAll(async () => { await connection?.close(); await server?.stop(); }, 30_000);

  async function fixture(recipientCount = 1) {
    const buyerId = new Types.ObjectId();
    const product = await db.products.create({ name: 'Isolated announcement', slug: 'isolated-announcement',
      description: 'Test product', price: 100, status: ProductStatus.ACTIVE,
      createdBy: buyerId, updatedBy: buyerId, deletedAt: null });
    const recipients = await db.users.insertMany(Array.from({ length: recipientCount }, (_, index) => ({
      _id: new Types.ObjectId((index + 1).toString(16).padStart(24, '0')), telegramId: String(index + 1),
      referralCode: `REFERRAL${index}`, status: UserStatus.ACTIVE, deletedAt: null,
    })));
    const input: PurchaseAlertBatch = { productId: product._id.toString(), buyerId: buyerId.toString(),
      purchaseGroupId: new Types.ObjectId().toString(), quantity: 1, limit: recipientCount };
    const key = (index: number) => `purchase-proof:${input.purchaseGroupId}:${recipients[index]!._id}`;
    return { input, recipients, key,
      async seed(index: number, status: typeof NotificationStatus[keyof typeof NotificationStatus], updatedAt: Date) {
        await db.notifications.collection.insertOne({
          _id: customerMessageId(key(index)), userId: recipients[index]!._id, channel: NotificationChannel.TELEGRAM,
          title: 'Existing purchase', body: 'Existing announcement', status,
          referenceType: 'PURCHASE_SOCIAL_PROOF', referenceId: new Types.ObjectId(input.purchaseGroupId),
          deduplicationKey: key(index), metadata: {}, errorCode: 'OLD_ERROR', createdAt: updatedAt, updatedAt,
        });
      },
      record(index: number) { return db.notifications.findOne({ deduplicationKey: key(index) }).lean(); },
    };
  }

  test('a fresh recipient needs only the atomic claim and the sent write', async () => {
    const sample = await fixture();
    const sendMessage = mock(async () => ({ message_id: 1 }));
    notificationWrites.length = 0;

    const result = await new PurchaseAlertProcessor({ telegram: { sendMessage } }, immediateSender).processBatch(sample.input);

    expect(result).toMatchObject({ sent: 1, failed: 0, skipped: 0 });
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(notificationWrites).toEqual(['findAndModify', 'update']);
    expect(await sample.record(0)).toMatchObject({ _id: customerMessageId(sample.key(0)), status: NotificationStatus.SENT });
  });

  test('two concurrent workers only send a fresh recipient once', async () => {
    const sample = await fixture();
    const releaseDelivery = gate();
    const deliveryStarted = gate();
    const losingWorkerFinished = gate();
    const sendMessage = mock(async () => {
      deliveryStarted.open();
      await releaseDelivery.promise;
      return { message_id: 1 };
    });
    const run = () => new PurchaseAlertProcessor({ telegram: { sendMessage } }, immediateSender).processBatch(sample.input)
      .catch((error) => { losingWorkerFinished.open(); throw error; });
    const processing = Promise.allSettled([run(), run()]);
    try {
      await within(deliveryStarted.promise);
      await within(losingWorkerFinished.promise);
      expect(sendMessage).toHaveBeenCalledTimes(1);
      expect(await sample.record(0)).toMatchObject({ status: NotificationStatus.SENDING });
    } finally { releaseDelivery.open(); }
    const results = await processing;
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected?.status === 'rejected' && rejected.reason).toBeInstanceOf(BroadcastRetryError);
    expect(await db.notifications.countDocuments({})).toBe(1);
    expect(await sample.record(0)).toMatchObject({ status: NotificationStatus.SENT });
  });

  test('terminal recipients remain unchanged while pending and expired claims are recovered', async () => {
    const sample = await fixture(4);
    const earlier = new Date(Date.now() - 6 * 60_000);
    await sample.seed(0, NotificationStatus.SENT, earlier);
    await sample.seed(1, NotificationStatus.FAILED, earlier);
    await sample.seed(2, NotificationStatus.PENDING, earlier);
    await sample.seed(3, NotificationStatus.SENDING, earlier);
    const sendMessage = mock(async (chatId: string | number) => ({ message_id: Number(chatId) }));

    const result = await new PurchaseAlertProcessor({ telegram: { sendMessage } }, immediateSender).processBatch(sample.input);

    expect(result).toMatchObject({ sent: 2, failed: 1, skipped: 1 });
    expect(sendMessage.mock.calls.map(([chatId]) => chatId).sort()).toEqual(['3', '4']);
    expect(await sample.record(0)).toMatchObject({ status: NotificationStatus.SENT, updatedAt: earlier });
    expect(await sample.record(1)).toMatchObject({ status: NotificationStatus.FAILED, updatedAt: earlier });
    for (const index of [2, 3]) {
      expect(await sample.record(index)).toMatchObject({ status: NotificationStatus.SENT });
      expect((await sample.record(index))?.errorCode).toBeUndefined();
    }
  });

  test('losing a live five-minute claim does not refresh the owner lease', async () => {
    const sample = await fixture();
    const claimedAt = new Date(Date.now() - 60_000);
    await sample.seed(0, NotificationStatus.SENDING, claimedAt);
    const sendMessage = mock(async () => ({ message_id: 1 }));
    const failure = await new PurchaseAlertProcessor({ telegram: { sendMessage } }, immediateSender)
      .processBatch(sample.input).catch((error) => error);

    expect(failure).toBeInstanceOf(BroadcastRetryError);
    expect(failure.retryAfterMs).toBeGreaterThan(235_000);
    expect(failure.retryAfterMs).toBeLessThanOrEqual(240_000);
    expect(sendMessage).not.toHaveBeenCalled();
    expect(await sample.record(0)).toMatchObject({ status: NotificationStatus.SENDING, updatedAt: claimedAt });
  });

  test('a MongoDB failure recording SENT leaves the successful send claimed', async () => {
    const sample = await fixture();
    const sendMessage = mock(async () => ({ message_id: 1 }));
    await connection.db!.command({ collMod: 'notifications', validator: { status: { $ne: NotificationStatus.SENT } } });
    try {
      await expect(new PurchaseAlertProcessor({ telegram: { sendMessage } }, immediateSender).processBatch(sample.input))
        .rejects.toMatchObject({ code: 121 });
      expect(sendMessage).toHaveBeenCalledTimes(1);
      expect(await sample.record(0)).toMatchObject({ status: NotificationStatus.SENDING });
      expect((await sample.record(0))?.errorCode).toBeUndefined();
    } finally { await connection.db!.command({ collMod: 'notifications', validator: {} }); }
  });
});

function gate() {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => { open = resolve; });
  return { open, promise };
}
async function within(promise: Promise<void>) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([promise, new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => reject(new Error('Concurrent worker did not reach its checkpoint')), 3_000);
    })]);
  } finally { clearTimeout(timeout); }
}
