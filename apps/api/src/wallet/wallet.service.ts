import { Injectable, NotFoundException } from '@nestjs/common';
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

  /** Reconciles real received money even if the customer was disabled after creating the QR. */
  creditReceivedFunds(input: WalletChange, session?: ClientSession) { return this.change(input, 1, session, true); }

  debit(input: WalletChange, session?: ClientSession) { return this.change(input, -1, session); }

  private async change(input: WalletChange, direction: 1 | -1, session?: ClientSession, allowInactive = false) {
    if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw new Error('Wallet amount must be a positive integer');
    if (session) return this.applyChange(input, direction, session, allowInactive);
    const ownSession = await this.connection.startSession();
    try {
      let result: Awaited<ReturnType<WalletService['applyChange']>> | undefined;
      await ownSession.withTransaction(async () => { result = await this.applyChange(input, direction, ownSession, allowInactive); });
      return result!;
    } finally { await ownSession.endSession(); }
  }

  private async applyChange(input: WalletChange, direction: 1 | -1, session: ClientSession, allowInactive: boolean) {
    const signedAmount = input.amount * direction;
    const existing = await this.transactions.findByIdempotencyKey(input.idempotencyKey, session);
    if (existing) {
      const sameReference = existing.referenceType === input.referenceType
        && objectIdEquals(existing.referenceId, input.referenceId);
      const strictAdminAdjustment = input.idempotencyKey.startsWith('admin-wallet:');
      if (!existing.userId.equals(input.userId) || existing.amount !== signedAmount
        || (strictAdminAdjustment && (existing.type !== input.type || existing.reason !== input.reason || !sameReference))) {
        throw new IdempotencyConflictError();
      }
      return existing;
    }
    const before = allowInactive ? await this.users.findExisting(input.userId, session) : await this.users.findActive(input.userId, session);
    if (!before) throw new NotFoundException(allowInactive ? 'Customer not found' : 'Active customer not found');
    const after = direction === 1
      ? allowInactive
        ? await this.users.creditReceivedFunds(input.userId, input.amount, session)
        : await this.users.credit(input.userId, input.amount, session)
      : allowInactive
        ? await this.users.debitExistingBalance(input.userId, input.amount, session)
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

  adminAdjust(userId: Types.ObjectId, amount: number, direction: 'CREDIT' | 'DEBIT', reason: string,
    adminId: Types.ObjectId, key: string, session?: ClientSession) {
    return this.change({
      userId,
      amount,
      type: direction === 'CREDIT' ? WalletTransactionType.ADMIN_CREDIT : WalletTransactionType.ADMIN_DEBIT,
      reason,
      referenceType: WalletReferenceType.USER,
      referenceId: userId,
      idempotencyKey: key,
      actorType: ActorType.ADMIN,
      actorId: adminId,
      metadata: { direction },
    }, direction === 'CREDIT' ? 1 : -1, session, true);
  }
}

function objectIdEquals(left?: Types.ObjectId, right?: Types.ObjectId) {
  if (!left && !right) return true;
  return Boolean(left && right && left.equals(right));
}
