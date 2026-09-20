import { createHash } from 'node:crypto';
import type { Connection } from 'mongoose';
import type { MongoMigration } from './types';

const indexes = [
  { collection: 'customer_events', keys: { createdAt: 1, type: 1, userId: 1 }, name: 'customer_event_period_type_user' },
  { collection: 'customer_events', keys: { userId: 1, createdAt: -1 }, name: 'customer_event_user_period' },
  { collection: 'orders', keys: { status: 1, deliveredAt: 1 }, name: 'analytics_delivered_period' },
  { collection: 'orders', keys: { status: 1, createdAt: 1 }, name: 'analytics_legacy_delivered_period' },
  { collection: 'orders', keys: { userId: 1, status: 1, deliveredAt: 1 }, name: 'analytics_buyer_delivered' },
  { collection: 'payment_requests', keys: { status: 1, deletedAt: 1, reviewedAt: 1 }, name: 'analytics_deposit_period' },
  { collection: 'wallet_transactions', keys: { type: 1, referenceType: 1, createdAt: 1 }, name: 'analytics_deposit_ledger_period' },
  { collection: 'users', keys: { deletedAt: 1, createdAt: 1 }, name: 'analytics_new_customers' },
] as const;

export const customerAnalyticsIndexesMigration: MongoMigration = {
  name: '010-customer-analytics-indexes',
  checksum: createHash('sha256').update('010-customer-analytics-indexes-v2').digest('hex'),
  async up(connection: Connection) {
    for (const index of indexes) {
      await connection.collection(index.collection).createIndex(index.keys, { name: index.name });
    }
  },
  async down(connection: Connection) {
    for (const index of [...indexes].reverse()) {
      await connection.collection(index.collection).dropIndex(index.name).catch(() => undefined);
    }
  },
};
