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
      .select('_id reservedOrderId').sort({ reservationExpiresAt: 1 }).limit(Math.min(limit, 500)).lean();
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
