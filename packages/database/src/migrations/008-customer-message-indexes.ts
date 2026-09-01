import { createHash } from 'node:crypto';
import type { Connection } from 'mongoose';
import type { MongoMigration } from './types';

const source = '008-customer-message-indexes-v2';

export const customerMessageIndexesMigration: MongoMigration = {
  name: '008-customer-message-indexes',
  checksum: createHash('sha256').update(source).digest('hex'),
  async up(connection: Connection) {
    const messages = connection.collection('customer_messages');
    // Use Mongoose's default names so this migration is also safe after a
    // development environment has already created the same schema indexes.
    await messages.createIndex({ userId: 1, conversationType: 1, createdAt: -1 });
    await messages.createIndex({ warrantyRequestId: 1, createdAt: 1 });
    await messages.createIndex({ campaignId: 1, status: 1 });
    await messages.createIndex({ deduplicationKey: 1 }, { unique: true, sparse: true });
  },
  async down(connection: Connection) {
    const messages = connection.collection('customer_messages');
    for (const name of ['userId_1_conversationType_1_createdAt_-1', 'warrantyRequestId_1_createdAt_1',
      'campaignId_1_status_1', 'deduplicationKey_1']) {
      await messages.dropIndex(name).catch(() => undefined);
    }
  },
};
