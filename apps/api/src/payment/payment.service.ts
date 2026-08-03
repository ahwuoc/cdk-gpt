import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Connection, Model } from 'mongoose';
import { randomBytes } from 'node:crypto';
import { ActorType, PaymentRequest, type PaymentRequestDocument, WalletReferenceType } from '@store/database';
import { PaymentRequestStatus, WalletTransactionType } from '@store/shared';
import { isMongoDuplicateKey } from '@store/shared';
import { WalletService } from '../wallet/wallet.service';

@Injectable()
export class PaymentService {
  constructor(@InjectConnection() private readonly connection: Connection,
    @InjectModel('PaymentRequest') private readonly requests: Model<PaymentRequest>, private readonly wallet: WalletService) {}

  create(userId: string, amount: number, provider: string, idempotencyKey: string) {
    return this.requests.findOneAndUpdate({ idempotencyKey }, { $setOnInsert: {
      requestCode: `PAY-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString('hex').toUpperCase()}`,
      userId: new Types.ObjectId(userId), amount, provider, status: PaymentRequestStatus.PENDING,
      proofUrls: [], idempotencyKey, metadata: {}, deletedAt: null,
    } }, { upsert: true, new: true, setDefaultsOnInsert: true });
  }

  async approve(requestId: string, adminId: string, idempotencyKey: string) {
    return this.approveAs(requestId, { actorType: ActorType.ADMIN, actorId: new Types.ObjectId(adminId), idempotencyKey });
  }

  async processWebhook(provider: string, providerReference: string, userId: string, amount: number) {
    const webhookKey = `webhook:${provider}:${providerReference}`;
    let request: PaymentRequestDocument | null;
    try {
      request = await this.requests.findOneAndUpdate({ provider, providerReference }, { $setOnInsert: {
        requestCode: `PAY-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString('hex').toUpperCase()}`,
        userId: new Types.ObjectId(userId), amount, provider, providerReference, status: PaymentRequestStatus.PENDING,
        proofUrls: [], idempotencyKey: webhookKey, metadata: { source: 'webhook' }, deletedAt: null,
      } }, { upsert: true, new: true, setDefaultsOnInsert: true });
    } catch (error) {
      if (!isMongoDuplicateKey(error)) throw error;
      request = await this.requests.findOne({ provider, providerReference });
    }
    if (!request) throw new Error('Payment webhook could not be persisted');
    if (!request.userId.equals(userId) || request.amount !== amount) throw new Error('Webhook does not match the original payment');
    return this.approveAs(request._id.toString(), { actorType: ActorType.WEBHOOK, idempotencyKey: webhookKey });
  }

  private async approveAs(requestId: string, actor: {
    actorType: typeof ActorType[keyof typeof ActorType]; actorId?: Types.ObjectId; idempotencyKey: string;
  }) {
    const session = await this.connection.startSession(); let result: PaymentRequest | null = null;
    try {
      await session.withTransaction(async () => {
        const existing = await this.requests.findById(requestId).session(session);
        if (!existing) throw new Error('Payment request not found');
        if (existing.status === PaymentRequestStatus.APPROVED) { result = existing; return; }
        const approved = await this.requests.findOneAndUpdate({ _id: requestId, status: PaymentRequestStatus.PENDING },
          { $set: { status: PaymentRequestStatus.APPROVED, reviewedBy: actor.actorId, reviewedAt: new Date() } }, { new: true, session });
        if (!approved) throw new Error('Payment request is no longer pending');
        const walletTransaction = await this.wallet.credit({ userId: approved.userId, amount: approved.amount,
          type: WalletTransactionType.DEPOSIT, reason: `Payment ${approved.requestCode} approved`,
          referenceType: WalletReferenceType.PAYMENT_REQUEST, referenceId: approved._id,
          idempotencyKey: `deposit:${actor.idempotencyKey}`, actorType: actor.actorType, actorId: actor.actorId }, session);
        approved.walletTransactionId = walletTransaction._id; await approved.save({ session }); result = approved;
      });
      return result;
    } finally { await session.endSession(); }
  }
}
