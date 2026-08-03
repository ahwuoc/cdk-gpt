import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Connection, Model } from 'mongoose';
import { InventoryItem, InventoryRepository, Order } from '@store/database';
import { ActorType, WalletReferenceType } from '@store/database';
import { DeliveryStatus, InventoryStatus, OrderStatus, OutOfStockError, WalletTransactionType } from '@store/shared';
import { WalletService } from '../wallet/wallet.service';
import { DeliveryQueue } from './delivery.queue';

@Injectable()
export class DeliveryRecoveryService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel('Order') private readonly orders: Model<Order>,
    @InjectModel('InventoryItem') private readonly items: Model<InventoryItem>,
    private readonly inventory: InventoryRepository,
    private readonly wallet: WalletService,
    private readonly queue: DeliveryQueue,
  ) {}

  async resend(orderId: string, adminId: string) {
    const order = await this.orders.findOneAndUpdate({ _id: orderId, status: OrderStatus.DELIVERY_FAILED },
      { $set: { status: OrderStatus.PENDING_DELIVERY, deliveryStatus: DeliveryStatus.PENDING,
        'metadata.recoveryAction': 'RESEND', 'metadata.recoveryAdminId': new Types.ObjectId(adminId) },
        $unset: { failureReason: 1 } }, { new: true });
    if (!order) throw new Error('Only failed deliveries can be resent');
    await this.enqueueRecovery(order._id);
    return order;
  }

  async replace(orderId: string, adminId: string) {
    const session = await this.connection.startSession(); let result: Order | null = null;
    try {
      await session.withTransaction(async () => {
        const order = await this.orders.findOne({ _id: orderId, status: OrderStatus.DELIVERY_FAILED }).session(session);
        if (!order) throw new Error('Only failed deliveries can receive a replacement');
        await this.items.updateOne({ _id: order.inventoryItemId, status: InventoryStatus.RESERVED, reservedOrderId: order._id },
          { $set: { status: InventoryStatus.DISABLED, internalNote: `Held after ambiguous delivery; replaced by admin ${adminId}` } }, { session });
        const replacement = await this.inventory.reserveOne({ productId: order.productId, userId: order.userId,
          orderId: order._id, expiresAt: new Date(Date.now() + 15 * 60_000), session });
        if (!replacement) throw new OutOfStockError();
        result = await this.orders.findByIdAndUpdate(order._id, { $set: { inventoryItemId: replacement._id,
          status: OrderStatus.PENDING_DELIVERY, deliveryStatus: DeliveryStatus.PENDING,
          'metadata.recoveryAction': 'REPLACE', 'metadata.recoveryAdminId': new Types.ObjectId(adminId) },
          $unset: { failureReason: 1, deliveredAt: 1 } }, { new: true, session });
      });
    } finally { await session.endSession(); }
    if (!result) throw new Error('Replacement transaction failed');
    await this.enqueueRecovery((result as Order & { _id: Types.ObjectId })._id);
    return result;
  }

  async refund(orderId: string, adminId: string) {
    const session = await this.connection.startSession(); let result: Order | null = null;
    try {
      await session.withTransaction(async () => {
        const order = await this.orders.findOne({ _id: orderId, status: OrderStatus.DELIVERY_FAILED }).session(session);
        if (!order) {
          const refunded = await this.orders.findOne({ _id: orderId, status: OrderStatus.REFUNDED }).session(session);
          if (refunded) { result = refunded; return; }
          throw new Error('Only failed deliveries can be refunded');
        }
        await this.wallet.credit({ userId: order.userId, amount: order.totalAmount, type: WalletTransactionType.REFUND,
          reason: `Delivery refund for ${order.orderCode}`, referenceType: WalletReferenceType.ORDER, referenceId: order._id,
          idempotencyKey: `delivery-refund:${order._id}`, actorType: ActorType.ADMIN, actorId: new Types.ObjectId(adminId) }, session);
        await this.items.updateOne({ _id: order.inventoryItemId, status: InventoryStatus.RESERVED },
          { $set: { status: InventoryStatus.DISABLED, internalNote: `Held after refunded delivery by admin ${adminId}` } }, { session });
        result = await this.orders.findByIdAndUpdate(order._id, { $set: { status: OrderStatus.REFUNDED,
          'metadata.recoveryAction': 'REFUND', 'metadata.recoveryAdminId': new Types.ObjectId(adminId) } }, { new: true, session });
      });
      return result;
    } finally { await session.endSession(); }
  }

  private async enqueueRecovery(orderId: Types.ObjectId) {
    try { await this.queue.requeue(orderId.toString()); }
    catch (error) {
      await this.orders.updateOne({ _id: orderId, status: OrderStatus.PENDING_DELIVERY }, { $set: {
        status: OrderStatus.DELIVERY_FAILED, deliveryStatus: DeliveryStatus.FAILED,
        failureReason: 'Recovery delivery could not be queued',
      } });
      throw error;
    }
  }
}
