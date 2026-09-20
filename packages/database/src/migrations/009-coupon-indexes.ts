import { createHash } from 'node:crypto';
import type { MongoMigration } from './types';

export const couponIndexesMigration: MongoMigration = {
  name: '009-coupon-indexes', checksum: createHash('sha256').update('009-coupon-indexes-v1').digest('hex'),
  async up(connection) {
    await connection.collection('coupons').createIndex({ code: 1 }, { unique: true });
    await connection.collection('coupons').createIndex({ active: 1, createdAt: -1 });
    await connection.collection('coupon_redemptions').createIndex({ checkoutKey: 1 }, { unique: true });
    await connection.collection('coupon_redemptions').createIndex({ couponId: 1, userId: 1 });
  },
  async down(connection) {
    await connection.collection('coupons').dropIndex('code_1');
    await connection.collection('coupons').dropIndex('active_1_createdAt_-1');
    await connection.collection('coupon_redemptions').dropIndex('checkoutKey_1');
    await connection.collection('coupon_redemptions').dropIndex('couponId_1_userId_1');
  },
};
