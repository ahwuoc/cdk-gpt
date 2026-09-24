import { createHash } from 'node:crypto';
import type { MongoMigration } from './types';

const source = '015-warranty-hours-v1';

/** Backfill the optional hour field without changing legacy day-only warranties. */
export const warrantyHoursMigration: MongoMigration = {
  name: '015-warranty-hours',
  checksum: createHash('sha256').update(source).digest('hex'),
  async up(connection) {
    const now = new Date();
    await connection.collection('products').updateMany(
      { warrantyHours: { $exists: false } },
      { $set: { warrantyHours: 0, updatedAt: now, '_migrations.015': true } },
    );
  },
  async down(connection) {
    await connection.collection('products').updateMany(
      { '_migrations.015': true, warrantyHours: 0 },
      { $unset: { warrantyHours: '', '_migrations.015': '' } },
    );
  },
};
