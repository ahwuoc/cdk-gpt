import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { FilterQuery, Model, PipelineStage, Types as MongooseTypes } from 'mongoose';
import {
  AuditLog, InventoryItem, Order, PaymentRequest, Product, User, WalletTransaction,
} from '@store/database';
import {
  DeliveryStatus, InventoryStatus, OrderStatus, PaymentRequestStatus, ProductStatus,
} from '@store/shared';
import { AuditHistoryQueryDto, DepositHistoryQueryDto, OrderHistoryQueryDto, UserHistoryQueryDto, WalletHistoryQueryDto } from './analytics.dto';
import { ReportCache } from './report-cache';

const RECENT_ACTIVITY_LIMIT = 8;
const VIETNAM_UTC_OFFSET_MS = 7 * 60 * 60 * 1_000;

interface JoinedUser {
  _id: MongooseTypes.ObjectId;
  displayName?: string;
  username?: string;
  telegramId?: string;
}

interface JoinedProduct {
  _id: MongooseTypes.ObjectId;
  name?: string;
  slug?: string;
}

interface OrderHistoryRecord {
  _id: MongooseTypes.ObjectId;
  orderCode: string;
  quantity: number;
  unitPrice: number;
  totalAmount: number;
  status: string;
  paymentMethod: string;
  deliveryStatus: string;
  deliveredAt?: Date;
  failureReason?: string;
  createdAt: Date;
  user?: JoinedUser | null;
  product?: JoinedProduct | null;
}

interface DepositHistoryRecord {
  _id: MongooseTypes.ObjectId;
  requestCode: string;
  amount: number;
  provider: string;
  providerReference?: string;
  status: string;
  rejectionReason?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  reviewedAt?: Date;
  user?: JoinedUser | null;
}

interface UserHistoryRecord extends User { _id: MongooseTypes.ObjectId; }

interface WalletHistoryRecord extends WalletTransaction {
  _id: MongooseTypes.ObjectId;
  user?: JoinedUser | null;
}

interface JoinedAdmin {
  _id: MongooseTypes.ObjectId;
  username?: string;
  email?: string;
}

interface AuditHistoryRecord extends AuditLog {
  _id: MongooseTypes.ObjectId;
  adminActor?: JoinedAdmin | null;
  userActor?: JoinedUser | null;
}

interface FacetResult<T> {
  items: T[];
  meta: Array<{ total: number }>;
}

interface AmountResult { amount: number; }
interface CountResult { total: number; }

@Injectable()
export class AnalyticsService {
  private readonly summaryCache = new ReportCache<Awaited<ReturnType<AnalyticsService['loadSummary']>>>();

  constructor(
    @InjectModel('Order') private readonly orderModel: Model<Order>,
    @InjectModel('PaymentRequest') private readonly paymentRequestModel: Model<PaymentRequest>,
    @InjectModel('User') private readonly userModel: Model<User>,
    @InjectModel('Product') private readonly productModel: Model<Product>,
    @InjectModel('InventoryItem') private readonly inventoryModel: Model<InventoryItem>,
    @InjectModel('WalletTransaction') private readonly walletTransactionModel: Model<WalletTransaction>,
    @InjectModel('AuditLog') private readonly auditLogModel: Model<AuditLog>,
  ) {}

  summary(refresh = false) {
    return this.summaryCache.get(startOfVietnamDay().toISOString(), () => this.loadSummary(), refresh);
  }

  private async loadSummary() {
    const todayStart = startOfVietnamDay();
    const delivered = { status: OrderStatus.DELIVERED } satisfies FilterQuery<Order>;
    const approved = { status: PaymentRequestStatus.APPROVED, deletedAt: null } satisfies FilterQuery<PaymentRequest>;

    const [
      orderTotal, orderToday, orderCompleted, orderPendingDelivery,
      revenueTotal, revenueToday,
      depositTotal, depositToday, depositPending,
      userTotal, userNewToday,
      inventoryAvailable, inventoryLowStock,
      recentOrders, recentDeposits,
    ] = await Promise.all([
      this.orderModel.countDocuments({}).hint('_id_'),
      this.orderModel.countDocuments({ createdAt: { $gte: todayStart } }),
      this.orderModel.countDocuments(delivered),
      this.orderModel.countDocuments({ status: { $in: [OrderStatus.PENDING_DELIVERY, OrderStatus.DELIVERING] } }),
      this.sumOrderAmounts(delivered),
      this.sumOrderAmounts({ ...delivered, deliveredAt: { $gte: todayStart } }),
      this.sumDepositAmounts(approved),
      this.sumDepositAmounts({ ...approved, reviewedAt: { $gte: todayStart } }),
      this.paymentRequestModel.countDocuments({ status: PaymentRequestStatus.PENDING, deletedAt: null }),
      this.userModel.countDocuments({ deletedAt: null }),
      this.userModel.countDocuments({ deletedAt: null, createdAt: { $gte: todayStart } }),
      this.inventoryModel.countDocuments({ status: InventoryStatus.AVAILABLE, deletedAt: null }),
      this.countLowStockProducts(),
      this.orders({ page: 1, limit: RECENT_ACTIVITY_LIMIT }),
      this.deposits({ page: 1, limit: RECENT_ACTIVITY_LIMIT }),
    ]);

    return {
      generatedAt: new Date().toISOString(),
      timezone: 'Asia/Ho_Chi_Minh',
      orders: {
        total: orderTotal,
        today: orderToday,
        completed: orderCompleted,
        pendingDelivery: orderPendingDelivery,
      },
      revenue: { total: revenueTotal, today: revenueToday },
      deposits: { total: depositTotal, today: depositToday, pending: depositPending },
      users: { total: userTotal, newToday: userNewToday },
      inventory: { available: inventoryAvailable, lowStock: inventoryLowStock },
      recentOrders: recentOrders.items,
      recentDeposits: recentDeposits.items,
    };
  }

  async orders(query: OrderHistoryQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const match: FilterQuery<Order> = {};
    if (query.userId) match.userId = new Types.ObjectId(query.userId);
    if (query.productId) match.productId = new Types.ObjectId(query.productId);
    if (query.status) match.status = query.status;
    if (query.deliveryStatus) match.deliveryStatus = query.deliveryStatus;
    this.addCreatedAtRange(match, query.from, query.to);

    const regex = searchRegex(query.search);
    const usernameRegex = usernameSearchRegex(query.search) ?? regex;
    const { items, total } = await this.historyPage<Order, OrderHistoryRecord>(this.orderModel, match,
      orderJoinStages(), page, limit, regex ? { $or: [
        { orderCode: regex }, { 'user.displayName': regex }, { 'user.username': usernameRegex }, { 'user.telegramId': regex },
        { 'product.name': regex }, { 'product.slug': regex },
      ] } : undefined);
    return {
      items: items.map((order) => toOrderHistoryItem(order)),
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    };
  }

  async orderDetail(id: string) {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Invalid order id');
    const order = await this.orderModel.findById(id).lean().exec();
    if (!order) throw new NotFoundException('Order not found');

    const [user, product, inventory, walletTransaction] = await Promise.all([
      this.userModel.findById(order.userId).select('telegramId username displayName status walletBalance purchaseCount createdAt').lean().exec(),
      this.productModel.findById(order.productId).select('name slug description instructions warrantyPolicy warrantyDays price status').lean().exec(),
      this.inventoryModel.findById(order.inventoryItemId)
        .select('status maskedPreview importBatchId reservedAt reservationExpiresAt soldAt createdAt updatedAt').lean().exec(),
      order.walletTransactionId
        ? this.walletTransactionModel.findById(order.walletTransactionId).lean().exec()
        : this.walletTransactionModel.findOne({ referenceType: 'ORDER', referenceId: order._id }).lean().exec(),
    ]);

    return {
      id: order._id.toString(), orderCode: order.orderCode, quantity: order.quantity,
      unitPrice: order.unitPrice, totalAmount: order.totalAmount, status: order.status,
      paymentMethod: order.paymentMethod, deliveryStatus: order.deliveryStatus,
      failureReason: order.failureReason ?? null, createdAt: order.createdAt, updatedAt: order.updatedAt,
      deliveredAt: order.deliveredAt ?? null,
      user: user ? {
        id: user._id.toString(), telegramId: user.telegramId, username: user.username ?? null,
        displayName: user.displayName ?? null, status: user.status, walletBalance: user.walletBalance,
        purchaseCount: user.purchaseCount, createdAt: user.createdAt,
      } : null,
      product: product ? {
        id: product._id.toString(), name: product.name, slug: product.slug, description: product.description,
        price: product.price, status: product.status, instructions: product.instructions ?? null,
        warrantyPolicy: product.warrantyPolicy ?? null, warrantyDays: product.warrantyDays,
      } : null,
      inventory: inventory ? {
        id: inventory._id.toString(), status: inventory.status, maskedPreview: inventory.maskedPreview,
        importBatchId: inventory.importBatchId?.toString() ?? null, reservedAt: inventory.reservedAt ?? null,
        reservationExpiresAt: inventory.reservationExpiresAt ?? null, soldAt: inventory.soldAt ?? null,
        createdAt: inventory.createdAt, updatedAt: inventory.updatedAt,
      } : null,
      walletTransaction: walletTransaction ? {
        id: walletTransaction._id.toString(), amount: walletTransaction.amount,
        balanceBefore: walletTransaction.balanceBefore, balanceAfter: walletTransaction.balanceAfter,
        type: walletTransaction.type, reason: walletTransaction.reason, referenceType: walletTransaction.referenceType,
        referenceId: walletTransaction.referenceId?.toString() ?? null, actorType: walletTransaction.actorType,
        createdAt: walletTransaction.createdAt,
      } : null,
    };
  }

  async deposits(query: DepositHistoryQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const match: FilterQuery<PaymentRequest> = { deletedAt: null };
    if (query.userId) match.userId = new Types.ObjectId(query.userId);
    if (query.status) match.status = query.status;
    if (query.provider) match.provider = query.provider.trim();
    this.addCreatedAtRange(match, query.from, query.to);

    const regex = searchRegex(query.search);
    const usernameRegex = usernameSearchRegex(query.search) ?? regex;
    const { items, total } = await this.historyPage<PaymentRequest, DepositHistoryRecord>(this.paymentRequestModel,
      match, userJoinStages(), page, limit, regex ? { $or: [
        { requestCode: regex }, { provider: regex }, { providerReference: regex },
        { 'user.displayName': regex }, { 'user.username': usernameRegex }, { 'user.telegramId': regex },
      ] } : undefined);
    return {
      items: items.map((deposit) => toDepositHistoryItem(deposit)),
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    };
  }

  async users(query: UserHistoryQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const match: FilterQuery<User> = { deletedAt: null };
    if (query.status) match.status = query.status;
    this.addCreatedAtRange(match, query.from, query.to);
    const regex = searchRegex(query.search);
    const usernameRegex = usernameSearchRegex(query.search) ?? regex;
    if (regex) Object.assign(match, { $or: [
      { telegramId: regex }, { username: usernameRegex }, { displayName: regex }, { referralCode: regex },
    ] });
    const { items, total } = await this.historyPage<User, UserHistoryRecord>(this.userModel, match, [], page, limit);
    return {
      items: items.map((user) => ({
        id: user._id.toString(), telegramId: user.telegramId, username: user.username ?? null,
        displayName: user.displayName ?? null, status: user.status, walletBalance: user.walletBalance,
        referralCode: user.referralCode, purchaseCount: user.purchaseCount, createdAt: user.createdAt, updatedAt: user.updatedAt,
      })),
      page, limit, total, totalPages: Math.ceil(total / limit),
    };
  }

  async walletTransactions(query: WalletHistoryQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const match: FilterQuery<WalletTransaction> = {};
    if (query.userId) match.userId = new Types.ObjectId(query.userId);
    if (query.type) match.type = query.type;
    if (query.actorType) match.actorType = query.actorType;
    this.addCreatedAtRange(match, query.from, query.to);
    const regex = searchRegex(query.search);
    const usernameRegex = usernameSearchRegex(query.search) ?? regex;
    const { items, total } = await this.historyPage<WalletTransaction, WalletHistoryRecord>(this.walletTransactionModel,
      match, userJoinStages(), page, limit, regex ? { $or: [
        { reason: regex }, { idempotencyKey: regex }, { referenceType: regex },
        { 'user.displayName': regex }, { 'user.username': usernameRegex }, { 'user.telegramId': regex },
      ] } : undefined);
    return {
      items: items.map((entry) => ({
        id: entry._id.toString(), amount: entry.amount, balanceBefore: entry.balanceBefore, balanceAfter: entry.balanceAfter,
        type: entry.type, reason: entry.reason, referenceType: entry.referenceType,
        referenceId: entry.referenceId?.toString() ?? null, idempotencyKey: entry.idempotencyKey,
        actorType: entry.actorType, actorId: entry.actorId?.toString() ?? null, createdAt: entry.createdAt,
        user: toUserIdentifier(entry.user),
      })),
      page, limit, total, totalPages: Math.ceil(total / limit),
    };
  }

  async auditLogs(query: AuditHistoryQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const match: FilterQuery<AuditLog> = {};
    if (query.actorType) match.actorType = query.actorType;
    if (query.action) match.action = query.action.trim();
    if (query.resourceType) match.resourceType = query.resourceType.trim();
    if (query.requestId) match.requestId = query.requestId.trim();
    this.addCreatedAtRange(match, query.from, query.to);
    const regex = searchRegex(query.search);
    const usernameRegex = usernameSearchRegex(query.search) ?? regex;
    const { items, total } = await this.historyPage<AuditLog, AuditHistoryRecord>(this.auditLogModel,
      match, auditActorJoinStages(), page, limit, regex ? { $or: [
        { action: regex }, { resourceType: regex }, { requestId: regex },
        { 'adminActor.username': usernameRegex }, { 'adminActor.email': regex },
        { 'userActor.displayName': regex }, { 'userActor.username': usernameRegex }, { 'userActor.telegramId': regex },
      ] } : undefined);
    return {
      items: items.map((entry) => ({
        id: entry._id.toString(), actorType: entry.actorType, action: entry.action,
        resourceType: entry.resourceType, resourceId: entry.resourceId?.toString() ?? null,
        requestId: entry.requestId ?? null, createdAt: entry.createdAt,
        actor: auditActor(entry), changes: redactSensitive(entry.changes), metadata: redactSensitive(entry.metadata),
      })),
      page, limit, total, totalPages: Math.ceil(total / limit),
    };
  }

  private async historyPage<T, Row>(model: Model<T>, match: FilterQuery<T>, joins: PipelineStage.FacetPipelineStage[],
    page: number, limit: number, joinedSearch?: Record<string, unknown>): Promise<{ items: Row[]; total: number }> {
    const pipeline: PipelineStage[] = [];
    if (Object.keys(match).length) pipeline.push({ $match: match });
    const pagination: PipelineStage.FacetPipelineStage[] = [
      { $sort: { createdAt: -1, _id: -1 } }, { $skip: (page - 1) * limit }, { $limit: limit },
    ];
    if (joinedSearch) {
      const [result] = await model.aggregate<FacetResult<Row>>([
        ...pipeline, ...joins, { $match: joinedSearch },
        { $facet: { items: pagination, meta: [{ $count: 'total' }] } },
      ]).exec();
      return { items: result?.items ?? [], total: result?.meta[0]?.total ?? 0 };
    }
    // Keep sort/limit at the collection cursor so an index can serve just this page.
    // A first-stage $facet would scan every record even when only eight recent rows are requested.
    const count = model.countDocuments(match);
    if (!Object.keys(match).length) count.hint('_id_');
    const [items, total] = await Promise.all([
      model.aggregate<Row>([...pipeline, ...pagination, ...joins]).exec(), count.exec(),
    ]);
    return { items, total };
  }

  private addCreatedAtRange<T>(match: FilterQuery<T>, from?: string, to?: string) {
    const start = from ? queryDateBoundary(from, false) : undefined;
    const end = to ? queryDateBoundary(to, true) : undefined;
    if (start && end && start > end) throw new BadRequestException('The from date must be before the to date');
    if (start || end) Object.assign(match, {
      createdAt: { ...(start ? { $gte: start } : {}), ...(end ? { $lte: end } : {}) },
    });
  }

  private async sumOrderAmounts(match: FilterQuery<Order>) {
    const [result] = await this.orderModel.aggregate<AmountResult>([
      { $match: match }, { $group: { _id: null, amount: { $sum: '$totalAmount' } } },
    ]).exec();
    return result?.amount ?? 0;
  }

  private async sumDepositAmounts(match: FilterQuery<PaymentRequest>) {
    const [result] = await this.paymentRequestModel.aggregate<AmountResult>([
      { $match: match }, { $group: { _id: null, amount: { $sum: '$amount' } } },
    ]).exec();
    return result?.amount ?? 0;
  }

  private async countLowStockProducts() {
    const [result] = await this.productModel.aggregate<CountResult>([
      { $match: { status: ProductStatus.ACTIVE, deletedAt: null } },
      { $lookup: {
        from: 'inventory_items',
        let: { productId: '$_id' },
        pipeline: [
          { $match: { $expr: { $and: [
            { $eq: ['$productId', '$$productId'] },
            { $eq: ['$status', InventoryStatus.AVAILABLE] },
            { $eq: ['$deletedAt', null] },
          ] } } },
          { $count: 'available' },
        ],
        as: 'stock',
      } },
      { $set: { availableStock: { $ifNull: [{ $arrayElemAt: ['$stock.available', 0] }, 0] } } },
      { $match: { $expr: { $lte: ['$availableStock', '$lowStockThreshold'] } } },
      { $count: 'total' },
    ]).exec();
    return result?.total ?? 0;
  }
}

function userJoinStages(): PipelineStage.FacetPipelineStage[] {
  return [
    { $lookup: { from: 'users', localField: 'userId', foreignField: '_id', as: 'user' } },
    { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
  ];
}

function orderJoinStages(): PipelineStage.FacetPipelineStage[] {
  return [
    ...userJoinStages(),
    { $lookup: { from: 'products', localField: 'productId', foreignField: '_id', as: 'product' } },
    { $unwind: { path: '$product', preserveNullAndEmptyArrays: true } },
  ];
}

function auditActorJoinStages(): PipelineStage.FacetPipelineStage[] {
  return [
    { $lookup: { from: 'admins', localField: 'actorId', foreignField: '_id', as: 'adminActor' } },
    { $unwind: { path: '$adminActor', preserveNullAndEmptyArrays: true } },
    { $lookup: { from: 'users', localField: 'actorId', foreignField: '_id', as: 'userActor' } },
    { $unwind: { path: '$userActor', preserveNullAndEmptyArrays: true } },
  ];
}

function toOrderHistoryItem(order: OrderHistoryRecord) {
  return {
    id: order._id.toString(),
    orderCode: order.orderCode,
    quantity: order.quantity,
    unitPrice: order.unitPrice,
    totalAmount: order.totalAmount,
    status: order.status,
    paymentMethod: order.paymentMethod,
    deliveryStatus: order.deliveryStatus,
    deliveredAt: order.deliveredAt ?? null,
    failureReason: order.failureReason ?? null,
    createdAt: order.createdAt,
    user: toUserIdentifier(order.user),
    product: toProductIdentifier(order.product),
  };
}

function toDepositHistoryItem(deposit: DepositHistoryRecord) {
  return {
    id: deposit._id.toString(),
    requestCode: deposit.requestCode,
    amount: deposit.amount,
    provider: deposit.provider,
    providerReference: deposit.providerReference ?? null,
    status: deposit.status,
    transferContent: transferContent(deposit.metadata),
    rejectionReason: deposit.rejectionReason ?? null,
    createdAt: deposit.createdAt,
    reviewedAt: deposit.reviewedAt ?? null,
    user: toUserIdentifier(deposit.user),
  };
}

function toUserIdentifier(user?: JoinedUser | null) {
  if (!user) return null;
  return {
    id: user._id.toString(),
    displayName: user.displayName ?? null,
    username: user.username ?? null,
    telegramId: user.telegramId ?? null,
  };
}

function toProductIdentifier(product?: JoinedProduct | null) {
  if (!product) return null;
  return { id: product._id.toString(), name: product.name ?? null, slug: product.slug ?? null };
}

function auditActor(entry: AuditHistoryRecord) {
  if (entry.adminActor) return { id: entry.adminActor._id.toString(),
    name: entry.adminActor.username ?? entry.adminActor.email ?? 'Admin', kind: 'ADMIN' };
  if (entry.userActor) return { id: entry.userActor._id.toString(),
    name: entry.userActor.displayName ?? entry.userActor.username ?? entry.userActor.telegramId ?? 'User', kind: 'USER' };
  return entry.actorId ? { id: entry.actorId.toString(), name: entry.actorType, kind: entry.actorType } : null;
}

function redactSensitive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitive);
  if (!value || typeof value !== 'object') return value ?? null;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [
    key, /token|secret|password|passphrase|payload|encrypted|authorization|cookie|signature|credential|api[-_]?key|private[-_]?key|email|login/i.test(key)
      ? '[REDACTED]' : redactSensitive(item),
  ]));
}

function transferContent(metadata?: Record<string, unknown>) {
  const value = metadata?.transferContent;
  return typeof value === 'string' ? value : null;
}

function searchRegex(search?: string) {
  const value = search?.trim();
  return value ? new RegExp(escapeRegex(value), 'i') : undefined;
}

/** Telegram stores usernames without the leading @, while admins naturally
 * paste handles as @username into search fields. */
function usernameSearchRegex(search?: string) {
  const value = search?.trim();
  if (!value?.startsWith('@')) return searchRegex(search);
  const username = value.slice(1).trim();
  return username ? new RegExp(escapeRegex(username), 'i') : undefined;
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function startOfVietnamDay(now = new Date()) {
  const vietnamClock = new Date(now.getTime() + VIETNAM_UTC_OFFSET_MS);
  return new Date(Date.UTC(vietnamClock.getUTCFullYear(), vietnamClock.getUTCMonth(), vietnamClock.getUTCDate()) - VIETNAM_UTC_OFFSET_MS);
}

function queryDateBoundary(value: string, isEnd: boolean) {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const parsed = new Date(dateOnly
    ? `${value}T${isEnd ? '23:59:59.999' : '00:00:00.000'}+07:00`
    : value);
  if (Number.isNaN(parsed.getTime())) throw new BadRequestException('Invalid date filter');
  return parsed;
}
