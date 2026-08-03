import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { ClientSession, Connection, Types } from 'mongoose';
import { IdempotencyConflictError, InsufficientBalanceError, WalletTransactionType } from '@store/shared';
import { ActorType, UserRepository, WalletReferenceType, WalletTransactionRepository } from '@store/database';

type ValueOf<T> = T[keyof T];
export interface WalletChange {
  userId: Types.ObjectId; amount: number; type: ValueOf<typeof WalletTransactionType>; reason: string;
  referenceType: ValueOf<typeof WalletReferenceType>; referenceId?: Types.ObjectId; idempotencyKey: string;
  actorType: ValueOf<typeof ActorType>; actorId?: Types.ObjectId;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class WalletService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly users: UserRepository,
    private readonly transactions: WalletTransactionRepository,
  ) {}

  credit(input: WalletChange, session?: ClientSession) { return this.change(input, 1, session); }

  debit(input: WalletChange, session?: ClientSession) { return this.change(input, -1, session); }

  private async change(input: WalletChange, direction: 1 | -1, session?: ClientSession) {
    if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw new Error('Wallet amount must be a positive integer');
    if (session) return this.applyChange(input, direction, session);
    const ownSession = await this.connection.startSession();
    try {
      let result: Awaited<ReturnType<WalletService['applyChange']>> | undefined;
      await ownSession.withTransaction(async () => { result = await this.applyChange(input, direction, ownSession); });
      return result!;
    } finally { await ownSession.endSession(); }
  }

  private async applyChange(input: WalletChange, direction: 1 | -1, session: ClientSession) {
    const signedAmount = input.amount * direction;
    const existing = await this.transactions.findByIdempotencyKey(input.idempotencyKey, session);
    if (existing) {
      if (!existing.userId.equals(input.userId) || existing.amount !== signedAmount) throw new IdempotencyConflictError();
      return existing;
    }
    const before = await this.users.findActive(input.userId, session);
    if (!before) throw new Error('Active user not found');
    const after = direction === 1
      ? await this.users.credit(input.userId, input.amount, session)
      : await this.users.debitBalance(input.userId, input.amount, session);
    if (!after) {
      if (direction === -1) throw new InsufficientBalanceError();
      throw new Error('Wallet credit failed');
    }
    return this.transactions.create({
      userId: input.userId, balanceBefore: before.walletBalance, balanceAfter: after.walletBalance,
      amount: signedAmount, type: input.type, reason: input.reason,
      referenceType: input.referenceType, referenceId: input.referenceId,
      idempotencyKey: input.idempotencyKey, actorType: input.actorType, actorId: input.actorId,
      metadata: input.metadata ?? {},
    }, session);
  }

  adminCredit(userId: Types.ObjectId, amount: number, adminId: Types.ObjectId, key: string, referenceId?: Types.ObjectId, session?: ClientSession) {
    return this.credit({ userId, amount, type: WalletTransactionType.ADMIN_CREDIT, reason: 'Admin-approved wallet credit',
      referenceType: WalletReferenceType.PAYMENT_REQUEST, referenceId, idempotencyKey: key, actorType: ActorType.ADMIN, actorId: adminId }, session);
  }

  adminDebit(userId: Types.ObjectId, amount: number, adminId: Types.ObjectId, key: string, referenceId?: Types.ObjectId, session?: ClientSession) {
    return this.debit({ userId, amount, type: WalletTransactionType.ADMIN_DEBIT, reason: 'Administrative wallet debit',
      referenceType: WalletReferenceType.MANUAL, referenceId, idempotencyKey: key, actorType: ActorType.ADMIN, actorId: adminId }, session);
  }
}
