import { randomUUID } from 'node:crypto';
import mongoose, { type Connection } from 'mongoose';
import { isMongoDuplicateKey } from '@store/shared';

export interface BroadcastRateGate {
  acquire(chatId: string): Promise<{ granted: boolean; retryAfterMs: number }>;
  defer(retryAfterMs: number): Promise<void>;
}

interface BroadcastRateState {
  _id: string;
  events: { chatId: string; at: Date }[];
  blockedUntil: Date;
  decisionToken?: string;
  retryAt: Date;
  globalRetryAt: Date;
  serverNow: Date;
}

const WINDOW_MS = 1_000;
const GROUP_INTERVAL_MS = 3_000;
const EPOCH = new Date(0);

/** A bounded, atomic rate window shared by every worker using this database. */
export class MongoBroadcastRateGate implements BroadcastRateGate {
  private globallyBlockedUntil = 0;
  constructor(private readonly namespace = 'store-broadcast', private readonly limit = 25,
    private readonly connection: Connection = mongoose.connection) {
    if (!namespace || namespace.length > 100) throw new Error('Invalid broadcast rate namespace');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 25) {
      throw new Error('Broadcast rate must be between 1 and 25 messages per second');
    }
  }

  async acquire(chatId: string) {
    const remaining = this.globallyBlockedUntil - performance.now();
    // Cache only rejections. Every grant still goes through the shared atomic gate.
    if (remaining > 0) return { granted: false, retryAfterMs: Math.ceil(remaining) };
    const token = randomUUID();
    const chatInterval = chatId.startsWith('-') ? GROUP_INTERVAL_MS : WINDOW_MS;
    const pipeline = [
      { $set: {
        events: { $filter: { input: { $ifNull: ['$events', []] }, as: 'event',
          cond: { $gt: ['$$event.at', { $subtract: ['$$NOW', GROUP_INTERVAL_MS] }] } } },
        blockedUntil: { $ifNull: ['$blockedUntil', EPOCH] },
        serverNow: '$$NOW',
      } },
      { $set: {
        recent: { $filter: { input: '$events', as: 'event',
          cond: { $gt: ['$$event.at', { $subtract: ['$$NOW', WINDOW_MS] }] } } },
        chatRecent: { $filter: { input: '$events', as: 'event', cond: { $and: [
          { $eq: ['$$event.chatId', { $literal: chatId }] },
          { $gt: ['$$event.at', { $subtract: ['$$NOW', chatInterval] }] },
        ] } } },
      } },
      { $set: { globalRetryAt: { $max: [
        '$$NOW', '$blockedUntil',
        { $cond: [{ $gte: [{ $size: '$recent' }, this.limit] },
          { $add: [{ $min: '$recent.at' }, WINDOW_MS] }, '$$NOW'] },
      ] } } },
      { $set: { retryAt: { $max: [
        '$globalRetryAt',
        { $cond: [{ $gt: [{ $size: '$chatRecent' }, 0] },
          { $add: [{ $max: '$chatRecent.at' }, chatInterval] }, '$$NOW'] },
      ] } } },
      { $set: {
        events: { $cond: [{ $lte: ['$retryAt', '$$NOW'] },
          { $concatArrays: ['$events', [{ chatId: { $literal: chatId }, at: '$$NOW' }]] }, '$events'] },
        decisionToken: { $cond: [{ $lte: ['$retryAt', '$$NOW'] }, { $literal: token }, '$decisionToken'] },
      } },
      { $unset: ['recent', 'chatRecent'] },
    ];

    const result = await this.retryInsertRace(() => this.collection().findOneAndUpdate(
      { _id: this.namespace }, pipeline,
      { upsert: true, returnDocument: 'after', includeResultMetadata: false,
        projection: { decisionToken: 1, retryAt: 1, globalRetryAt: 1, serverNow: 1 } },
    ));
    if (!result) throw new Error('Broadcast rate decision was not persisted');
    const globalDelay = result.globalRetryAt.getTime() - result.serverNow.getTime();
    if (globalDelay > 0) {
      this.globallyBlockedUntil = Math.max(this.globallyBlockedUntil, performance.now() + globalDelay);
    }
    // Use MongoDB's clock for both dates; worker clock skew cannot shorten a wait.
    return { granted: result.decisionToken === token,
      retryAfterMs: Math.max(0, result.retryAt.getTime() - result.serverNow.getTime()) };
  }

  async defer(retryAfterMs: number) {
    if (!Number.isFinite(retryAfterMs) || retryAfterMs < 0) throw new Error('Invalid broadcast cooldown');
    await this.retryInsertRace(() => this.collection().updateOne({ _id: this.namespace }, [{ $set: {
      blockedUntil: { $max: [{ $ifNull: ['$blockedUntil', EPOCH] },
        { $add: ['$$NOW', Math.ceil(retryAfterMs)] }] },
      events: { $ifNull: ['$events', []] },
      serverNow: '$$NOW',
    } }], { upsert: true }));
  }

  private collection() {
    if (!this.connection.db) throw new Error('Broadcast rate database is not connected');
    // The built-in unique _id index works before migrations and with autoIndex=false.
    return this.connection.db.collection<BroadcastRateState>('telegram_broadcast_rates');
  }

  private async retryInsertRace<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); }
    catch (error) {
      if (!isMongoDuplicateKey(error)) throw error;
      return operation();
    }
  }
}
