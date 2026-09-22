import { createHash } from 'node:crypto';
import type { Connection } from 'mongoose';
import type { MongoMigration } from './types';

const indexes = [
  { collection: 'orders', keys: { createdAt: -1, _id: -1 }, name: 'admin_history_created_id' },
  { collection: 'payment_requests', keys: { deletedAt: 1, createdAt: -1, _id: -1 }, name: 'admin_history_active_created_id' },
  { collection: 'users', keys: { deletedAt: 1, createdAt: -1, _id: -1 }, name: 'admin_history_active_created_id' },
  { collection: 'wallet_transactions', keys: { createdAt: -1, _id: -1 }, name: 'admin_history_created_id' },
  { collection: 'audit_logs', keys: { createdAt: -1, _id: -1 }, name: 'admin_history_created_id' },
] as const;

export const adminHistoryIndexesMigration: MongoMigration = {
  name: '011-admin-history-indexes',
  checksum: createHash('sha256').update('011-admin-history-indexes-v1').digest('hex'),
  async up(connection: Connection) {
    for (const index of indexes) {
      await connection.collection(index.collection).createIndex(index.keys, { name: index.name });
    }
    // Production disables autoIndex; backfill this already-declared inventory index as well.
    await connection.collection('inventory_items').createIndex({ importBatchId: 1, createdAt: 1 },
      { sparse: true, name: 'importBatchId_1_createdAt_1' });
  },
  async down(connection: Connection) {
    for (const index of [...indexes].reverse()) {
      await connection.collection(index.collection).dropIndex(index.name).catch(() => undefined);
    }
  },
};
