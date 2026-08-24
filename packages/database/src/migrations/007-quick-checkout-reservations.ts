import { createHash } from 'node:crypto';
import type { Connection } from 'mongoose';
import type { MongoMigration } from './types';

const source = '007-quick-checkout-reservations-v2';

/** Lets an unpaid QR checkout own and later release its exact inventory set. */
export const quickCheckoutReservationsMigration: MongoMigration = {
  name: '007-quick-checkout-reservations',
  checksum: createHash('sha256').update(source).digest('hex'),
  async up(connection: Connection) {
    await connection.collection('inventory_items').createIndex(
      { reservedPaymentRequestId: 1 },
      { sparse: true, name: 'reservedPaymentRequestId_1' },
    );
    await connection.collection('orders').createIndex(
      { status: 1, deliveryStatus: 1, 'metadata.deliveryDispatchAttemptAt': 1, createdAt: 1 },
      { name: 'pending_delivery_dispatch_attempt' },
    );
  },
  async down(connection: Connection) {
    await connection.collection('inventory_items').dropIndex('reservedPaymentRequestId_1').catch(() => undefined);
    await connection.collection('orders')
      .dropIndex('pending_delivery_dispatch_attempt').catch(() => undefined);
  },
};
