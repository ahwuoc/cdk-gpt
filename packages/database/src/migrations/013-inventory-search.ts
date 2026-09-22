import { createHash } from 'node:crypto';
import type { Connection } from 'mongoose';
import { inventorySearchValues } from '@store/shared';
import type { MongoMigration } from './types';

const indexes = [
  { keys: { searchValues: 1, deletedAt: 1 }, name: 'inventory_exact_preview' },
  { keys: { deletedAt: 1, createdAt: -1, _id: -1 }, name: 'inventory_active_recent' },
  { keys: { deletedAt: 1, status: 1, createdAt: -1, _id: -1 }, name: 'inventory_status_recent' },
  { keys: { deletedAt: 1, productId: 1, createdAt: -1, _id: -1 }, name: 'inventory_product_recent' },
  { keys: { deletedAt: 1, productId: 1, status: 1, createdAt: -1, _id: -1 }, name: 'inventory_product_status_recent' },
] as const;

/** Prepare query plans before promotion without exposing derived data to older writers. */
export async function createInventorySearchIndexes(connection: Connection) {
  for (const index of indexes) await connection.collection('inventory_items').createIndex(index.keys, { name: index.name });
}

/** After old instances drain, includeExisting repairs previews changed by old writers too. */
export async function backfillInventorySearchValues(connection: Connection, options: { includeExisting?: boolean } = {}) {
  const collection = connection.collection('inventory_items');
  const cursor = collection.find(options.includeExisting ? {} : { searchValues: null },
    { projection: { _id: 1, maskedPreview: 1, searchValues: 1 }, batchSize: 500 });
  let operations: Array<{ updateOne: { filter: Record<string, unknown>; update: { $set: { searchValues: string[] } } } }> = [];
  try {
    for await (const row of cursor) {
      const searchValues = inventorySearchValues(row.maskedPreview);
      if (Array.isArray(row.searchValues) && row.searchValues.length === searchValues.length
        && row.searchValues.every((value: unknown, index: number) => value === searchValues[index])) continue;
      operations.push({ updateOne: {
        // Compare the exact preview read above so a concurrent import/rename
        // cannot receive an index derived from its previous contents.
        filter: { _id: row._id, searchValues: Object.hasOwn(row, 'searchValues') ? { $eq: row.searchValues } : { $exists: false },
          maskedPreview: Object.hasOwn(row, 'maskedPreview')
          ? { $eq: row.maskedPreview } : { $exists: false } },
        update: { $set: { searchValues } },
      } });
      if (operations.length === 500) { await collection.bulkWrite(operations, { ordered: false }); operations = []; }
    }
    if (operations.length) await collection.bulkWrite(operations, { ordered: false });
  } finally { await cursor.close(); }
  // New or concurrently changed legacy rows remain searchable via the indexed
  // missing-value fallback. Do not spin indefinitely against active imports.
}

export const inventorySearchMigration: MongoMigration = {
  name: '013-inventory-search',
  checksum: createHash('sha256').update('013-inventory-search-v1').digest('hex'),
  async up(connection: Connection) {
    await createInventorySearchIndexes(connection);
    await backfillInventorySearchValues(connection);
  },
  async down(connection: Connection) {
    for (const index of [...indexes].reverse()) await connection.collection('inventory_items').dropIndex(index.name).catch(() => undefined);
    // Retain harmless derived values so rollback does not race newer writers.
  },
};
