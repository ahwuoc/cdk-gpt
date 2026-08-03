import { createHash } from 'node:crypto';
import type { MongoMigration } from './types';

const source = '002-backfill-safe-defaults-v1';
export const backfillSafeDefaultsMigration: MongoMigration = {
  name: '002-backfill-safe-defaults',
  checksum: createHash('sha256').update(source).digest('hex'),
  async up(connection) {
    const now = new Date();
    await connection.collection('users').updateMany(
      { walletBalance: { $exists: false } }, { $set: { walletBalance: 0, purchaseCount: 0, status: 'ACTIVE', updatedAt: now, '_migrations.002': true } },
    );
    await connection.collection('products').updateMany(
      { lowStockThreshold: { $exists: false } },
      { $set: { lowStockThreshold: 5, purchaseLimitPerUser: 0, sortOrder: 0, warrantyDays: 0, updatedAt: now, '_migrations.002': true } },
    );
    await connection.collection('inventory_items').updateMany(
      { deletedAt: { $exists: false } }, { $set: { deletedAt: null, updatedAt: now, '_migrations.002': true } },
    );
  },
  async down(connection) {
    await connection.collection('users').updateMany(
      { '_migrations.002': true, walletBalance: 0, purchaseCount: 0, status: 'ACTIVE' },
      { $unset: { walletBalance: '', purchaseCount: '', status: '', '_migrations.002': '' } },
    );
    await connection.collection('products').updateMany(
      { '_migrations.002': true, lowStockThreshold: 5, purchaseLimitPerUser: 0, sortOrder: 0, warrantyDays: 0 },
      { $unset: { lowStockThreshold: '', purchaseLimitPerUser: '', sortOrder: '', warrantyDays: '', '_migrations.002': '' } },
    );
    await connection.collection('inventory_items').updateMany(
      { '_migrations.002': true, deletedAt: null }, { $unset: { deletedAt: '', '_migrations.002': '' } },
    );
  },
};
