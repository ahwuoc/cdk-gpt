import { createHash } from 'node:crypto';
import type { MongoMigration } from './types';

const indexes = [
  { collection: 'users', keys: { status: 1, deletedAt: 1, _id: 1 }, name: 'broadcast_active_cursor' },
  { collection: 'notifications', keys: { referenceType: 1, channel: 1, createdAt: -1, _id: -1 }, name: 'admin_broadcast_history' },
  { collection: 'payment_requests', keys: { provider: 1, status: 1, 'metadata.expiresAt': 1, createdAt: 1 }, name: 'bank_pending_expiry' },
  { collection: 'orders', keys: { 'metadata.paymentRequestId': 1, userId: 1, productId: 1 }, name: 'analytics_payment_checkout' },
  { collection: 'orders', keys: { 'metadata.purchaseGroupId': 1, userId: 1, productId: 1 }, name: 'analytics_wallet_checkout' },
  { collection: 'warranty_requests', keys: { createdAt: -1, _id: -1 }, name: 'report_history_created_id' },
  { collection: 'warranty_requests', keys: { status: 1, createdAt: -1, _id: -1 }, name: 'report_history_status_created_id' },
] as const;

export const operationalQueryIndexesMigration: MongoMigration = {
  name: '012-operational-query-indexes',
  checksum: createHash('sha256').update('012-operational-query-indexes-v1').digest('hex'),
  async up(connection) {
    for (const index of indexes) await connection.collection(index.collection).createIndex(index.keys, { name: index.name });
  },
  async down(connection) {
    for (const index of [...indexes].reverse()) {
      await connection.collection(index.collection).dropIndex(index.name).catch(() => undefined);
    }
  },
};
