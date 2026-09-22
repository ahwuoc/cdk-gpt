import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import mongoose, { type Connection, type Model, type PipelineStage, Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  AuditLogSchema, CustomerMessageSchema, NotificationSchema, UserSchema,
  type AuditLog, type CustomerMessage, type Notification, type User,
} from '@store/database';
import { MessagingService } from '../../apps/api/src/messaging/messaging.service';
import { AdminConversationQueryDto } from '../../apps/api/src/messaging/messaging.dto';
import { messageQueryIndexesMigration } from '../../packages/database/src/migrations/014-message-query-indexes';

test('conversation cache refresh is an explicitly validated query flag', async () => {
  expect(await validate(plainToInstance(AdminConversationQueryDto, { refresh: '1' }))).toHaveLength(0);
  expect(await validate(plainToInstance(AdminConversationQueryDto, { refresh: 'invalid' }))).not.toHaveLength(0);
});

const integration = process.env.RUN_INTEGRATION === '1' ? describe : describe.skip;

integration('conversation query optimization against isolated MongoDB', () => {
  let server: MongoMemoryServer;
  let connection: Connection;
  let users: Model<User>;
  let messages: Model<CustomerMessage>;
  let notifications: Model<Notification>;
  let audits: Model<AuditLog>;
  let service: MessagingService;
  let failSend = false;
  const date = new Date('2026-09-01T06:00:00.000Z');
  const page = { page: 1, limit: 20 };

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    connection = await new mongoose.Mongoose().createConnection(server.getUri('messaging_queries'), { autoIndex: false }).asPromise();
    users = connection.model('User', UserSchema, 'users');
    messages = connection.model('CustomerMessage', CustomerMessageSchema, 'customer_messages');
    notifications = connection.model('Notification', NotificationSchema, 'notifications');
    audits = connection.model('AuditLog', AuditLogSchema, 'audit_logs');
    await messages.collection.createIndex({ userId: 1, conversationType: 1, createdAt: -1 });
  }, 120_000);

  beforeEach(async () => {
    await Promise.all([users.deleteMany({}), messages.deleteMany({}), notifications.deleteMany({}), audits.deleteMany({})]);
    failSend = false;
    service = new MessagingService(users, messages, notifications, audits, {
      sendSupportMessage: async () => {
        if (failSend) throw new Error('Telegram unavailable');
        return { message_id: 1 };
      },
    } as never, { enqueue: async () => ({ id: 'local-test-only' }) } as never);
  });
  afterAll(async () => { await connection?.close(); await server?.stop(); }, 30_000);

  async function customer(index: number, deletedAt: Date | null = null) {
    const _id = new Types.ObjectId();
    await users.collection.insertOne({ _id, telegramId: String(index), username: `buyer${index}`, displayName: `Customer ${index}`,
      status: 'ACTIVE', walletBalance: 0, referralCode: `REF${index}`, purchaseCount: 0, deletedAt, createdAt: date, updatedAt: date });
    return _id;
  }
  async function message(userId: Types.ObjectId, body: string, overrides: Partial<CustomerMessage> = {}) {
    const _id = new Types.ObjectId();
    await messages.collection.insertOne({ _id, userId, body, conversationType: 'DIRECT', direction: 'USER_TO_ADMIN',
      audience: 'DIRECT', status: 'RECEIVED', createdAt: date, updatedAt: date, ...overrides });
    return _id;
  }
  async function capture(query: AdminConversationQueryDto) {
    let pipeline: PipelineStage[] = [];
    const aggregate = messages.aggregate.bind(messages);
    const spy = spyOn(messages, 'aggregate').mockImplementation(((stages: PipelineStage[]) => {
      pipeline = stages;
      return aggregate(stages);
    }) as typeof messages.aggregate);
    try {
      const result = await service.listConversations({ ...query, refresh: '1' });
      return { result, pipeline, plan: await aggregate(pipeline).explain('executionStats') };
    } finally { spy.mockRestore(); }
  }

  test('predominantly broadcast history groups covered index entries and only loads page message bodies', async () => {
    const buyers = Array.from({ length: 400 }, (_, index) => ({ _id: new Types.ObjectId(), telegramId: String(index),
      username: `buyer${index}`, displayName: `Customer ${index}`, status: 'ACTIVE', walletBalance: 0,
      referralCode: `REF${index}`, purchaseCount: 0, deletedAt: null, createdAt: date, updatedAt: date }));
    await users.collection.insertMany(buyers);
    await messages.collection.insertMany(Array.from({ length: 2_560 }, (_, index) => ({
      _id: new Types.ObjectId(), userId: buyers[index % buyers.length]!._id,
      body: `${index < 400 ? 'Direct' : 'Broadcast'} message ${index} ${'x'.repeat(1_000)}`,
      conversationType: 'DIRECT', direction: 'ADMIN_TO_USER', audience: index < 400 ? 'DIRECT' : 'BROADCAST',
      status: 'SENT', createdAt: new Date(date.getTime() + index * 1_000), updatedAt: date,
    })));
    const before = await capture(page);
    const beforeCursor = before.plan.stages.find((stage: { $cursor?: unknown }) => stage.$cursor).$cursor;
    expect(beforeCursor.executionStats.totalDocsExamined).toBe(2_560);

    await messageQueryIndexesMigration.up(connection);
    const after = await capture(page);
    expect(after.result).toEqual(before.result);
    expect(after.result.total).toBe(400);
    expect(after.result.items).toHaveLength(20);
    expect(after.result.items[0]).toMatchObject({ user: { telegramId: '399' }, messageCount: 1 });
    const cursor = after.plan.stages.find((stage: { $cursor?: unknown }) => stage.$cursor).$cursor;
    expect(cursor.executionStats.totalDocsExamined).toBe(0);
    expect(cursor.executionStats.totalKeysExamined).toBeGreaterThan(0);
    expect(JSON.stringify(cursor.queryPlanner.winningPlan)).not.toContain('COLLSCAN');
    expect(JSON.stringify(cursor.queryPlanner.winningPlan)).toContain('messages_conversation_latest');
    const facet = after.plan.stages.find((stage: { $facet?: unknown }) => stage.$facet).$facet;
    const bodyLookup = facet.items.find((stage: { $lookup?: unknown }) => stage.$lookup);
    expect(Number(bodyLookup.totalDocsExamined)).toBe(20);
  });

  test('latest messages, totals and stable pagination exclude broadcasts, warranty threads and deleted or missing users', async () => {
    const first = await customer(1);
    const second = await customer(2);
    const deleted = await customer(3, new Date());
    await message(first, 'Old first message');
    const latest = await message(first, 'Latest first message');
    const secondLatest = await message(second, 'Legacy direct message');
    await messages.collection.updateOne({ _id: secondLatest }, { $unset: { audience: '' } });
    await message(first, 'Broadcast must not be latest', { audience: 'BROADCAST' });
    await message(first, 'Complaint must not be latest', { conversationType: 'COMPLAINT' });
    await message(deleted, 'Deleted user');
    await message(new Types.ObjectId(), 'Missing user');
    const result = await service.listConversations({ page: 1, limit: 1 });
    expect(result).toMatchObject({ total: 2, totalPages: 2, items: [{ user: { telegramId: '2' },
      messageCount: 1, lastMessage: { id: secondLatest.toString(), body: 'Legacy direct message' } }] });
    const next = await service.listConversations({ page: 2, limit: 1 });
    expect(next.items[0]).toMatchObject({ user: { telegramId: '1' }, messageCount: 2,
      lastMessage: { id: latest.toString(), body: 'Latest first message' } });
    expect((await service.listConversations({ page: 3, limit: 1 })).items).toEqual([]);
    const history = await service.list({ telegramId: '1', ...page });
    expect(history.total).toBe(2);
    expect(history.items.map((item) => item.body)).toEqual(['Old first message', 'Latest first message']);
  });

  test('search considers user identity and only the latest direct message, with literal regex characters', async () => {
    const buyer = await customer(1);
    await message(buyer, 'Older unrelated searchable text');
    await message(buyer, 'Latest has literal .*');
    await message(buyer, 'Broadcast must not match', { audience: 'BROADCAST' });
    for (const search of ['@buyer1', 'Customer 1', '1', '.*']) {
      expect((await service.listConversations({ ...page, search })).total).toBe(1);
    }
    for (const search of ['unrelated searchable', 'Broadcast must', 'Customer 2']) {
      expect((await service.listConversations({ ...page, search })).total).toBe(0);
    }
  });

  test('cached pages share in-flight reads and explicit refresh sees writes from a different worker', async () => {
    const buyer = await customer(1);
    await message(buyer, 'First');
    const first = service.listConversations(page);
    expect(service.listConversations(page)).toBe(first);
    await first;
    await message(buyer, 'Written elsewhere');
    expect((await service.listConversations(page)).items[0]?.lastMessage.body).toBe('First');
    expect((await service.listConversations({ ...page, refresh: '1' })).items[0]?.lastMessage.body).toBe('Written elsewhere');
  });

  test('received messages and direct-send status changes invalidate inbox caches without waiting for expiry', async () => {
    const buyer = await customer(1);
    expect((await service.listConversations(page)).total).toBe(0);
    const incoming = { userId: buyer.toString(), body: 'Incoming support', idempotencyKey: 'incoming-support-1' };
    await service.receiveUser(incoming);
    expect((await service.listConversations(page)).items[0]?.lastMessage.body).toBe(incoming.body);
    await service.receiveUser(incoming);
    expect((await service.listConversations(page)).items[0]?.messageCount).toBe(1);
    await service.sendDirect(new Types.ObjectId().toString(), '1', 'Shop reply', 'local-reply-1');
    expect((await service.listConversations(page)).items[0]?.lastMessage).toMatchObject({ body: 'Shop reply', status: 'SENT' });
    failSend = true;
    await expect(service.sendDirect(new Types.ObjectId().toString(), '1', 'Failed reply', 'local-reply-2')).rejects.toThrow('Telegram');
    expect((await service.listConversations(page)).items[0]?.lastMessage).toMatchObject({ body: 'Failed reply', status: 'FAILED' });
  });

  test('an older in-flight inbox read cannot repopulate the cache after receiving a message', async () => {
    const buyer = await customer(1);
    await message(buyer, 'Old snapshot');
    let release!: () => void;
    let captured!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { captured = resolve; });
    const aggregate = messages.aggregate.bind(messages);
    let first = true;
    const spy = spyOn(messages, 'aggregate').mockImplementation((async (stages: PipelineStage[]) => {
      const rows = await aggregate(stages);
      if (first) { first = false; captured(); await pending; }
      return rows;
    }) as never);
    const oldRead = service.listConversations(page);
    try {
      await started;
      await service.receiveUser({ userId: buyer.toString(), body: 'Fresh snapshot', idempotencyKey: 'in-flight-new-message' });
      expect((await service.listConversations(page)).items[0]?.lastMessage.body).toBe('Fresh snapshot');
      release();
      expect((await oldRead).items[0]?.lastMessage.body).toBe('Old snapshot');
      expect((await service.listConversations(page)).items[0]?.lastMessage.body).toBe('Fresh snapshot');
    } finally { release(); await oldRead; spy.mockRestore(); }
  });

  test('message indexes are idempotent and rollback preserves the historical per-user index', async () => {
    await messageQueryIndexesMigration.up(connection);
    await messageQueryIndexesMigration.up(connection);
    expect((await messages.collection.indexes()).some((index) => index.name === 'messages_user_latest')).toBe(true);
    await messageQueryIndexesMigration.down(connection);
    const remaining = await messages.collection.indexes();
    expect(remaining.some((index) => index.name === 'messages_user_latest')).toBe(false);
    expect(remaining.some((index) => index.name === 'userId_1_conversationType_1_createdAt_-1')).toBe(true);
  });
});
