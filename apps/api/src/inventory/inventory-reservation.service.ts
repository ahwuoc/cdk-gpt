import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Types, type ClientSession, type Connection, type Model } from 'mongoose';
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

  async reserveOne(input: { productId: Types.ObjectId; userId: Types.ObjectId; orderId: Types.ObjectId;
    expiresAt: Date; session: ClientSession }) {
    await this.inventory.releaseExpiredPaymentReservationsForProduct(input.productId, input.session);
    return this.inventory.reserveOne(input);
  }

  reserveForPayment(input: { productId: Types.ObjectId; userId: Types.ObjectId; paymentRequestId: Types.ObjectId;
    expiresAt: Date; session: ClientSession }) {
    return this.inventory.reserveForPayment(input);
  }

  findPaymentReservations(paymentRequestId: Types.ObjectId, session: ClientSession) {
    return this.inventory.findPaymentReservations(paymentRequestId, session);
  }

  assignPaymentReservation(itemId: Types.ObjectId, paymentRequestId: Types.ObjectId, orderId: Types.ObjectId,
    expiresAt: Date, session: ClientSession) {
    return this.inventory.assignPaymentReservation(itemId, paymentRequestId, orderId, expiresAt, session);
  }

  releasePaymentReservations(paymentRequestId: Types.ObjectId, session: ClientSession) {
    return this.inventory.releasePaymentReservations(paymentRequestId, session);
  }

  extendPaymentReservations(paymentRequestId: Types.ObjectId, expiresAt: Date, session: ClientSession) {
    return this.inventory.extendPaymentReservations(paymentRequestId, expiresAt, session);
  }

  releaseExpiredPaymentReservationsForProduct(productId: Types.ObjectId, session: ClientSession) {
    return this.inventory.releaseExpiredPaymentReservationsForProduct(productId, session);
  }

  countAvailable(productId: Types.ObjectId, session?: ClientSession) { return this.inventory.countAvailable(productId, session); }

  countActivePaymentReservations(productId: Types.ObjectId, userId: Types.ObjectId, session: ClientSession) {
    return this.inventory.countActivePaymentReservations(productId, userId, session);
  }

  async releaseExpired(limit = 100) {
    const expired = await this.inventory.findExpired(limit); let released = 0;
    for (const item of expired) {
      const session = await this.connection.startSession();
      try {
        await session.withTransaction(async () => {
          if (item.reservedPaymentRequestId && !item.reservedOrderId) {
            if (await this.inventory.releaseExpiredPayment(item._id, item.reservedPaymentRequestId, session)) released++;
            return;
          }
          if (!item.reservedOrderId) return;
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

  async releaseExpiredPaymentHolds(limit = 100) {
    const expired = await this.inventory.findExpiredPaymentReservations(limit); let released = 0;
    for (const item of expired) {
      if (!item.reservedPaymentRequestId) continue;
      const session = await this.connection.startSession();
      try {
        await session.withTransaction(async () => {
          if (await this.inventory.releaseExpiredPayment(item._id, item.reservedPaymentRequestId!, session)) released++;
        });
      } finally { await session.endSession(); }
    }
    return { examined: expired.length, released };
  }

  extendOrderReservations(orderIds: string[], expiresAt: Date) {
    const ids = orderIds.filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id));
    return ids.length ? this.inventory.extendOrderReservations(ids, expiresAt) : undefined;
  }
}
