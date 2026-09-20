import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import mongoose, { type Connection } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoBroadcastRateGate } from '../apps/bot/src/broadcast-rate-store';

const integration = process.env.RUN_INTEGRATION === '1' ? describe : describe.skip;

test('broadcast rate configuration keeps the free limit and validates cooldowns', async () => {
  expect(() => new MongoBroadcastRateGate('test', 26)).toThrow('between 1 and 25');
  expect(() => new MongoBroadcastRateGate('test', 0)).toThrow('between 1 and 25');
  await expect(new MongoBroadcastRateGate().defer(Number.NaN)).rejects.toThrow('Invalid broadcast cooldown');
  await expect(new MongoBroadcastRateGate().defer(-1)).rejects.toThrow('Invalid broadcast cooldown');
});

integration('MongoDB shared broadcast rate gate', () => {
  let server: MongoMemoryServer;
  let connection: Connection;
  const states = () => connection.db!.collection('telegram_broadcast_rates');
  const gate = (limit = 25) => new MongoBroadcastRateGate('test-bot', limit, connection);

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    connection = await new mongoose.Mongoose().createConnection(server.getUri('broadcast_rates'),
      { autoIndex: false }).asPromise();
  }, 120_000);
  beforeEach(async () => { await states().deleteMany({}); });
  afterAll(async () => { await connection?.close(); await server?.stop(); }, 30_000);

  test('independent workers race on the first insert without exceeding a shared window', async () => {
    const decisions = await Promise.all(Array.from({ length: 12 }, (_, index) => gate(3).acquire(`${index + 1}`)));
    expect(decisions.filter((decision) => decision.granted)).toHaveLength(3);
    expect(decisions.filter((decision) => !decision.granted).every((decision) => decision.retryAfterMs > 0)).toBe(true);
    expect(await states().countDocuments()).toBe(1);
  });

  test('different campaigns share private-chat and group spacing', async () => {
    expect((await gate().acquire('123')).granted).toBe(true);
    const privateChat = await gate().acquire('123');
    expect(privateChat.granted).toBe(false);
    expect(privateChat.retryAfterMs).toBeGreaterThan(0);
    expect(privateChat.retryAfterMs).toBeLessThanOrEqual(1_000);
    expect((await gate().acquire('456')).granted).toBe(true);
    expect((await gate().acquire('-100123')).granted).toBe(true);
    const group = await gate().acquire('-100123');
    expect(group.granted).toBe(false);
    expect(group.retryAfterMs).toBeGreaterThan(1_000);
    expect(group.retryAfterMs).toBeLessThanOrEqual(3_000);
  });

  test('chat IDs are stored and matched as values, never aggregation expressions', async () => {
    expect((await gate().acquire('$serverNow')).granted).toBe(true);
    expect((await gate().acquire('$serverNow')).granted).toBe(false);
    expect((await states().findOne())!.events[0].chatId).toBe('$serverNow');
  });

  test('a cooldown is shared, cannot be shortened, and works before the first send', async () => {
    await gate().defer(30_000);
    const initial = (await states().findOne())!.blockedUntil as Date;
    await gate().defer(1);
    expect((await states().findOne())!.blockedUntil).toEqual(initial);
    const decision = await gate().acquire('123');
    expect(decision.granted).toBe(false);
    expect(decision.retryAfterMs).toBeGreaterThan(20_000);
    expect((await states().findOne())!.events).toHaveLength(0);
  });

  test('expired windows and cooldowns recover and old per-chat state is pruned', async () => {
    await gate().acquire('123');
    await gate().defer(30_000);
    await states().updateMany({}, [{ $set: {
      events: Array.from({ length: 100 }, (_, index) => ({ chatId: `${index}`,
        at: { $subtract: ['$$NOW', 3_100] } })),
      blockedUntil: { $subtract: ['$$NOW', 1] },
    } }]);
    expect((await gate().acquire('123')).granted).toBe(true);
    const state = (await states().findOne())!;
    expect(state.events).toHaveLength(1);
    expect(state.events[0].chatId).toBe('123');
    expect(state.events[0].at).toBeInstanceOf(Date);
  });

  test('a used window opens when its earliest event expires', async () => {
    const first = await gate(1).acquire('123');
    expect(first.granted).toBe(true);
    expect((await gate(1).acquire('456')).granted).toBe(false);
    await states().updateMany({}, [{ $set: {
      events: [{ chatId: '123', at: { $subtract: ['$$NOW', 1_100] } }],
    } }]);
    expect((await gate(1).acquire('456')).granted).toBe(true);
  });
});
