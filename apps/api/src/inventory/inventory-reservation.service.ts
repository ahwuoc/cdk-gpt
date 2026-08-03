import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { ClientSession, Connection, Model, Types } from 'mongoose';
import { ActorType, InventoryRepository, Order, UserRepository, WalletReferenceType, WalletTransactionRepository } from '@store/database';
import { DeliveryStatus, OrderStatus, WalletTransactionType } from '@store/shared';

@Injectable()
export class InventoryReservationService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel('Order') private readonly orders: Model<Order>,
    private readonly inventory: InventoryRepository, private readonly users: UserRepository,
    private readonly walletTransactions: WalletTransactionRepository,
  ) {}

  reserveOne(input: { productId: Types.ObjectId; userId: Types.ObjectId; orderId: Types.ObjectId;
    expiresAt: Date; session: ClientSession }) {
    return this.inventory.reserveOne(input);
  }

  async releaseExpired(limit = 100) {
    const expired = await this.inventory.findExpired(limit); let released = 0;
    for (const item of expired) {
      if (!item.reservedOrderId) continue;
      const session = await this.connection.startSession();
      try {
        await session.withTransaction(async () => {
          const order = await this.orders.findOne({ _id: item.reservedOrderId, status: OrderStatus.PENDING_DELIVERY,
            deliveryStatus: DeliveryStatus.PENDING }).session(session);
          if (!order) return; // Delivery may be ambiguous; never make such inventory available automatically.
          const inventory = await this.inventory.releaseExpired(item._id, order._id, session);
          if (!inventory) return;
          const before = await this.users.findActive(order.userId, session); if (!before) throw new Error('User missing during reservation refund');
          const after = await this.users.credit(order.userId, order.totalAmount, session); if (!after) throw new Error('Reservation refund failed');
          const transaction = await this.walletTransactions.create({ userId: order.userId, balanceBefore: before.walletBalance,
            balanceAfter: after.walletBalance, amount: order.totalAmount, type: WalletTransactionType.REFUND,
            reason: `Reservation expired for ${order.orderCode}`, referenceType: WalletReferenceType.ORDER, referenceId: order._id,
            idempotencyKey: `reservation-expired:${order._id}`, actorType: ActorType.SYSTEM, metadata: {} }, session);
          await this.orders.updateOne({ _id: order._id }, { $set: { status: OrderStatus.CANCELLED, deliveryStatus: DeliveryStatus.FAILED,
            failureReason: 'Reservation expired before delivery', walletTransactionId: transaction._id } }, { session });
          released++;
        });
      } finally { await session.endSession(); }
    }
    return { examined: expired.length, released };
  }
}
