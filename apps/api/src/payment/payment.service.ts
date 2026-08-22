import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Connection, Model } from 'mongoose';
import { randomBytes } from 'node:crypto';
import { ActorType, PaymentRequest, type PaymentRequestDocument, WalletReferenceType } from '@store/database';
import { PaymentRequestStatus, WalletTransactionType } from '@store/shared';
import { isMongoDuplicateKey } from '@store/shared';
import { loadConfig } from '@store/config';
import { BotConfigService, type RuntimeBankConfig } from '../bot-config/bot-config.service';
import { WalletService } from '../wallet/wallet.service';

const BANK_PROVIDER = 'BANK_API';
export interface BankTransaction {
  transactionID: string | number;
  amount: number | string;
  description?: string;
  transactionDate?: string;
  type?: string;
}

@Injectable()
export class PaymentService {
  private readonly config = loadConfig();

  constructor(@InjectConnection() private readonly connection: Connection,
    @InjectModel('PaymentRequest') private readonly requests: Model<PaymentRequest>, private readonly wallet: WalletService,
    @Optional() private readonly bankConfig?: BotConfigService) {}

  async create(userId: string, amount: number, provider: string, idempotencyKey: string) {
    if (!Types.ObjectId.isValid(userId) || !Number.isSafeInteger(amount) || amount <= 0) {
      throw new BadRequestException('Invalid payment request');
    }
    const objectUserId = new Types.ObjectId(userId);
    const request = await this.requests.findOneAndUpdate({ idempotencyKey }, { $setOnInsert: {
      requestCode: `PAY-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString('hex').toUpperCase()}`,
      userId: objectUserId, amount, provider, status: PaymentRequestStatus.PENDING,
      proofUrls: [], idempotencyKey, metadata: {}, deletedAt: null,
    } }, { upsert: true, new: true, setDefaultsOnInsert: true });
    if (!request) throw new Error('Payment request could not be created');
    if (!request.userId.equals(objectUserId) || request.amount !== amount || request.provider !== provider) {
      throw new BadRequestException('Payment idempotency key was already used for another request');
    }
    return request;
  }

  async createBankDeposit(userId: string, amount: number, idempotencyKey: string) {
    const bank = await this.requireBankConfig();
    if (!Types.ObjectId.isValid(userId)) throw new BadRequestException('Invalid user');
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new BadRequestException('Invalid deposit amount');
    const objectUserId = new Types.ObjectId(userId);
    const requestCode = this.bankRequestCode();
    const transferContent = requestCode;
    const expiresAt = new Date(Date.now() + this.config.bankTopupTtlMinutes * 60_000);
    const request = await this.requests.findOneAndUpdate({ idempotencyKey }, { $setOnInsert: {
      requestCode, userId: objectUserId, amount, provider: BANK_PROVIDER, status: PaymentRequestStatus.PENDING,
      proofUrls: [], idempotencyKey,
      metadata: { source: 'telegram-bank-topup', transferContent, expiresAt: expiresAt.toISOString() }, deletedAt: null,
    } }, { upsert: true, new: true, setDefaultsOnInsert: true });
    if (!request) throw new Error('Bank deposit could not be created');
    if (!request.userId.equals(objectUserId) || request.amount !== amount || request.provider !== BANK_PROVIDER) {
      throw new BadRequestException('Deposit idempotency key was already used for another request');
    }
    const content = transferContentFrom(request) ?? transferContent;
    return {
      id: request._id.toString(), requestCode: request.requestCode, amount: request.amount, status: request.status,
      transferContent: content, expiresAt: expirationFrom(request) ?? expiresAt.toISOString(),
      bank: { bankId: bank.bankId, accountNo: bank.accountNo, accountName: bank.accountName, template: bank.template },
      qrUrl: vietQrUrl(bank, request.amount, content),
    };
  }

  async checkBankDeposit(requestId: string, userId: string) {
    if (!Types.ObjectId.isValid(requestId) || !Types.ObjectId.isValid(userId)) throw new BadRequestException('Invalid payment request');
    await this.expireBankTopups();
    const request = await this.requests.findOne({ _id: requestId, userId, provider: BANK_PROVIDER, deletedAt: null }).lean();
    if (!request) throw new NotFoundException('Payment request not found');
    return { id: request._id.toString(), requestCode: request.requestCode, amount: request.amount,
      status: request.status, transferContent: transferContentFrom(request), expiresAt: expirationFrom(request) };
  }

  /**
   * Cake delivers at least once and retries non-2xx responses. Matching and
   * wallet credit remain transactionally idempotent on transactionID.
   */
  async processCakeCallback(transactions: BankTransaction[]) {
    await this.expireBankTopups();
    let approved = 0; let incoming = 0;
    for (const transaction of transactions) {
      if (String(transaction.type ?? 'IN').toUpperCase() !== 'IN') continue;
      incoming++;
      if (await this.processBankTransaction(transaction)) approved++;
    }
    return { status: true, msg: 'OK', examined: transactions.length, incoming, approved };
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

  private async processBankTransaction(transaction: BankTransaction) {
    const reference = String(transaction.transactionID ?? '').trim();
    const amount = Number(transaction.amount);
    const description = transaction.description ?? '';
    if (!reference || !Number.isSafeInteger(amount) || amount <= 0 || !description) return false;
    const candidates = await this.requests.find({ provider: BANK_PROVIDER, status: PaymentRequestStatus.PENDING,
      amount, deletedAt: null, providerReference: { $exists: false }, 'metadata.expiresAt': { $gt: new Date().toISOString() } })
      .sort({ createdAt: 1 }).limit(100).lean();
    const request = candidates.find((candidate) => {
      const content = transferContentFrom(candidate);
      return Boolean(content && hasTransferContent(description, content));
    });
    if (!request) return false;
    return this.approveBankRequest(request._id.toString(), reference, transaction);
  }

  private async approveBankRequest(requestId: string, providerReference: string, transaction: BankTransaction) {
    const session = await this.connection.startSession(); let approved = false;
    try {
      await session.withTransaction(async () => {
        const existing = await this.requests.findById(requestId).session(session);
        if (!existing || existing.provider !== BANK_PROVIDER) return;
        if (existing.status === PaymentRequestStatus.APPROVED) { approved = existing.providerReference === providerReference; return; }
        if (existing.status !== PaymentRequestStatus.PENDING) return;
        const alreadyUsed = await this.requests.exists({ provider: BANK_PROVIDER, providerReference }).session(session);
        if (alreadyUsed) return;
        const request = await this.requests.findOneAndUpdate({ _id: existing._id, status: PaymentRequestStatus.PENDING,
          providerReference: { $exists: false } }, { $set: {
          status: PaymentRequestStatus.APPROVED, providerReference, reviewedAt: new Date(),
          // Transaction descriptions can contain a sender's name. Keep only the non-sensitive reference/date.
          metadata: { ...existing.metadata, bankTransaction: { id: providerReference, date: transaction.transactionDate } },
        } }, { new: true, session });
        if (!request) return;
        const walletTransaction = await this.wallet.credit({ userId: request.userId, amount: request.amount,
          type: WalletTransactionType.DEPOSIT, reason: `Bank deposit ${request.requestCode}`,
          referenceType: WalletReferenceType.PAYMENT_REQUEST, referenceId: request._id,
          idempotencyKey: `deposit:bank:${providerReference}`, actorType: ActorType.WEBHOOK,
          metadata: { provider: BANK_PROVIDER, transactionId: providerReference } }, session);
        request.walletTransactionId = walletTransaction._id;
        await request.save({ session });
        approved = true;
      });
      return approved;
    } catch (error) {
      if (isMongoDuplicateKey(error)) return false;
      throw error;
    } finally { await session.endSession(); }
  }

  private async requireBankConfig() {
    const bank = await this.bankConfig?.getBankConfigForRuntime();
    if (!bank) throw new BadRequestException('Nạp tiền chưa được cấu hình ngân hàng');
    return bank;
  }

  private requestCode() { return `PAY-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString('hex').toUpperCase()}`; }
  private bankRequestCode() { return `NAP${randomBytes(8).toString('hex').toUpperCase()}`; }

  private async expireBankTopups() {
    await this.requests.updateMany({ provider: BANK_PROVIDER, status: PaymentRequestStatus.PENDING,
      'metadata.expiresAt': { $lte: new Date().toISOString() } }, {
      $set: { status: PaymentRequestStatus.EXPIRED },
    });
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

function transferContentFrom(request: { metadata?: Record<string, unknown> }) {
  const value = request.metadata?.transferContent;
  return typeof value === 'string' && value ? value : undefined;
}

function expirationFrom(request: { metadata?: Record<string, unknown> }) {
  const value = request.metadata?.expiresAt;
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : undefined;
}

function hasTransferContent(description: string, content: string) {
  const escaped = content.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^A-Z0-9])${escaped}(?=$|[^A-Z0-9])`, 'i').test(description);
}

function vietQrUrl(bank: RuntimeBankConfig, amount: number, description: string) {
  return `https://img.vietqr.io/image/${encodeURIComponent(bank.bankId)}-${encodeURIComponent(bank.accountNo)}-${encodeURIComponent(bank.template)}.png?amount=${amount}&addInfo=${encodeURIComponent(description)}&accountName=${encodeURIComponent(bank.accountName)}`;
}
