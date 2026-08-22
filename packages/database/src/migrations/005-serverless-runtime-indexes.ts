import { createHash } from 'node:crypto';
import type { Connection } from 'mongoose';
import type { MongoMigration } from './types';

const source = '005-serverless-runtime-indexes-v1';

/** Indexes introduced for stateless Telegram webhook/session and QStash retry safety. */
export const serverlessRuntimeIndexesMigration: MongoMigration = {
  name: '005-serverless-runtime-indexes',
  checksum: createHash('sha256').update(source).digest('hex'),
  async up(connection: Connection) {
    await connection.collection('bot_sessions').createIndex({ chatId: 1, telegramUserId: 1 }, { unique: true, name: 'chatId_1_telegramUserId_1' });
    await connection.collection('bot_sessions').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'expiresAt_1' });
    // Sparse means existing notifications without a task id remain untouched.
    await connection.collection('notifications').createIndex({ deduplicationKey: 1 }, { unique: true, sparse: true, name: 'deduplicationKey_1' });
  },
  async down(connection: Connection) {
    await Promise.all([
      connection.collection('bot_sessions').dropIndex('chatId_1_telegramUserId_1').catch(() => undefined),
      connection.collection('bot_sessions').dropIndex('expiresAt_1').catch(() => undefined),
      connection.collection('notifications').dropIndex('deduplicationKey_1').catch(() => undefined),
    ]);
  },
};
