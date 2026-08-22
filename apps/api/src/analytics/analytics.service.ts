import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { FilterQuery, Model, PipelineStage, Types as MongooseTypes } from 'mongoose';
import {
  InventoryItem, Order, PaymentRequest, Product, User,
} from '@store/database';
import {
  DeliveryStatus, InventoryStatus, OrderStatus, PaymentRequestStatus, ProductStatus,
} from '@store/shared';
import { DepositHistoryQueryDto, OrderHistoryQueryDto } from './analytics.dto';

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

interface FacetResult<T> {
  items: T[];
  meta: Array<{ total: number }>;
}

interface AmountResult { amount: number; }
interface CountResult { total: number; }

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectModel('Order') private readonly orderModel: Model<Order>,
    @InjectModel('PaymentRequest') private readonly paymentRequestModel: Model<PaymentRequest>,
    @InjectModel('User') private readonly userModel: Model<User>,
    @InjectModel('Product') private readonly productModel: Model<Product>,
    @InjectModel('InventoryItem') private readonly inventoryModel: Model<InventoryItem>,
  ) {}

  async summary() {
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
      this.orderModel.countDocuments({}),
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

    const pipeline = this.orderJoinPipeline(match, query.search);
    pipeline.push({
      $facet: {
        items: [{ $sort: { createdAt: -1, _id: -1 } }, { $skip: (page - 1) * limit }, { $limit: limit }],
        meta: [{ $count: 'total' }],
      },
    });
    const [result] = await this.orderModel.aggregate<FacetResult<OrderHistoryRecord>>(pipeline).exec();
    const total = result?.meta[0]?.total ?? 0;
    return {
      items: (result?.items ?? []).map((order) => toOrderHistoryItem(order)),
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
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

    const pipeline = this.depositJoinPipeline(match, query.search);
    pipeline.push({
      $facet: {
        items: [{ $sort: { createdAt: -1, _id: -1 } }, { $skip: (page - 1) * limit }, { $limit: limit }],
        meta: [{ $count: 'total' }],
      },
    });
    const [result] = await this.paymentRequestModel.aggregate<FacetResult<DepositHistoryRecord>>(pipeline).exec();
    const total = result?.meta[0]?.total ?? 0;
    return {
      items: (result?.items ?? []).map((deposit) => toDepositHistoryItem(deposit)),
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    };
  }

  private orderJoinPipeline(match: FilterQuery<Order>, search?: string): PipelineStage[] {
    const pipeline: PipelineStage[] = [];
    if (Object.keys(match).length > 0) pipeline.push({ $match: match });
    pipeline.push(
      { $lookup: { from: 'users', localField: 'userId', foreignField: '_id', as: 'user' } },
      { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
      { $lookup: { from: 'products', localField: 'productId', foreignField: '_id', as: 'product' } },
      { $unwind: { path: '$product', preserveNullAndEmptyArrays: true } },
    );
    const regex = searchRegex(search);
    if (regex) {
      pipeline.push({ $match: { $or: [
        { orderCode: regex }, { 'user.displayName': regex }, { 'user.username': regex }, { 'user.telegramId': regex },
        { 'product.name': regex }, { 'product.slug': regex },
      ] } });
    }
    return pipeline;
  }

  private depositJoinPipeline(match: FilterQuery<PaymentRequest>, search?: string): PipelineStage[] {
    const pipeline: PipelineStage[] = [];
    if (Object.keys(match).length > 0) pipeline.push({ $match: match });
    pipeline.push(
      { $lookup: { from: 'users', localField: 'userId', foreignField: '_id', as: 'user' } },
      { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
    );
    const regex = searchRegex(search);
    if (regex) {
      pipeline.push({ $match: { $or: [
        { requestCode: regex }, { provider: regex }, { providerReference: regex },
        { 'user.displayName': regex }, { 'user.username': regex }, { 'user.telegramId': regex },
      ] } });
    }
    return pipeline;
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

function transferContent(metadata?: Record<string, unknown>) {
  const value = metadata?.transferContent;
  return typeof value === 'string' ? value : null;
}

function searchRegex(search?: string) {
  const value = search?.trim();
  return value ? new RegExp(escapeRegex(value), 'i') : undefined;
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
