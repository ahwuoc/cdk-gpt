import { createHash } from 'node:crypto';
import type { Connection } from 'mongoose';
import type { MongoMigration } from './types';
import { ComplaintCategory } from '@store/shared';

const source = '006-order-report-indexes-v2';

/** Supports the admin complaint queue's category/status/date filters. */
export const orderReportIndexesMigration: MongoMigration = {
  name: '006-order-report-indexes',
  checksum: createHash('sha256').update(source).digest('hex'),
  async up(connection: Connection) {
    await connection.collection('warranty_requests').updateMany({ category: { $exists: false } }, [
      { $set: { category: { $cond: [
        { $in: ['$metadata.category', Object.values(ComplaintCategory)] }, '$metadata.category', ComplaintCategory.OTHER,
      ] } } },
    ]);
    await connection.collection('warranty_requests').createIndex(
      { category: 1, status: 1, createdAt: -1 },
      { name: 'category_1_status_1_createdAt_-1' },
    );
  },
  async down(connection: Connection) {
    await connection.collection('warranty_requests').dropIndex('category_1_status_1_createdAt_-1').catch(() => undefined);
    await connection.collection('warranty_requests').updateMany({}, { $unset: { category: '' } });
  },
};
