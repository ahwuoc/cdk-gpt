import { createHash } from 'node:crypto';
import type { ClientSession, Connection } from 'mongoose';
import type { MongoMigration } from './types';

// Earlier Nest model definitions relied on Mongoose's pluralization for compound model names.
// The application then wrote data to e.g. `inventoryitems`, while workers imported the explicit
// model bound to `inventory_items`. Preserve every legacy document by copying it to the canonical
// collection; the old collection remains untouched as a rollback backup.
const collectionPairs = [
  ['auditlogs', 'audit_logs'],
  ['importbatches', 'import_batches'],
  ['inventoryitems', 'inventory_items'],
  ['paymentrequests', 'payment_requests'],
  ['refreshtokens', 'refresh_tokens'],
  ['supporttickets', 'support_tickets'],
  ['wallettransactions', 'wallet_transactions'],
  ['warrantyrequests', 'warranty_requests'],
] as const;

const developmentSeedLogins = ['demo1@example.invalid', 'demo2@example.invalid', 'demo3@example.invalid'];
const source = '004-repair-legacy-collection-names-v1';

export const repairLegacyCollectionNamesMigration: MongoMigration = {
  name: '004-repair-legacy-collection-names',
  checksum: createHash('sha256').update(source).digest('hex'),

  async up(connection: Connection) {
    const copied: Record<string, number> = {};
    let retiredSeedItems = 0;
    const session = await connection.startSession();
    try {
      await session.withTransaction(async () => {
        for (const [legacy, canonical] of collectionPairs) {
          copied[legacy] = await copyIntoCanonicalCollection(connection, legacy, canonical, session);
        }

        // These are the exact initial development fixtures. Their fields (`login`/`password`) no
        // longer match the real product's `email`/`api` delivery template, so they must never be
        // offered for sale after the collections are unified.
        const retired = await connection.collection('inventory_items').updateMany({
          deletedAt: null,
          status: 'AVAILABLE',
          'maskedPreview.login': { $in: developmentSeedLogins },
        }, { $set: {
          deletedAt: new Date(),
          updatedAt: new Date(),
          internalNote: 'Retired development seed inventory during collection-name repair',
        } }, { session });
        retiredSeedItems = retired.modifiedCount;
      });
    } finally {
      await session.endSession();
    }
    console.info({ event: 'legacy-collection-name-repair-complete', copied, retiredSeedItems });
  },

  // The legacy collections are intentionally retained and canonical data may receive new writes
  // after this repair, so automatic rollback must never delete any canonical records.
  async down() {},
};

async function copyIntoCanonicalCollection(connection: Connection, legacy: string, canonical: string, session: ClientSession) {
  const sourceCollection = connection.collection(legacy);
  const documents = await sourceCollection.find({}).toArray();
  if (!documents.length) return 0;

  const targetCollection = connection.collection(canonical);
  const ids = documents.map((document) => document._id);
  const existing = await targetCollection.countDocuments({ _id: { $in: ids } }, { session });
  if (existing && existing !== documents.length) {
    throw new Error(`Cannot safely repair ${legacy}: ${existing}/${documents.length} document IDs already exist in ${canonical}`);
  }
  if (!existing) {
    await targetCollection.bulkWrite(documents.map(({ _id, ...document }) => ({
      updateOne: { filter: { _id }, update: { $setOnInsert: document }, upsert: true },
    })), { ordered: true, session });
  }
  const verified = await targetCollection.countDocuments({ _id: { $in: ids } }, { session });
  if (verified !== documents.length) throw new Error(`Cannot verify copied documents from ${legacy} to ${canonical}`);
  return documents.length;
}
