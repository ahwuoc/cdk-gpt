import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { ClientSession, Model, Types } from 'mongoose';
import { DeliveryStatus, OrderStatus } from '@store/shared';
import { Order } from '../schemas';

@Injectable()
export class OrderRepository {
  constructor(@InjectModel('Order') private readonly orders: Model<Order>) {}

  findByIdempotencyKey(key: string, session?: ClientSession) {
    return this.orders.findOne({ idempotencyKey: key }).session(session ?? null).exec();
  }
  findById(id: Types.ObjectId, session?: ClientSession) {
    return this.orders.findById(id).session(session ?? null).exec();
  }
  create(data: Partial<Order>, session: ClientSession) {
    return this.orders.create([data], { session }).then(([order]) => order);
  }
  attachWalletTransaction(orderId: Types.ObjectId, walletTransactionId: Types.ObjectId, session: ClientSession) {
    return this.orders.updateOne({ _id: orderId }, { $set: { walletTransactionId } }, { session });
  }
  markDelivering(orderId: Types.ObjectId, attemptId?: string) {
    return this.orders.findOneAndUpdate(
      { _id: orderId, status: OrderStatus.PENDING_DELIVERY, deliveryStatus: DeliveryStatus.PENDING },
      { $set: { status: OrderStatus.DELIVERING, deliveryStatus: DeliveryStatus.PROCESSING,
        ...(attemptId ? { 'metadata.deliveryAttemptId': attemptId, 'metadata.deliveryStartedAt': new Date() } : {}) },
        $unset: { failureReason: 1 } }, { new: true },
    );
  }
  markDelivered(orderId: Types.ObjectId, session: ClientSession) {
    return this.orders.findOneAndUpdate(
      { _id: orderId, status: { $in: [OrderStatus.PENDING_DELIVERY, OrderStatus.DELIVERING] } },
      { $set: { status: OrderStatus.DELIVERED, deliveryStatus: DeliveryStatus.DELIVERED, deliveredAt: new Date() }, $unset: { failureReason: 1 } },
      { new: true, session },
    );
  }
  markDeliveryFailed(orderId: Types.ObjectId, reason: string) {
    return this.orders.findOneAndUpdate(
      { _id: orderId, status: { $in: [OrderStatus.PENDING_DELIVERY, OrderStatus.DELIVERING] } },
      { $set: { status: OrderStatus.DELIVERY_FAILED, deliveryStatus: DeliveryStatus.FAILED, failureReason: reason.slice(0, 2000) } }, { new: true },
    );
  }
}
