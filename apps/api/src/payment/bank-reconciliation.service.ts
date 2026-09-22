import { BadRequestException, Inject, Injectable, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { PaymentRequest, type User, type WalletTransaction, WalletReferenceType } from '@store/database';
import { PaymentRequestStatus, WalletTransactionType } from '@store/shared';
import { BotConfigService } from '../bot-config/bot-config.service';
import {
  CAKE_HISTORY_FETCHER, extractTransferCodes, fetchBankHistorySnapshot,
  type BankHistorySnapshot, type BankTransaction, type CakeHistoryFetch,
} from './payment.service';

const BANK_PROVIDER = 'BANK_API';
const LEGACY_BANK_ID = 'legacy';
const HISTORY_LIMIT = 500;
const MAX_AMOUNT = 9_999_999_999_999;

export type BankReconciliationStatus =
  | 'MATCHED' | 'AMOUNT_MISMATCH' | 'NOT_CREDITED' | 'UNMATCHED' | 'AMBIGUOUS' | 'OUTGOING'
  | 'BANK_RECEIVED_REQUEST_REJECTED' | 'BANK_RECEIVED_REQUEST_EXPIRED'
  | 'BANK_RECEIVED_REQUEST_CANCELLED' | 'DUPLICATE';

interface BankReconciliationUser {
  telegramId?: string;
  username?: string;
  displayName?: string;
}

interface BankReconciliationRequest {
  id: string;
  requestCode: string;
  status: string;
  requestedAmount: number;
  userId: string;
  telegramId?: string;
  username?: string;
  displayName?: string;
  rejectionReason?: string;
  providerReference?: string;
  deletedAt?: string | null;
  walletTransactionId?: string;
  metadata?: {
    amountMismatch?: { expected: number; received: number };
    quickCheckoutStatus?: string;
    cancelled?: boolean;
  };
}

export interface BankReconciliationItem {
  transactionId: string;
  type: 'IN' | 'OUT';
  amount: number;
  description: string;
  transactionDate?: string;
  transactionAt?: string;
  status: BankReconciliationStatus;
  creditedAmount: number;
  difference: number;
  paymentRequests: BankReconciliationRequest[];
  walletTransactionIds: string[];
  notes: string[];
}

export interface BankReconciliationResult {
  bank: { id: string; label: string; provider: string; bankId: string; accountNo: string; accountNoLast4: string };
  fetchedAt: string;
  coverage: {
    source: 'provider_recent_history'; rawCount: number; validCount: number; discardedCount: number;
    truncated: boolean; unknownDateCount: number; duplicateCount: number; warnings: string[];
  };
  summary: {
    incomingCount: number; incomingAmount: number; outgoingCount: number; outgoingAmount: number;
    creditedAmount: number; difference: number; matchedCount: number; uncreditedCount: number;
    mismatchCount: number; ambiguousCount: number; unmatchedCount: number;
    rejectedReceivedCount: number; rejectedReceivedAmount: number;
    statusCounts: Record<string, number>;
  };
  items: BankReconciliationItem[];
}

interface ReconciliationRequestDoc {
  _id: unknown;
  requestCode: string;
  userId: { toString(): string };
  amount: number;
  provider: string;
  providerReference?: string;
  status: string;
  rejectionReason?: string;
  walletTransactionId?: { toString(): string };
  metadata?: Record<string, unknown>;
  deletedAt?: Date | null;
}

interface ReconciliationWalletDoc {
  _id: unknown;
  userId: { toString(): string };
  amount: number;
  type: string;
  referenceType: string;
  referenceId?: { toString(): string };
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}

interface WorkingTransaction {
  transaction: BankTransaction;
  duplicateCount: number;
  duplicateConflict: boolean;
  notes: string[];
}

@Injectable()
export class BankReconciliationService {
  constructor(
    @InjectModel('PaymentRequest') private readonly requests: Model<PaymentRequest>,
    @InjectModel('WalletTransaction') private readonly walletTransactions: Model<WalletTransaction>,
    @InjectModel('User') private readonly users: Model<User>,
    private readonly bankConfig: BotConfigService,
    @Optional() @Inject(CAKE_HISTORY_FETCHER) private readonly historyFetch?: CakeHistoryFetch,
  ) {}

  async reconcile(bankConfigId: string): Promise<BankReconciliationResult> {
    const bank = await this.bankConfig.getBankConfigForRuntime(bankConfigId);
    if (!bank) throw new BadRequestException('Không tìm thấy cấu hình ngân hàng được chọn');

    let snapshot: BankHistorySnapshot;
    try {
      snapshot = await fetchBankHistorySnapshot(bank.provider, bank.token, this.historyFetch ?? globalThis.fetch);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'phản hồi không hợp lệ';
      throw new BadRequestException(`Không truy vấn được lịch sử ngân hàng: ${reason}`);
    }

    const fetchedAt = new Date().toISOString();
    const working = deduplicateTransactions(snapshot.transactions);
    const transactions = working.map((entry) => entry.transaction);
    const transactionIds = transactions.map((transaction) => String(transaction.transactionID));
    const requestCodes = unique(transactions.flatMap((transaction) =>
      extractTransferCodes(String(transaction.description ?? ''))));
    const scopedReferences = transactionIds.map((id) => scopedBankReference(bank.id, id));
    const legacyReferences = bank.id === LEGACY_BANK_ID ? transactionIds : [];
    const providerReferences = unique([...scopedReferences, ...legacyReferences]);

    const requests = await this.findPaymentRequests(requestCodes, providerReferences);
    const requestIds = requests.map((request) => String(request._id));
    const walletKeys = unique(providerReferences.map((reference) => `deposit:bank:${reference}`));
    const wallets = await this.findWalletTransactions(walletKeys, requestIds);
    const users = await this.findUsers(requests);

    const items = transactions.map((transaction) => this.buildItem(transaction, bank.id, requests,
      wallets, users, working.find((entry) => entry.transaction === transaction)));
    return this.result(bank, fetchedAt, snapshot, working, items);
  }

  private async findPaymentRequests(requestCodes: string[], providerReferences: string[]) {
    const clauses: Record<string, unknown>[] = [];
    if (requestCodes.length) clauses.push({ requestCode: { $in: requestCodes } });
    if (providerReferences.length) clauses.push({ providerReference: { $in: providerReferences } });
    if (!clauses.length) return [] as ReconciliationRequestDoc[];
    return this.requests.find({ provider: BANK_PROVIDER, $or: clauses })
      .select('_id requestCode userId amount provider providerReference status rejectionReason walletTransactionId metadata deletedAt')
      .lean().exec() as Promise<ReconciliationRequestDoc[]>;
  }

  private async findWalletTransactions(walletKeys: string[], requestIds: string[]) {
    const clauses: Record<string, unknown>[] = [];
    if (walletKeys.length) clauses.push({ idempotencyKey: { $in: walletKeys } });
    if (requestIds.length) clauses.push({ referenceId: { $in: requestIds } });
    if (!clauses.length) return [] as ReconciliationWalletDoc[];
    return this.walletTransactions.find({ type: WalletTransactionType.DEPOSIT,
      referenceType: WalletReferenceType.PAYMENT_REQUEST, amount: { $gt: 0 }, $or: clauses })
      .select('_id userId amount type referenceType referenceId idempotencyKey metadata').lean().exec() as Promise<ReconciliationWalletDoc[]>;
  }

  private async findUsers(requests: ReconciliationRequestDoc[]) {
    const ids = unique(requests.map((request) => request.userId.toString()));
    if (!ids.length) return new Map<string, BankReconciliationUser>();
    const rows = await this.users.find({ _id: { $in: ids } }).select('telegramId username displayName').lean().exec();
    return new Map(rows.map((user) => [String(user._id), {
      telegramId: user.telegramId, username: user.username, displayName: user.displayName,
    }]));
  }

  private buildItem(transaction: BankTransaction, bankConfigId: string, requests: ReconciliationRequestDoc[],
    wallets: ReconciliationWalletDoc[], users: Map<string, BankReconciliationUser>, working?: WorkingTransaction): BankReconciliationItem {
    const transactionId = String(transaction.transactionID);
    const type = normalizeType(transaction.type);
    const amount = integerAmount(transaction.amount);
    const description = String(transaction.description ?? '');
    const date = parseTransactionDate(transaction.transactionDate);
    const notes: string[] = [];
    if (working?.duplicateCount) notes.push(`Nhà cung cấp trả trùng ${working.duplicateCount + 1} dòng giao dịch.`);
    if (working?.duplicateConflict) notes.push('Các dòng trùng transactionID có nội dung khác nhau; cần kiểm tra thủ công.');
    if (type === 'OUT') {
      notes.push('Giao dịch tiền ra được tách riêng và không tính vào tiền nhận.');
      return { transactionId, type, amount, description, ...date, status: working?.duplicateConflict ? 'DUPLICATE' : 'OUTGOING',
        creditedAmount: 0, difference: 0, paymentRequests: [], walletTransactionIds: [], notes };
    }

    const codes = new Set(extractTransferCodes(description));
    const scopedReference = scopedBankReference(bankConfigId, transactionId);
    const legacyReference = bankConfigId === LEGACY_BANK_ID ? transactionId : undefined;
    const expectedKeys = new Set([`deposit:bank:${scopedReference}`, ...(legacyReference ? [`deposit:bank:${legacyReference}`] : [])]);
    const rowRequests = requests.filter((request) => {
      const codeMatch = codes.has(request.requestCode.toUpperCase());
      const referenceMatch = request.providerReference === scopedReference ||
        (Boolean(legacyReference) && request.providerReference === legacyReference);
      return codeMatch || referenceMatch;
    });
    const rowRequestIds = new Set(rowRequests.map((request) => String(request._id)));
    const rowWallets = wallets.filter((wallet) => this.walletBelongsToRow(wallet, transactionId,
      bankConfigId, expectedKeys, rowRequestIds));
    const creditedAmount = rowWallets.reduce((sum, wallet) => sum + integerAmount(wallet.amount), 0);
    const paymentRequests = rowRequests.map((request) => this.publicRequest(request, users));
    const scopedLedgerKey = `deposit:bank:${scopedReference}`;
    const hasScopedLedgerEvidence = rowWallets.some((wallet) => wallet.idempotencyKey === scopedLedgerKey);
    const hasScopeMismatch = rowRequests.some((request) => {
      const pinned = bankConfigIdFrom(request);
      return Boolean(pinned && pinned !== bankConfigId);
    });
    const hasLegacyUnscoped = bankConfigId !== LEGACY_BANK_ID && rowRequests.some((request) => !bankConfigIdFrom(request));
    const hasRawUnscopedReference = bankConfigId !== LEGACY_BANK_ID && rowRequests.some((request) => request.providerReference === transactionId);
    const scopeUncertainty = (hasScopeMismatch || hasLegacyUnscoped || hasRawUnscopedReference) && !hasScopedLedgerEvidence;
    const rejected = rowRequests.find((request) => request.status === PaymentRequestStatus.REJECTED);
    const expired = rowRequests.find((request) => request.status === PaymentRequestStatus.EXPIRED);
    const cancelled = rowRequests.find((request) => Boolean(request.metadata?.userCancelledAt));
    const expectedAmountMismatch = rowRequests.find((request) => integerAmount(request.amount) !== amount);
    if (hasScopeMismatch) notes.push(hasScopedLedgerEvidence
      ? 'Payment request lưu bank scope khác; bút toán scoped của tài khoản này được dùng làm bằng chứng thực nhận.'
      : 'Mã nạp thuộc cấu hình ngân hàng khác; không tự quy kết bút toán.');
    if (hasLegacyUnscoped) notes.push(hasScopedLedgerEvidence
      ? 'Yêu cầu nạp cũ không lưu bank scope; idempotency key scoped xác nhận tài khoản nhận.'
      : 'Yêu cầu nạp cũ không lưu bank scope; không thể chứng minh thuộc tài khoản này.');
    if (hasRawUnscopedReference) notes.push(hasScopedLedgerEvidence
      ? 'Payment request dùng transactionID legacy; ledger scoped xác nhận tài khoản nhận.'
      : 'transactionID legacy không đủ để xác định tài khoản ngân hàng nhận tiền.');
    if (rowWallets.some((wallet) => {
      const value = wallet.metadata?.bankConfigId;
      return typeof value === 'string' && value !== bankConfigId;
    })) notes.push('Metadata bút toán lệch bank scope; đối soát ưu tiên idempotency key scoped.');
    if (rowWallets.length > 1) notes.push('Có nhiều bút toán DEPOSIT cho transactionID này; tổng creditedAmount là tổng ledger thực tế.');
    if (rejected) notes.push(`Bank đã nhận nhưng yêu cầu nạp bị từ chối${rejected.rejectionReason ? `: ${rejected.rejectionReason}` : '.'}`);
    if (expired) notes.push('Bank đã nhận sau khi yêu cầu nạp hết hạn.');
    if (cancelled) notes.push('Bank đã nhận sau khi khách hủy yêu cầu nạp.');
    if (expectedAmountMismatch) notes.push(`Số tiền bank nhận ${amount} khác số tiền yêu cầu ${integerAmount(expectedAmountMismatch.amount)}; đối soát creditedAmount theo ledger thực tế.`);
    if (rowWallets.length === 0) notes.push('Chưa tìm thấy bút toán DEPOSIT thực tế trong sổ ví.');
    if (rowRequests.length === 0 && rowWallets.length > 0) notes.push('Có bút toán DEPOSIT nhưng không còn payment request tương ứng.');
    if (bankConfigId === LEGACY_BANK_ID && rowRequests.some((request) => !bankConfigIdFrom(request))) {
      notes.push('Khớp theo transactionID legacy; dữ liệu cũ không lưu bank scope.');
    }
    const difference = amount - creditedAmount;
    let status: BankReconciliationStatus;
    if (working?.duplicateConflict) status = 'DUPLICATE';
    else if (scopeUncertainty) status = 'AMBIGUOUS';
    else if (rejected) status = 'BANK_RECEIVED_REQUEST_REJECTED';
    else if (expired) status = 'BANK_RECEIVED_REQUEST_EXPIRED';
    else if (cancelled) status = 'BANK_RECEIVED_REQUEST_CANCELLED';
    else if (rowRequests.length > 1) status = 'AMBIGUOUS';
    else if (rowRequests.length === 0 && rowWallets.length === 0) status = 'UNMATCHED';
    else if (creditedAmount === 0) status = 'NOT_CREDITED';
    else if (difference !== 0) status = 'AMOUNT_MISMATCH';
    else if (rowRequests.length === 0) status = 'AMBIGUOUS';
    else status = 'MATCHED';
    return { transactionId, type, amount, description, ...date, status, creditedAmount, difference,
      paymentRequests, walletTransactionIds: unique(rowWallets.map((wallet) => String(wallet._id))), notes };
  }

  private walletBelongsToRow(wallet: ReconciliationWalletDoc, transactionId: string, bankConfigId: string,
    expectedKeys: Set<string>, requestIds: Set<string>) {
    const metadata = wallet.metadata ?? {};
    const metadataBank = typeof metadata.bankConfigId === 'string' ? metadata.bankConfigId : undefined;
    const metadataTransaction = String(metadata.transactionId ?? '').trim();
    if (metadataTransaction && metadataTransaction !== transactionId) return false;
    const direct = expectedKeys.has(wallet.idempotencyKey);
    if (direct) return true;
    if (metadataBank ? metadataBank !== bankConfigId : bankConfigId !== LEGACY_BANK_ID) return false;
    const byRequest = Boolean(wallet.referenceId && requestIds.has(wallet.referenceId.toString()) && metadataTransaction === transactionId);
    return direct || byRequest;
  }

  private publicRequest(request: ReconciliationRequestDoc, users: Map<string, BankReconciliationUser>): BankReconciliationRequest {
    const userId = request.userId.toString();
    const metadata = request.metadata ?? {};
    const mismatch = metadata.amountMismatch;
    const amountMismatch = isRecord(mismatch) && Number.isSafeInteger(mismatch.expected) && Number.isSafeInteger(mismatch.received)
      ? { expected: Number(mismatch.expected), received: Number(mismatch.received) } : undefined;
    const quickCheckout = isRecord(metadata.quickCheckout) && typeof metadata.quickCheckout.status === 'string'
      ? metadata.quickCheckout.status : undefined;
    return { id: String(request._id), requestCode: request.requestCode, status: request.status,
      requestedAmount: integerAmount(request.amount), userId, ...users.get(userId),
      ...(request.rejectionReason ? { rejectionReason: request.rejectionReason } : {}),
      ...(request.providerReference ? { providerReference: request.providerReference } : {}),
      deletedAt: request.deletedAt?.toISOString?.() ?? null,
      ...(request.walletTransactionId ? { walletTransactionId: request.walletTransactionId.toString() } : {}),
      ...((amountMismatch || quickCheckout || metadata.userCancelledAt) ? { metadata: {
        ...(amountMismatch ? { amountMismatch } : {}), ...(quickCheckout ? { quickCheckoutStatus: quickCheckout } : {}),
        ...(metadata.userCancelledAt ? { cancelled: true } : {}),
      } } : {}),
    };
  }

  private result(bank: { id: string; label: string; provider: string; bankId: string; accountNo: string }, fetchedAt: string,
    snapshot: BankHistorySnapshot, working: WorkingTransaction[], items: BankReconciliationItem[]): BankReconciliationResult {
    const incoming = items.filter((item) => item.type === 'IN');
    const outgoing = items.filter((item) => item.type === 'OUT');
    const statusCounts = items.reduce<Record<string, number>>((counts, item) => {
      counts[item.status] = (counts[item.status] ?? 0) + 1; return counts;
    }, {});
    const rejected = items.filter((item) => item.status === 'BANK_RECEIVED_REQUEST_REJECTED');
    const unknownDateCount = items.filter((item) => !item.transactionAt).length;
    const duplicateCount = working.reduce((sum, row) => sum + row.duplicateCount, 0);
    const warnings: string[] = [];
    if (snapshot.truncated) warnings.push(`Nhà cung cấp chỉ trả ${HISTORY_LIMIT} dòng đầu; còn dữ liệu cũ hơn chưa được đối soát.`);
    if (snapshot.discardedCount) warnings.push(`${snapshot.discardedCount} dòng lịch sử không hợp lệ đã bị loại.`);
    if (unknownDateCount) warnings.push(`${unknownDateCount} giao dịch thiếu ngày hợp lệ; bộ lọc ngày ở giao diện sẽ xếp vào “Không rõ ngày”.`);
    if (duplicateCount) warnings.push(`${duplicateCount} dòng trùng transactionID đã được gộp; dòng xung đột cần kiểm tra thủ công.`);
    const creditedAmount = incoming.reduce((sum, item) => sum + item.creditedAmount, 0);
    const unmatched = items.filter((item) => item.status === 'UNMATCHED').length;
    const ambiguous = items.filter((item) => ['AMBIGUOUS', 'DUPLICATE'].includes(item.status)).length;
    const uncredited = incoming.filter((item) => item.creditedAmount === 0).length;
    return {
      bank: { id: bank.id, label: bank.label, provider: bank.provider, bankId: bank.bankId,
        accountNo: maskAccountNo(bank.accountNo), accountNoLast4: bank.accountNo.slice(-4) },
      fetchedAt,
      coverage: { source: 'provider_recent_history', rawCount: snapshot.rawCount, validCount: snapshot.validCount,
        discardedCount: snapshot.discardedCount, truncated: snapshot.truncated, unknownDateCount, duplicateCount, warnings },
      summary: { incomingCount: incoming.length, incomingAmount: incoming.reduce((sum, item) => sum + item.amount, 0),
        outgoingCount: outgoing.length, outgoingAmount: outgoing.reduce((sum, item) => sum + item.amount, 0),
        creditedAmount, difference: incoming.reduce((sum, item) => sum + item.difference, 0),
        matchedCount: statusCounts.MATCHED ?? 0, uncreditedCount: uncredited,
        mismatchCount: statusCounts.AMOUNT_MISMATCH ?? 0, ambiguousCount: ambiguous, unmatchedCount: unmatched,
        rejectedReceivedCount: rejected.length, rejectedReceivedAmount: rejected.reduce((sum, item) => sum + item.amount, 0), statusCounts },
      items,
    };
  }
}

function deduplicateTransactions(transactions: BankTransaction[]) {
  const byKey = new Map<string, WorkingTransaction>();
  const byId = new Map<string, WorkingTransaction[]>();
  for (const transaction of transactions) {
    const type = normalizeType(transaction.type);
    const transactionId = String(transaction.transactionID).trim();
    const key = `${type}:${transactionId}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.duplicateCount += 1;
      if (!sameTransaction(existing.transaction, transaction)) existing.duplicateConflict = true;
      continue;
    }
    const entry: WorkingTransaction = { transaction, duplicateCount: 0, duplicateConflict: false, notes: [] };
    byKey.set(key, entry);
    const siblings = byId.get(transactionId) ?? [];
    if (siblings.length) {
      for (const sibling of siblings) sibling.duplicateConflict = true;
      entry.duplicateConflict = true;
    }
    siblings.push(entry); byId.set(transactionId, siblings);
  }
  return [...byKey.values()];
}

function sameTransaction(left: BankTransaction, right: BankTransaction) {
  return integerAmount(left.amount) === integerAmount(right.amount) && normalizeType(left.type) === normalizeType(right.type)
    && String(left.description ?? '') === String(right.description ?? '')
    && String(left.transactionDate ?? '') === String(right.transactionDate ?? '');
}

function normalizeType(value: unknown): 'IN' | 'OUT' { return String(value ?? 'IN').toUpperCase() === 'OUT' ? 'OUT' : 'IN'; }
function integerAmount(value: unknown) {
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount > 0 && amount <= MAX_AMOUNT ? amount : 0;
}
function scopedBankReference(bankConfigId: string, transactionId: string) { return `bank:${bankConfigId}:${transactionId}`; }
function unique(values: string[]) { return [...new Set(values.filter(Boolean))]; }
function bankConfigIdFrom(request: { metadata?: Record<string, unknown> }) {
  const value = request.metadata?.bankConfigId;
  return typeof value === 'string' && value ? value : undefined;
}
function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function maskAccountNo(value: string) {
  const account = value.trim();
  return account.length <= 4 ? account : `${'•'.repeat(Math.max(4, account.length - 4))}${account.slice(-4)}`;
}
function parseTransactionDate(value?: string): { transactionDate?: string; transactionAt?: string } {
  const input = String(value ?? '').trim();
  if (!input) return {};
  let date: Date | undefined;
  const vietnamese = input.match(/^(\d{2})[\/-](\d{2})[\/-](\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (vietnamese) date = new Date(Date.UTC(Number(vietnamese[3]), Number(vietnamese[2]) - 1, Number(vietnamese[1]),
    Number(vietnamese[4] ?? 0), Number(vietnamese[5] ?? 0), Number(vietnamese[6] ?? 0)));
  else { const parsed = Date.parse(input); if (!Number.isNaN(parsed)) date = new Date(parsed); }
  if (!date || Number.isNaN(date.getTime())) return { transactionDate: input };
  return { transactionDate: input, transactionAt: date.toISOString() };
}
