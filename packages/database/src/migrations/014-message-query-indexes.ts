import { createHash } from 'node:crypto';
import type { Connection } from 'mongoose';
import type { MongoMigration } from './types';

const indexes = [
  { keys: { conversationType: 1, createdAt: -1, _id: -1, userId: 1, audience: 1 }, name: 'messages_conversation_latest' },
  { keys: { userId: 1, conversationType: 1, createdAt: -1, _id: -1, audience: 1 }, name: 'messages_user_latest' },
] as const;

export const messageQueryIndexesMigration: MongoMigration = {
  name: '014-message-query-indexes',
  checksum: createHash('sha256').update('014-message-query-indexes-v1').digest('hex'),
  async up(connection: Connection) {
    for (const index of indexes) {
      await connection.collection('customer_messages').createIndex(index.keys, { name: index.name });
    }
  },
  async down(connection: Connection) {
    for (const index of [...indexes].reverse()) {
      await connection.collection('customer_messages').dropIndex(index.name).catch(() => undefined);
    }
  },
};
