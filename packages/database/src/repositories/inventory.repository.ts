import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { ClientSession, Model, Types } from 'mongoose';
import { InventoryStatus } from '@store/shared';
import { InventoryItem, InventoryItemDocument } from '../schemas';

@Injectable()
export class InventoryRepository {
  constructor(@InjectModel('InventoryItem') private readonly items: Model<InventoryItem>) {}

  reserveOne(input: {
    productId: Types.ObjectId; userId: Types.ObjectId; orderId: Types.ObjectId;
    expiresAt: Date; session: ClientSession;
  }): Promise<InventoryItemDocument | null> {
    const now = new Date();
    return this.items.findOneAndUpdate(
      { productId: input.productId, status: InventoryStatus.AVAILABLE, deletedAt: null },
      { $set: {
        status: InventoryStatus.RESERVED, reservedByUserId: input.userId,
        reservedOrderId: input.orderId, reservedAt: now, reservationExpiresAt: input.expiresAt,
      } },
      { new: true, session: input.session, sort: { createdAt: 1 }, runValidators: true },
    ).select('+encryptedPayload +payloadHash').exec();
  }

  countAvailable(productId: Types.ObjectId, session?: ClientSession) {
    return this.items.countDocuments({ productId, status: InventoryStatus.AVAILABLE, deletedAt: null })
      .session(session ?? null).exec();
  }

  countActivePaymentReservations(productId: Types.ObjectId, userId: Types.ObjectId, session: ClientSession) {
    return this.items.countDocuments({ productId, reservedByUserId: userId, status: InventoryStatus.RESERVED,
      reservedPaymentRequestId: { $exists: true }, reservationExpiresAt: { $gt: new Date() }, deletedAt: null })
      .session(session).exec();
  }

  reserveForPayment(input: { productId: Types.ObjectId; userId: Types.ObjectId; paymentRequestId: Types.ObjectId;
    expiresAt: Date; session: ClientSession }) {
    return this.items.findOneAndUpdate(
      { productId: input.productId, status: InventoryStatus.AVAILABLE, deletedAt: null },
      { $set: { status: InventoryStatus.RESERVED, reservedByUserId: input.userId,
        reservedPaymentRequestId: input.paymentRequestId, reservedAt: new Date(), reservationExpiresAt: input.expiresAt } },
      { new: true, session: input.session, sort: { createdAt: 1 }, runValidators: true },
    ).exec();
  }

  releaseExpiredPaymentReservationsForProduct(productId: Types.ObjectId, session: ClientSession) {
    return this.items.updateMany({ productId, status: InventoryStatus.RESERVED, deletedAt: null,
      reservedPaymentRequestId: { $exists: true }, reservedOrderId: { $exists: false },
      reservationExpiresAt: { $lte: new Date() } },
    { $set: { status: InventoryStatus.AVAILABLE }, $unset: { reservedByUserId: 1, reservedPaymentRequestId: 1,
      reservedAt: 1, reservationExpiresAt: 1 } }, { session }).exec();
  }

  findPaymentReservations(paymentRequestId: Types.ObjectId, session: ClientSession) {
    return this.items.find({ reservedPaymentRequestId: paymentRequestId, status: InventoryStatus.RESERVED, deletedAt: null })
      .sort({ createdAt: 1 }).session(session).exec();
  }

  assignPaymentReservation(itemId: Types.ObjectId, paymentRequestId: Types.ObjectId, orderId: Types.ObjectId,
    expiresAt: Date, session: ClientSession) {
    return this.items.findOneAndUpdate({ _id: itemId, reservedPaymentRequestId: paymentRequestId,
      status: InventoryStatus.RESERVED, deletedAt: null },
    { $set: { reservedOrderId: orderId, reservedAt: new Date(), reservationExpiresAt: expiresAt },
      $unset: { reservedPaymentRequestId: 1 } },
    { new: true, session, runValidators: true }).exec();
  }

  findForDelivery(orderId: Types.ObjectId, session?: ClientSession) {
    return this.items.findOne({ reservedOrderId: orderId, status: InventoryStatus.RESERVED, deletedAt: null })
      .select('+encryptedPayload').session(session ?? null).exec();
  }

  markSold(itemId: Types.ObjectId, userId: Types.ObjectId, orderId: Types.ObjectId, session: ClientSession) {
    return this.items.findOneAndUpdate(
      { _id: itemId, reservedOrderId: orderId, status: InventoryStatus.RESERVED, deletedAt: null },
      { $set: { status: InventoryStatus.SOLD, soldToUserId: userId, soldOrderId: orderId, soldAt: new Date() },
        $unset: { reservationExpiresAt: 1 } },
      { new: true, session, runValidators: true },
    );
  }

  findExpired(limit: number) {
    return this.items.find({ status: InventoryStatus.RESERVED, reservationExpiresAt: { $lte: new Date() }, deletedAt: null })
      .select('_id reservedOrderId reservedPaymentRequestId').sort({ reservationExpiresAt: 1 }).limit(Math.min(limit, 500)).lean();
  }

  findExpiredPaymentReservations(limit: number) {
    return this.items.find({ status: InventoryStatus.RESERVED, reservedPaymentRequestId: { $exists: true },
      reservedOrderId: { $exists: false }, reservationExpiresAt: { $lte: new Date() }, deletedAt: null })
      .select('_id reservedPaymentRequestId').sort({ reservationExpiresAt: 1 }).limit(Math.min(limit, 500)).lean();
  }

  extendOrderReservations(orderIds: Types.ObjectId[], expiresAt: Date) {
    return this.items.updateMany({ reservedOrderId: { $in: orderIds }, status: InventoryStatus.RESERVED,
      deletedAt: null }, { $set: { reservationExpiresAt: expiresAt } }).exec();
  }

  releaseExpiredPayment(itemId: Types.ObjectId, paymentRequestId: Types.ObjectId, session: ClientSession) {
    return this.items.findOneAndUpdate({ _id: itemId, reservedPaymentRequestId: paymentRequestId,
      status: InventoryStatus.RESERVED, reservationExpiresAt: { $lte: new Date() } },
    { $set: { status: InventoryStatus.AVAILABLE }, $unset: { reservedByUserId: 1, reservedPaymentRequestId: 1,
      reservedAt: 1, reservationExpiresAt: 1 } }, { new: true, session }).exec();
  }

  releasePaymentReservations(paymentRequestId: Types.ObjectId, session: ClientSession) {
    return this.items.updateMany({ reservedPaymentRequestId: paymentRequestId, status: InventoryStatus.RESERVED },
      { $set: { status: InventoryStatus.AVAILABLE }, $unset: { reservedByUserId: 1, reservedPaymentRequestId: 1,
        reservedAt: 1, reservationExpiresAt: 1 } }, { session }).exec();
  }

  extendPaymentReservations(paymentRequestId: Types.ObjectId, expiresAt: Date, session: ClientSession) {
    return this.items.updateMany({ reservedPaymentRequestId: paymentRequestId, status: InventoryStatus.RESERVED,
      deletedAt: null }, { $set: { reservationExpiresAt: expiresAt } }, { session }).exec();
  }

  releaseExpired(itemId: Types.ObjectId, orderId: Types.ObjectId, session: ClientSession) {
    return this.items.findOneAndUpdate(
      { _id: itemId, reservedOrderId: orderId, status: InventoryStatus.RESERVED, reservationExpiresAt: { $lte: new Date() } },
      { $set: { status: InventoryStatus.AVAILABLE }, $unset: {
        reservedByUserId: 1, reservedOrderId: 1, reservedAt: 1, reservationExpiresAt: 1,
      } }, { new: true, session },
    );
  }
}
