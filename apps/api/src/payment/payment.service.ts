import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { ClientSession, Connection, Model } from 'mongoose';
import { randomBytes } from 'node:crypto';
import { ActorType, PaymentRequest, type PaymentRequestDocument, WalletReferenceType } from '@store/database';
import { PaymentRequestStatus, WalletTransactionType } from '@store/shared';
import { isMongoDuplicateKey } from '@store/shared';
import { loadConfig } from '@store/config';
import { BotConfigService, type RuntimeBankConfig } from '../bot-config/bot-config.service';
import { PurchaseService } from '../purchase/purchase.service';
import { WalletService } from '../wallet/wallet.service';

const BANK_PROVIDER = 'BANK_API';
export interface BankTransaction {
  transactionID: string | number;
  amount: number | string;
  description?: string;
  transactionDate?: string;
  type?: string;
}

interface QuickCheckoutMetadata {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  totalAmount: number;
  idempotencyPrefix: string;
  status: 'PENDING_PAYMENT' | 'PROCESSING' | 'FULFILLED' | 'FAILED';
  orderIds?: string[];
  orderCodes?: string[];
  fulfillmentError?: string;
  fulfilledAt?: string;
  processingAt?: string;
}

@Injectable()
export class PaymentService {
  private readonly config = loadConfig();

  constructor(@InjectConnection() private readonly connection: Connection,
    @InjectModel('PaymentRequest') private readonly requests: Model<PaymentRequest>, private readonly wallet: WalletService,
    @Optional() private readonly bankConfig?: BotConfigService,
    @Optional() private readonly purchases?: PurchaseService) {}

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

  async createBankCheckout(userId: string, productId: string, quantity: number, expectedUnitPrice: number, idempotencyKey: string) {
    const bank = await this.requireBankConfig();
    if (!this.purchases) throw new BadRequestException('Thanh toán nhanh chưa sẵn sàng');
    if (!Types.ObjectId.isValid(userId) || !Types.ObjectId.isValid(productId)) throw new BadRequestException('Thông tin thanh toán không hợp lệ');
    const prior = await this.requests.findOne({ idempotencyKey, deletedAt: null });
    if (prior) {
      const priorCheckout = this.assertSameBankCheckout(prior, userId, productId, quantity, expectedUnitPrice);
      return bankCheckoutResponse(prior, priorCheckout, bank);
    }
    const objectUserId = new Types.ObjectId(userId);
    const requestId = new Types.ObjectId();
    const requestCode = this.checkoutRequestCode();
    const transferContent = requestCode;
    const expiresAt = new Date(Date.now() + this.config.bankTopupTtlMinutes * 60_000);
    let request: PaymentRequestDocument | null = null;
    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        const existing = await this.requests.findOne({ idempotencyKey, deletedAt: null }).session(session);
        if (existing) { request = existing; return; }
        const quote = await this.purchases!.reserveBatchForPayment({ userId, productId, quantity, expectedUnitPrice,
          paymentRequestId: requestId.toString(), expiresAt }, session);
        const checkout: QuickCheckoutMetadata = {
          productId: quote.productId, productName: quote.productName, quantity: quote.quantity,
          unitPrice: quote.unitPrice, totalAmount: quote.totalAmount,
          idempotencyPrefix: `quickpay:${requestCode}`, status: 'PENDING_PAYMENT',
        };
        request = (await this.requests.create([{ _id: requestId, requestCode, userId: objectUserId,
          amount: quote.totalAmount, provider: BANK_PROVIDER, status: PaymentRequestStatus.PENDING,
          proofUrls: [], idempotencyKey, metadata: { source: 'telegram-bank-quick-checkout', transferContent,
            expiresAt: expiresAt.toISOString(), quickCheckout: checkout }, deletedAt: null }], { session }))[0] ?? null;
      }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary' });
    } catch (error) {
      if (!isMongoDuplicateKey(error)) throw error;
      request = await this.requests.findOne({ idempotencyKey, deletedAt: null });
    } finally { await session.endSession(); }
    if (!request) throw new Error('Bank checkout could not be created');
    const stored = this.assertSameBankCheckout(request, userId, productId, quantity, expectedUnitPrice);
    return bankCheckoutResponse(request, stored, bank, expiresAt.toISOString());
  }

  private assertSameBankCheckout(request: PaymentRequestDocument, userId: string, productId: string,
    quantity: number, expectedUnitPrice: number) {
    const checkout = quickCheckoutFrom(request);
    if (!request.userId.equals(userId) || request.provider !== BANK_PROVIDER || !checkout ||
      checkout.productId !== productId || checkout.quantity !== quantity || checkout.unitPrice !== expectedUnitPrice ||
      request.amount !== checkout.totalAmount) {
      throw new BadRequestException('Checkout idempotency key was already used for another request');
    }
    return checkout;
  }

  async checkBankDeposit(requestId: string, userId: string) {
    if (!Types.ObjectId.isValid(requestId) || !Types.ObjectId.isValid(userId)) throw new BadRequestException('Invalid payment request');
    await this.expireBankTopups();
    let request = await this.requests.findOne({ _id: requestId, userId, provider: BANK_PROVIDER, deletedAt: null }).lean();
    if (!request) throw new NotFoundException('Payment request not found');
    if (request.status === PaymentRequestStatus.APPROVED && quickCheckoutFrom(request)) {
      await this.fulfillQuickCheckout(request._id.toString());
      request = await this.requests.findOne({ _id: requestId, userId, provider: BANK_PROVIDER, deletedAt: null }).lean();
      if (!request) throw new NotFoundException('Payment request not found');
    }
    return { id: request._id.toString(), requestCode: request.requestCode, amount: request.amount,
      receivedAmount: receivedAmountFrom(request),
      status: request.status, transferContent: transferContentFrom(request), expiresAt: expirationFrom(request),
      checkout: publicQuickCheckout(quickCheckoutFrom(request)) };
  }

  async recoverApprovedQuickCheckouts(limit = 25) {
    const staleBefore = new Date(Date.now() - 60_000).toISOString();
    const requests = await this.requests.find({ provider: BANK_PROVIDER, status: PaymentRequestStatus.APPROVED,
      deletedAt: null, $or: [
        { 'metadata.quickCheckout.status': 'PENDING_PAYMENT' },
        { 'metadata.quickCheckout.status': 'PROCESSING',
          'metadata.quickCheckout.processingAt': { $lte: staleBefore } },
      ] }).select('_id').sort({ updatedAt: 1 }).limit(Math.min(Math.max(limit, 1), 100)).lean();
    let recovered = 0;
    for (const request of requests) {
      if ((await this.fulfillQuickCheckout(request._id.toString()))?.status === 'FULFILLED') recovered++;
    }
    return { examined: requests.length, recovered };
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
    const requestCodes = extractTransferCodes(description);
    if (!requestCodes.length) return false;
    const request = await this.requests.findOne({ provider: BANK_PROVIDER,
      requestCode: { $in: requestCodes },
      status: { $in: [PaymentRequestStatus.PENDING, PaymentRequestStatus.EXPIRED, PaymentRequestStatus.APPROVED] },
      deletedAt: null }).sort({ createdAt: 1 }).lean();
    if (!request) return false;
    if (request.amount !== amount) return this.reconcileMismatchedBankTransfer(request._id.toString(), reference, transaction, amount);
    if (request.status === PaymentRequestStatus.APPROVED && request.providerReference !== reference) {
      return this.creditSupplementalBankTransfer(request, reference, transaction, amount);
    }
    return this.approveBankRequest(request._id.toString(), reference, transaction);
  }

  private async creditSupplementalBankTransfer(request: PaymentRequest & { _id: Types.ObjectId }, providerReference: string,
    transaction: BankTransaction, amount: number, session?: ClientSession) {
    await this.wallet.creditReceivedFunds({ userId: request.userId, amount,
      type: WalletTransactionType.DEPOSIT, reason: `Additional bank transfer for ${request.requestCode}`,
      referenceType: WalletReferenceType.PAYMENT_REQUEST, referenceId: request._id,
      idempotencyKey: `deposit:bank:${providerReference}`, actorType: ActorType.WEBHOOK,
      metadata: { provider: BANK_PROVIDER, transactionId: providerReference, supplemental: true,
        transactionDate: transaction.transactionDate } }, session);
    return true;
  }

  private async reconcileMismatchedBankTransfer(requestId: string, providerReference: string,
    transaction: BankTransaction, receivedAmount: number) {
    const session = await this.connection.startSession(); let reconciled = false;
    try {
      await session.withTransaction(async () => {
        const existing = await this.requests.findById(requestId).session(session);
        if (!existing || existing.provider !== BANK_PROVIDER) return;
        if (existing.status === PaymentRequestStatus.APPROVED) {
          await this.creditSupplementalBankTransfer(existing, providerReference, transaction, receivedAmount, session);
          reconciled = true;
          return;
        }
        if (existing.status !== PaymentRequestStatus.PENDING && existing.status !== PaymentRequestStatus.EXPIRED) return;
        if (await this.requests.exists({ provider: BANK_PROVIDER, providerReference }).session(session)) return;
        const checkout = quickCheckoutFrom(existing);
        const metadata: Record<string, unknown> = { ...existing.metadata,
          bankTransaction: { id: providerReference, date: transaction.transactionDate },
          amountMismatch: { expected: existing.amount, received: receivedAmount } };
        if (checkout) metadata.quickCheckout = mismatchedAmountQuickCheckout(checkout, receivedAmount);
        const request = await this.requests.findOneAndUpdate({ _id: existing._id,
          status: { $in: [PaymentRequestStatus.PENDING, PaymentRequestStatus.EXPIRED] },
          providerReference: { $exists: false } }, { $set: { status: PaymentRequestStatus.APPROVED,
          providerReference, reviewedAt: new Date(), metadata } }, { new: true, session });
        if (!request) return;
        const walletTransaction = await this.wallet.creditReceivedFunds({ userId: request.userId, amount: receivedAmount,
          type: WalletTransactionType.DEPOSIT, reason: `Bank deposit ${request.requestCode} (amount adjusted)`,
          referenceType: WalletReferenceType.PAYMENT_REQUEST, referenceId: request._id,
          idempotencyKey: `deposit:bank:${providerReference}`, actorType: ActorType.WEBHOOK,
          metadata: { provider: BANK_PROVIDER, transactionId: providerReference,
            expectedAmount: request.amount, receivedAmount } }, session);
        request.walletTransactionId = walletTransaction._id;
        await request.save({ session });
        if (checkout) await this.purchases?.releaseBankCheckoutReservation(request._id.toString(), session);
        reconciled = true;
      });
      return reconciled;
    } catch (error) {
      if (isMongoDuplicateKey(error)) return false;
      throw error;
    } finally { await session.endSession(); }
  }

  private async approveBankRequest(requestId: string, providerReference: string, transaction: BankTransaction) {
    const session = await this.connection.startSession(); let approved = false; let resumeFulfillment = false;
    let createdOrders: Array<{ _id: Types.ObjectId; orderCode: string }> = [];
    try {
      await session.withTransaction(async () => {
        createdOrders = [];
        const existing = await this.requests.findById(requestId).session(session);
        if (!existing || existing.provider !== BANK_PROVIDER) return;
        if (existing.status === PaymentRequestStatus.APPROVED) {
          if (existing.providerReference !== providerReference) {
            await this.creditSupplementalBankTransfer(existing, providerReference, transaction, existing.amount, session);
            approved = true;
            resumeFulfillment = false;
            return;
          }
          approved = true;
          const approvedCheckout = quickCheckoutFrom(existing);
          resumeFulfillment = approved && Boolean(approvedCheckout && approvedCheckout.status !== 'FAILED');
          return;
        }
        if (existing.status !== PaymentRequestStatus.PENDING && existing.status !== PaymentRequestStatus.EXPIRED) return;
        const alreadyUsed = await this.requests.exists({ provider: BANK_PROVIDER, providerReference }).session(session);
        if (alreadyUsed) return;
        const checkout = quickCheckoutFrom(existing);
        const expiresAt = expirationFrom(existing);
        const latePayment = existing.status === PaymentRequestStatus.EXPIRED || Boolean(expiresAt && Date.parse(expiresAt) <= Date.now());
        const metadata: Record<string, unknown> = { ...existing.metadata,
          bankTransaction: { id: providerReference, date: transaction.transactionDate }, latePayment };
        let checkoutCanFulfill = Boolean(checkout && !latePayment);
        if (latePayment && checkout) metadata.quickCheckout = lateQuickCheckout(checkout);
        else if (checkout) {
          const activeUser = await this.purchases?.bankCheckoutUserIsActive(existing.userId.toString(), session);
          const held = activeUser ? await this.purchases?.extendBankCheckoutReservation(existing._id.toString(),
            new Date(Date.now() + 15 * 60_000), session) : undefined;
          if (!activeUser) {
            checkoutCanFulfill = false;
            metadata.quickCheckout = inactiveUserQuickCheckout(checkout);
          } else if (held?.matchedCount !== checkout.quantity) {
            checkoutCanFulfill = false;
            metadata.quickCheckout = unavailableQuickCheckout(checkout);
          }
        }
        const request = await this.requests.findOneAndUpdate({ _id: existing._id,
          status: { $in: [PaymentRequestStatus.PENDING, PaymentRequestStatus.EXPIRED] },
          providerReference: { $exists: false } }, { $set: {
          status: PaymentRequestStatus.APPROVED, providerReference, reviewedAt: new Date(),
          // Transaction descriptions can contain a sender's name. Keep only the non-sensitive reference/date.
          metadata,
        } }, { new: true, session });
        if (!request) throw new Error('Payment request approval claim was lost');
        const walletTransaction = await this.wallet.creditReceivedFunds({ userId: request.userId, amount: request.amount,
          type: WalletTransactionType.DEPOSIT, reason: `Bank deposit ${request.requestCode}`,
          referenceType: WalletReferenceType.PAYMENT_REQUEST, referenceId: request._id,
          idempotencyKey: `deposit:bank:${providerReference}`, actorType: ActorType.WEBHOOK,
          metadata: { provider: BANK_PROVIDER, transactionId: providerReference } }, session);
        if (checkout && checkoutCanFulfill) {
          if (!this.purchases) throw new Error('Quick checkout purchase service is unavailable');
          createdOrders = await this.purchases.purchaseBatchInSession({
            userId: request.userId.toString(), productId: checkout.productId, quantity: checkout.quantity,
            expectedUnitPrice: checkout.unitPrice, idempotencyPrefix: checkout.idempotencyPrefix,
            paymentRequestId: request._id.toString(),
          }, session);
          const fulfilled: QuickCheckoutMetadata = { ...checkout, status: 'FULFILLED',
            orderIds: createdOrders.map((order) => order._id.toString()),
            orderCodes: createdOrders.map((order) => order.orderCode), fulfilledAt: new Date().toISOString() };
          delete fulfilled.fulfillmentError;
          delete fulfilled.processingAt;
          metadata.quickCheckout = fulfilled;
        }
        request.walletTransactionId = walletTransaction._id;
        request.metadata = metadata;
        request.markModified('metadata');
        await request.save({ session });
        if (checkout && !checkoutCanFulfill) await this.purchases?.releaseBankCheckoutReservation(request._id.toString(), session);
        approved = true;
        resumeFulfillment = false;
      });
      if (createdOrders.length) await this.purchases?.dispatchBatch(createdOrders);
      else if (approved && resumeFulfillment) await this.fulfillQuickCheckout(requestId);
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
  private checkoutRequestCode() { return `DON${randomBytes(8).toString('hex').toUpperCase()}`; }

  private async fulfillQuickCheckout(requestId: string) {
    const current = await this.requests.findOne({ _id: requestId, provider: BANK_PROVIDER,
      status: PaymentRequestStatus.APPROVED, deletedAt: null }).lean();
    const currentCheckout = current ? quickCheckoutFrom(current) : undefined;
    if (!current || !currentCheckout) return currentCheckout;
    // FAILED checkouts have already released their stock and intentionally
    // keep the original reconciliation reason (late/mismatched/inactive).
    if (currentCheckout.status === 'FAILED') return currentCheckout;
    if (currentCheckout.status === 'FULFILLED') {
      await this.purchases?.redispatchPendingOrders(currentCheckout.orderIds ?? []);
      return currentCheckout;
    }
    const processingAt = new Date().toISOString();
    const staleBefore = new Date(Date.now() - 60_000).toISOString();
    const request = await this.requests.findOneAndUpdate({ _id: current._id, provider: BANK_PROVIDER,
      status: PaymentRequestStatus.APPROVED, deletedAt: null, $or: [
        { 'metadata.quickCheckout.status': 'PENDING_PAYMENT' },
        { 'metadata.quickCheckout.status': 'PROCESSING', 'metadata.quickCheckout.processingAt': { $lte: staleBefore } },
      ] }, { $set: { 'metadata.quickCheckout.status': 'PROCESSING',
        'metadata.quickCheckout.processingAt': processingAt },
      $unset: { 'metadata.quickCheckout.fulfillmentError': 1 } }, { new: true }).lean();
    if (!request) {
      const inProgress = await this.requests.findById(requestId).lean();
      return inProgress ? quickCheckoutFrom(inProgress) : undefined;
    }
    const checkout = quickCheckoutFrom(request);
    if (!checkout) return undefined;
    if (!this.purchases) {
      const failed = { ...checkout, status: 'FAILED' as const, fulfillmentError: 'Dịch vụ tạo đơn chưa sẵn sàng' };
      delete failed.processingAt;
      return this.finishQuickCheckoutLease(request._id.toString(), processingAt, failed);
    }
    try {
      const orders = await this.purchases.purchaseBatch({
        userId: request.userId.toString(), productId: checkout.productId, quantity: checkout.quantity,
        expectedUnitPrice: checkout.unitPrice, idempotencyPrefix: checkout.idempotencyPrefix,
        paymentRequestId: request._id.toString(),
      });
      const fulfilled: QuickCheckoutMetadata = { ...checkout, status: 'FULFILLED',
        orderIds: orders.map((order) => order._id.toString()), orderCodes: orders.map((order) => order.orderCode),
        fulfilledAt: new Date().toISOString() };
      delete fulfilled.fulfillmentError;
      delete fulfilled.processingAt;
      return this.finishQuickCheckoutLease(request._id.toString(), processingAt, fulfilled);
    } catch (error) {
      const failed: QuickCheckoutMetadata = { ...checkout, status: 'FAILED',
        fulfillmentError: checkoutErrorMessage(error) };
      delete failed.processingAt;
      const finished = await this.finishQuickCheckoutLease(request._id.toString(), processingAt, failed);
      if (finished?.status === 'FAILED' && finished.fulfillmentError === failed.fulfillmentError) {
        try { await this.purchases.releaseBankCheckoutReservation(request._id.toString()); }
        catch (releaseError) {
          // The reservation expiry worker is the fallback cleanup path. The
          // bank callback must not fail after its wallet credit is committed.
          console.error({ event: 'quick-checkout-reservation-release-failed', requestId: request._id.toString(),
            message: releaseError instanceof Error ? releaseError.message : 'unknown error' });
        }
      }
      return finished;
    }
  }

  private async finishQuickCheckoutLease(requestId: string, processingAt: string, value: QuickCheckoutMetadata) {
    const updated = await this.requests.findOneAndUpdate({ _id: requestId, status: PaymentRequestStatus.APPROVED,
      'metadata.quickCheckout.status': 'PROCESSING', 'metadata.quickCheckout.processingAt': processingAt },
    { $set: { 'metadata.quickCheckout': value } }, { new: true }).lean();
    if (updated) return quickCheckoutFrom(updated);
    const latest = await this.requests.findById(requestId).lean();
    return latest ? quickCheckoutFrom(latest) : undefined;
  }

  private async expireBankTopups() {
    const expiresAt = new Date().toISOString();
    const checkouts = await this.requests.find({ provider: BANK_PROVIDER, status: PaymentRequestStatus.PENDING,
      'metadata.expiresAt': { $lte: expiresAt }, 'metadata.quickCheckout': { $exists: true } })
      .select('_id').sort({ createdAt: 1 }).limit(500).lean();
    for (const checkout of checkouts) {
      const session = await this.connection.startSession();
      try {
        await session.withTransaction(async () => {
          const expired = await this.requests.findOneAndUpdate({ _id: checkout._id, provider: BANK_PROVIDER,
            status: PaymentRequestStatus.PENDING, 'metadata.expiresAt': { $lte: new Date().toISOString() } },
          { $set: { status: PaymentRequestStatus.EXPIRED } }, { new: true, session });
          if (expired) await this.purchases?.releaseBankCheckoutReservation(expired._id.toString(), session);
        });
      } finally { await session.endSession(); }
    }
    await this.requests.updateMany({ provider: BANK_PROVIDER, status: PaymentRequestStatus.PENDING,
      'metadata.expiresAt': { $lte: expiresAt }, 'metadata.quickCheckout': { $exists: false } },
    { $set: { status: PaymentRequestStatus.EXPIRED } });
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

function receivedAmountFrom(request: {
  amount: number;
  status: string;
  metadata?: Record<string, unknown>;
}) {
  if (request.status !== PaymentRequestStatus.APPROVED) return undefined;
  const mismatch = request.metadata?.amountMismatch;
  if (mismatch && typeof mismatch === 'object' && !Array.isArray(mismatch)) {
    const received = (mismatch as { received?: unknown }).received;
    if (Number.isSafeInteger(received) && (received as number) > 0) return received as number;
  }
  return request.amount;
}

function quickCheckoutFrom(request: { metadata?: Record<string, unknown> }): QuickCheckoutMetadata | undefined {
  const value = request.metadata?.quickCheckout;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const checkout = value as Partial<QuickCheckoutMetadata>;
  if (typeof checkout.productId !== 'string' || !Types.ObjectId.isValid(checkout.productId) ||
    typeof checkout.productName !== 'string' || !checkout.productName ||
    !Number.isSafeInteger(checkout.quantity) || (checkout.quantity ?? 0) < 1 ||
    !Number.isSafeInteger(checkout.unitPrice) || (checkout.unitPrice ?? -1) < 0 ||
    !Number.isSafeInteger(checkout.totalAmount) || (checkout.totalAmount ?? 0) < 1 ||
    typeof checkout.idempotencyPrefix !== 'string' || !checkout.idempotencyPrefix ||
    !['PENDING_PAYMENT', 'PROCESSING', 'FULFILLED', 'FAILED'].includes(checkout.status ?? '')) return undefined;
  return checkout as QuickCheckoutMetadata;
}

function publicQuickCheckout(checkout?: QuickCheckoutMetadata) {
  if (!checkout) return undefined;
  return { productId: checkout.productId, productName: checkout.productName, quantity: checkout.quantity,
    unitPrice: checkout.unitPrice, totalAmount: checkout.totalAmount, status: checkout.status,
    orderCodes: checkout.orderCodes ?? [], fulfillmentError: checkout.fulfillmentError };
}

function bankCheckoutResponse(request: PaymentRequestDocument, checkout: QuickCheckoutMetadata,
  bank: RuntimeBankConfig, fallbackExpiresAt?: string) {
  const content = transferContentFrom(request);
  if (!content) throw new Error('Bank checkout transfer content is missing');
  return {
    id: request._id.toString(), requestCode: request.requestCode, amount: request.amount, status: request.status,
    transferContent: content, expiresAt: expirationFrom(request) ?? fallbackExpiresAt,
    productId: checkout.productId, productName: checkout.productName, quantity: checkout.quantity,
    unitPrice: checkout.unitPrice, checkoutStatus: checkout.status,
    bank: { bankId: bank.bankId, accountNo: bank.accountNo, accountName: bank.accountName, template: bank.template },
    qrUrl: vietQrUrl(bank, request.amount, content),
  };
}

function checkoutErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : 'Không thể tạo đơn tự động';
  const translated = message.includes('No inventory item is available') ? 'Sản phẩm đã hết hàng; tiền đã được giữ trong số dư ví'
    : message.includes('Product price changed') ? 'Giá sản phẩm đã thay đổi; tiền đã được giữ trong số dư ví'
      : message.includes('Purchase limit reached') ? 'Đã vượt giới hạn mua; tiền đã được giữ trong số dư ví'
        : message.includes('Insufficient wallet balance') ? 'Số dư đã thay đổi trước khi tạo đơn; vui lòng kiểm tra lại ví'
          : `Không thể tạo đơn tự động: ${message}`;
  return translated.slice(0, 500);
}

function extractTransferCodes(description: string) {
  const matches = description.toUpperCase().matchAll(/(?:^|[^A-Z0-9])((?:NAP|DON)[A-F0-9]{16})(?=$|[^A-Z0-9])/g);
  return [...new Set([...matches].map((match) => match[1]).filter((value): value is string => Boolean(value)))];
}

function lateQuickCheckout(checkout: QuickCheckoutMetadata): QuickCheckoutMetadata {
  const failed: QuickCheckoutMetadata = { ...checkout, status: 'FAILED',
    fulfillmentError: 'Thanh toán sau thời hạn giữ hàng; tiền đã được cộng vào ví. Vui lòng đặt đơn mới.' };
  delete failed.processingAt;
  return failed;
}

function unavailableQuickCheckout(checkout: QuickCheckoutMetadata): QuickCheckoutMetadata {
  const failed: QuickCheckoutMetadata = { ...checkout, status: 'FAILED',
    fulfillmentError: 'Không còn đủ hàng đã giữ; tiền đã được cộng vào ví. Vui lòng đặt đơn mới.' };
  delete failed.processingAt;
  return failed;
}

function inactiveUserQuickCheckout(checkout: QuickCheckoutMetadata): QuickCheckoutMetadata {
  const failed: QuickCheckoutMetadata = { ...checkout, status: 'FAILED',
    fulfillmentError: 'Tài khoản đang bị tạm ngưng; tiền đã được ghi nhận vào ví. Vui lòng liên hệ hỗ trợ.' };
  delete failed.processingAt;
  return failed;
}

function mismatchedAmountQuickCheckout(checkout: QuickCheckoutMetadata, receivedAmount: number): QuickCheckoutMetadata {
  const failed: QuickCheckoutMetadata = { ...checkout, status: 'FAILED',
    fulfillmentError: `Đã nhận ${receivedAmount} đ nhưng đơn cần đúng ${checkout.totalAmount} đ; tiền đã được cộng vào ví. Vui lòng đặt đơn mới.` };
  delete failed.processingAt;
  return failed;
}

function vietQrUrl(bank: RuntimeBankConfig, amount: number, description: string) {
  return `https://img.vietqr.io/image/${encodeURIComponent(bank.bankId)}-${encodeURIComponent(bank.accountNo)}-${encodeURIComponent(bank.template)}.png?amount=${amount}&addInfo=${encodeURIComponent(description)}&accountName=${encodeURIComponent(bank.accountName)}`;
}
