import type { Connection } from 'mongoose';
import { createHash } from 'node:crypto';
import '../schemas';
import type { MongoMigration } from './types';

const collections = [
  'admins', 'roles', 'users', 'products', 'categories', 'inventory_items', 'orders', 'wallet_transactions',
  'payment_requests', 'support_tickets', 'warranty_requests', 'referrals', 'settings',
  'notifications', 'audit_logs', 'refresh_tokens', 'import_batches',
];

const source = '001-create-indexes-v1';
export const createIndexesMigration: MongoMigration = {
  name: '001-create-indexes',
  checksum: createHash('sha256').update(source).digest('hex'),
  async up(connection: Connection) {
    for (const model of Object.values(connection.models)) {
      if (collections.includes(model.collection.collectionName)) await model.createIndexes();
    }
  },
  async down(connection: Connection) {
    for (const model of Object.values(connection.models).reverse()) {
      if (!collections.includes(model.collection.collectionName)) continue;
      const declaredNames = model.schema.indexes().map(([keys, options]) => options.name ??
        Object.entries(keys).map(([field, direction]) => `${field}_${direction}`).join('_'));
      const existingNames = new Set((await model.collection.indexes()).map((index) => index.name));
      for (const name of declaredNames) if (existingNames.has(name)) await model.collection.dropIndex(name);
    }
  },
};
