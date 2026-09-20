import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHash } from 'node:crypto';
import { Types } from 'mongoose';
import type { Model, PipelineStage } from 'mongoose';
import { WalletReferenceType, type Order, type PaymentRequest, type Product, type User, type WalletTransaction } from '@store/database';
import { OrderStatus, PaymentRequestStatus, UserStatus, WalletTransactionType, isMongoDuplicateKey } from '@store/shared';
import { CustomerEventType } from '../../../../packages/database/src/schemas/customer-event.schema';
import type { CustomerEvent } from '../../../../packages/database/src/schemas/customer-event.schema';
import type { AnalyticsInsightsQueryDto, RecordCustomerEventDto } from './insights.dto';

const DAY_MS = 86_400_000;
const UTC_OFFSET_MS = 7 * 60 * 60 * 1_000;
const TIMEZONE = 'Asia/Ho_Chi_Minh';
const TOP_LIMIT = 20;
const AGGREGATION_OPTIONS = { maxTimeMS: 20_000, allowDiskUse: true };

export interface InsightsDateRange {
  from: string; to: string; days: number; start: Date; end: Date;
}

/** Both endpoints are inclusive calendar dates in Vietnam, never browser/server-local midnight. */
export function insightsDateRange(query: AnalyticsInsightsQueryDto, now = new Date()): InsightsDateRange {
  const to = query.to ?? new Date(now.getTime() + UTC_OFFSET_MS).toISOString().slice(0, 10);
  const endDay = parseDay(to);
  const from = query.from ?? new Date(endDay.getTime() - 29 * DAY_MS).toISOString().slice(0, 10);
  const startDay = parseDay(from);
  const days = (endDay.getTime() - startDay.getTime()) / DAY_MS + 1;
  if (days < 1 || days > 366) throw new BadRequestException('Chọn khoảng ngày từ 1 đến 366 ngày, ngày bắt đầu không sau ngày kết thúc.');
  return { from, to, days, start: new Date(startDay.getTime() - UTC_OFFSET_MS),
    end: new Date(endDay.getTime() + DAY_MS - UTC_OFFSET_MS) };
}

function parseDay(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException('Ngày phải có định dạng YYYY-MM-DD.');
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new BadRequestException('Ngày không hợp lệ.');
  }
  return date;
}

interface Amounts { net: number; gross: number; discount: number; orderCount: number; quantity: number; purchaseCount: number; }
interface RevenueSummary extends Amounts { buyers: number; repeatBuyers: number; returningBuyers: number; }
interface TimelineRow extends Amounts { _id: string; }
interface CustomerRow extends Amounts {
  _id: Types.ObjectId; lastPurchaseAt: Date;
  customer?: { telegramId?: string; username?: string; displayName?: string };
}
interface ProductRow {
  _id: Types.ObjectId; revenue: number; quantity: number; purchaseCount: number; buyers: number;
  product?: { name?: string; slug?: string };
}
interface SalesFacet { summary: RevenueSummary[]; timeline: TimelineRow[]; customers: CustomerRow[]; products: ProductRow[]; }
interface BehaviorSummary {
  users: number; events: number; productViewers: number; checkoutStarters: number;
  viewerBuyers: number; checkoutBuyers: number; usersWithPurchase: number;
}

const EMPTY_AMOUNTS: Amounts = { net: 0, gross: 0, discount: 0, orderCount: 0, quantity: 0, purchaseCount: 0 };

@Injectable()
export class AnalyticsInsightsService {
  constructor(
    @InjectModel('Order') private readonly orders: Model<Order>,
    @InjectModel('PaymentRequest') private readonly payments: Model<PaymentRequest>,
    @InjectModel('User') private readonly users: Model<User>,
    @InjectModel('Product') private readonly products: Model<Product>,
    @InjectModel('CustomerEvent') private readonly events: Model<CustomerEvent>,
    @InjectModel('WalletTransaction') private readonly walletTransactions: Model<WalletTransaction>,
  ) {}

  async recordEvent(input: RecordCustomerEventDto) {
    if (!Object.values(CustomerEventType).includes(input.type) || !/^\d{1,20}$/.test(input.telegramId)
      || !Number.isSafeInteger(input.updateId) || input.updateId < 0
      || (input.type !== CustomerEventType.MENU_VIEW && !input.productId)
      || (input.productId !== undefined && !Types.ObjectId.isValid(input.productId))) {
      throw new BadRequestException('Invalid customer event');
    }
    const user = await this.users.findOne({ telegramId: input.telegramId, deletedAt: null, status: UserStatus.ACTIVE })
      .select('_id').lean().exec();
    if (!user) throw new NotFoundException('Customer not found');
    if (input.productId && !await this.products.exists({ _id: new Types.ObjectId(input.productId), deletedAt: null })) {
      throw new NotFoundException('Product not found');
    }
    // The built-in unique _id makes webhook retries idempotent even before indexes are deployed.
    const id = new Types.ObjectId(createHash('sha256')
      .update(`${input.telegramId}:${input.updateId}:${input.type}`).digest('hex').slice(0, 24));
    try {
      const result = await this.events.updateOne({ _id: id }, { $setOnInsert: {
        userId: user._id, type: input.type, updateId: input.updateId,
        ...(input.productId ? { productId: new Types.ObjectId(input.productId) } : {}), createdAt: new Date(),
      } }, { upsert: true, runValidators: true }).exec();
      return { recorded: result.upsertedCount === 1 };
    } catch (error) {
      if (isMongoDuplicateKey(error)) return { recorded: false };
      throw error;
    }
  }

  async insights(query: AnalyticsInsightsQueryDto) {
    const now = new Date();
    const range = insightsDateRange(query, now);
    const [salesResults, deposits, abandoned, behaviorRows, newCustomers, collectionStart] = await Promise.all([
      this.orders.aggregate<SalesFacet>(salesPipeline(range)).option(AGGREGATION_OPTIONS).exec(),
      this.walletTransactions.aggregate<{ amount: number; count: number }>([
        // A request is an intention, not received money: partial/extra transfers
        // have their actual credited amount and timestamp only in the ledger.
        { $match: { type: WalletTransactionType.DEPOSIT, referenceType: WalletReferenceType.PAYMENT_REQUEST,
          amount: { $gt: 0 }, createdAt: { $gte: range.start, $lt: range.end } } },
        { $lookup: { from: 'payment_requests', localField: 'referenceId', foreignField: '_id',
          pipeline: [{ $match: { 'metadata.quickCheckout': { $exists: false } } }, { $project: { _id: 1 } }], as: 'depositRequest' } },
        { $match: { 'depositRequest.0': { $exists: true } } },
        { $group: { _id: null, amount: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]).option(AGGREGATION_OPTIONS).exec(),
      this.payments.aggregate<{ amount: number; count: number }>([
        { $match: { deletedAt: null, 'metadata.quickCheckout': { $exists: true },
          createdAt: { $gte: range.start, $lt: range.end },
          $or: [{ status: PaymentRequestStatus.EXPIRED },
            { status: PaymentRequestStatus.PENDING, 'metadata.expiresAt': { $lte: now.toISOString() } }] } },
        { $group: { _id: null, amount: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]).option(AGGREGATION_OPTIONS).exec(),
      this.events.aggregate<BehaviorSummary>(behaviorPipeline(range)).option(AGGREGATION_OPTIONS).exec(),
      this.users.countDocuments({ deletedAt: null, createdAt: { $gte: range.start, $lt: range.end } }).maxTimeMS(20_000).exec(),
      this.events.findOne().sort({ createdAt: 1 }).select('createdAt').lean().maxTimeMS(20_000).exec(),
    ]);
    const sales = salesResults[0];
    const summary = sales?.summary[0] ?? { ...EMPTY_AMOUNTS, buyers: 0, repeatBuyers: 0, returningBuyers: 0 };
    const behavior = behaviorRows[0];
    const timelineByDay = new Map((sales?.timeline ?? []).map((day) => [day._id, day]));
    const timeline = Array.from({ length: range.days }, (_, index) => {
      const date = new Date(range.start.getTime() + UTC_OFFSET_MS + index * DAY_MS).toISOString().slice(0, 10);
      const day = timelineByDay.get(date);
      return { date, net: day?.net ?? 0, gross: day?.gross ?? 0, discount: day?.discount ?? 0,
        purchaseCount: day?.purchaseCount ?? 0, orderCount: day?.orderCount ?? 0, quantity: day?.quantity ?? 0 };
    });
    const productViewers = behavior?.productViewers ?? 0;
    const checkoutStarters = behavior?.checkoutStarters ?? 0;
    const viewerBuyers = behavior?.viewerBuyers ?? 0;
    const checkoutBuyers = behavior?.checkoutBuyers ?? 0;
    return {
      generatedAt: now.toISOString(), timezone: TIMEZONE, range: { from: range.from, to: range.to, days: range.days },
      revenue: { net: summary.net, gross: summary.gross, discount: summary.discount,
        purchaseCount: summary.purchaseCount, orderCount: summary.orderCount, quantity: summary.quantity,
        buyers: summary.buyers, averagePurchaseValue: summary.purchaseCount ? summary.net / summary.purchaseCount : 0 },
      deposits: { amount: deposits[0]?.amount ?? 0, count: deposits[0]?.count ?? 0 },
      timeline,
      topCustomers: (sales?.customers ?? []).map((row, index) => ({
        rank: index + 1, userId: row._id.toString(), telegramId: row.customer?.telegramId ?? null,
        username: row.customer?.username ?? null, displayName: row.customer?.displayName ?? null,
        totalSpent: row.net, purchaseCount: row.purchaseCount, orderCount: row.orderCount,
        quantity: row.quantity, lastPurchaseAt: row.lastPurchaseAt,
      })),
      topProducts: (sales?.products ?? []).map((row) => ({ productId: row._id.toString(),
        name: row.product?.name ?? 'Sản phẩm đã xóa', slug: row.product?.slug ?? null,
        revenue: row.revenue, quantity: row.quantity, purchaseCount: row.purchaseCount, buyers: row.buyers })),
      behavior: {
        newCustomers, activeUsers: (behavior?.users ?? 0) + summary.buyers - (behavior?.usersWithPurchase ?? 0),
        productViewers, checkoutStarters, buyers: summary.buyers, viewerBuyers, checkoutBuyers,
        viewToPurchaseRate: productViewers ? viewerBuyers / productViewers * 100 : null,
        checkoutToPurchaseRate: checkoutStarters ? checkoutBuyers / checkoutStarters * 100 : null,
        repeatBuyers: summary.repeatBuyers, returningBuyers: summary.returningBuyers,
        newBuyers: summary.buyers - summary.returningBuyers,
        abandonedCheckouts: abandoned[0]?.count ?? 0, abandonedCheckoutAmount: abandoned[0]?.amount ?? 0,
        collectionStartedAt: collectionStart?.createdAt ?? null, eventsInRange: behavior?.events ?? 0,
      },
      notes: [
        'Doanh thu là tiền thực thu của đơn đang ở trạng thái đã giao, theo ngày giao; loại đơn hủy, hoàn tiền và chưa giao. Đơn cũ thiếu ngày giao dùng ngày tạo.',
        'Một lượt mua gộp các tài khoản cùng phiếu thanh toán QR; đơn ví hoặc dữ liệu cũ không có mã nhóm được tính riêng. Giá trị trung bình = doanh thu / lượt mua, không phải / số tài khoản.',
        'Tiền nạp ví là khoản DEPOSIT thực ghi sổ theo ngày ghi sổ, gồm chuyển thiếu/chuyển bổ sung; số lượt là số giao dịch ghi có, không phải số phiếu. Không cộng vào doanh thu, không gồm QR mua sản phẩm hay phiếu chưa có giao dịch ghi sổ; phiếu đã lưu trữ vẫn giữ lịch sử tiền thực nhận.',
        'Xem sản phẩm và bắt đầu thanh toán chỉ có dữ liệu từ khi bật thu thập. Tỷ lệ chuyển đổi là khách có đơn đã giao sau hành vi trong cùng kỳ / khách có hành vi; không suy diễn lịch sử chưa được ghi.',
        'Khách hoạt động gồm khách có hành vi được ghi hoặc có đơn đã giao trong kỳ. Khách mua lặp có từ 2 lượt mua trong kỳ; khách quay lại đã có đơn giao trước kỳ.',
        'QR bỏ dở là yêu cầu mua sản phẩm tạo trong kỳ, chưa được thanh toán và đã hết hạn; không gồm QR vẫn còn hạn hoặc nạp ví.',
        'Nếu một lượt QR được giao ở nhiều ngày, lượt mua xuất hiện ở từng ngày có giao; tổng lượt mua của kỳ chỉ đếm một lần.',
      ],
    };
  }
}

/** Indexed branches retain legacy delivered orders without manufacturing delivery timestamps. */
function deliveredPeriod(range: InsightsDateRange): PipelineStage.Match['$match'] {
  return { status: OrderStatus.DELIVERED, $or: [
    { deliveredAt: { $gte: range.start, $lt: range.end } },
    { deliveredAt: null, createdAt: { $gte: range.start, $lt: range.end } },
  ] };
}

const purchaseGroup = { $ifNull: ['$metadata.paymentRequestId', { $ifNull: ['$metadata.purchaseGroupId', { $toString: '$_id' }] }] };
const deliveredDate = { $ifNull: ['$deliveredAt', '$createdAt'] };
const sumAmounts = {
  net: { $sum: '$net' }, gross: { $sum: '$gross' }, discount: { $sum: '$discount' },
  orderCount: { $sum: '$orderCount' }, quantity: { $sum: '$quantity' },
};

function purchaseTotals(): PipelineStage.Group {
  return { $group: { _id: { user: '$userId', purchase: '$purchase' }, ...sumAmounts,
    lastPurchaseAt: { $max: '$saleDate' } } };
}

function salesPipeline(range: InsightsDateRange): PipelineStage[] {
  return [
    { $match: deliveredPeriod(range) },
    { $project: {
      userId: 1, productId: 1, purchase: purchaseGroup, saleDate: deliveredDate,
      day: { $dateToString: { date: deliveredDate, format: '%Y-%m-%d', timezone: TIMEZONE } },
      net: '$totalAmount', discount: { $ifNull: ['$discountAmount', 0] },
      gross: { $ifNull: ['$grossAmount', { $add: ['$totalAmount', { $ifNull: ['$discountAmount', 0] }] }] },
      orderCount: { $literal: 1 }, quantity: { $ifNull: ['$quantity', 1] },
    } },
    { $facet: {
      summary: [
        purchaseTotals(),
        { $group: { _id: '$_id.user', ...sumAmounts, purchaseCount: { $sum: 1 } } },
        { $lookup: { from: 'orders', let: { buyer: '$_id' }, pipeline: [
          { $match: { status: OrderStatus.DELIVERED, $expr: { $eq: ['$userId', '$$buyer'] },
            $or: [{ deliveredAt: { $lt: range.start } }, { deliveredAt: null, createdAt: { $lt: range.start } }] } },
          { $limit: 1 }, { $project: { _id: 1 } },
        ], as: 'previousPurchase' } },
        { $group: { _id: null, ...sumAmounts, purchaseCount: { $sum: '$purchaseCount' }, buyers: { $sum: 1 },
          repeatBuyers: { $sum: { $cond: [{ $gte: ['$purchaseCount', 2] }, 1, 0] } },
          returningBuyers: { $sum: { $cond: [{ $gt: [{ $size: '$previousPurchase' }, 0] }, 1, 0] } } } },
      ],
      timeline: [
        { $group: { _id: { day: '$day', user: '$userId', purchase: '$purchase' }, ...sumAmounts } },
        { $group: { _id: '$_id.day', ...sumAmounts, purchaseCount: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ],
      customers: [
        purchaseTotals(),
        { $group: { _id: '$_id.user', ...sumAmounts, purchaseCount: { $sum: 1 }, lastPurchaseAt: { $max: '$lastPurchaseAt' } } },
        { $sort: { net: -1, purchaseCount: -1, _id: 1 } }, { $limit: TOP_LIMIT },
        { $lookup: { from: 'users', localField: '_id', foreignField: '_id',
          pipeline: [{ $project: { telegramId: 1, username: 1, displayName: 1 } }], as: 'customer' } },
        { $unwind: { path: '$customer', preserveNullAndEmptyArrays: true } },
      ],
      products: [
        { $group: { _id: { product: '$productId', user: '$userId', purchase: '$purchase' },
          revenue: { $sum: '$net' }, quantity: { $sum: '$quantity' } } },
        { $group: { _id: { product: '$_id.product', user: '$_id.user' },
          revenue: { $sum: '$revenue' }, quantity: { $sum: '$quantity' }, purchaseCount: { $sum: 1 } } },
        { $group: { _id: '$_id.product', revenue: { $sum: '$revenue' }, quantity: { $sum: '$quantity' },
          purchaseCount: { $sum: '$purchaseCount' }, buyers: { $sum: 1 } } },
        { $sort: { revenue: -1, quantity: -1, _id: 1 } }, { $limit: TOP_LIMIT },
        { $lookup: { from: 'products', localField: '_id', foreignField: '_id',
          pipeline: [{ $project: { name: 1, slug: 1 } }], as: 'product' } },
        { $unwind: { path: '$product', preserveNullAndEmptyArrays: true } },
      ],
    } },
  ];
}

function behaviorPipeline(range: InsightsDateRange): PipelineStage[] {
  return [
    { $match: { createdAt: { $gte: range.start, $lt: range.end } } },
    { $group: { _id: '$userId', events: { $sum: 1 },
      firstView: { $min: { $cond: [{ $eq: ['$type', CustomerEventType.PRODUCT_VIEW] }, '$createdAt', range.end] } },
      firstCheckout: { $min: { $cond: [{ $eq: ['$type', CustomerEventType.CHECKOUT_START] }, '$createdAt', range.end] } },
    } },
    { $lookup: { from: 'orders', let: { buyer: '$_id' }, pipeline: [
      { $match: { ...deliveredPeriod(range), $expr: { $eq: ['$userId', '$$buyer'] } } },
      { $group: { _id: null, lastDelivery: { $max: deliveredDate } } },
    ], as: 'purchases' } },
    { $set: { lastDelivery: { $ifNull: [{ $arrayElemAt: ['$purchases.lastDelivery', 0] }, new Date(0)] } } },
    { $group: { _id: null, users: { $sum: 1 }, events: { $sum: '$events' },
      usersWithPurchase: { $sum: { $cond: [{ $gt: [{ $size: '$purchases' }, 0] }, 1, 0] } },
      productViewers: { $sum: { $cond: [{ $lt: ['$firstView', range.end] }, 1, 0] } },
      checkoutStarters: { $sum: { $cond: [{ $lt: ['$firstCheckout', range.end] }, 1, 0] } },
      viewerBuyers: { $sum: { $cond: [{ $and: [{ $lt: ['$firstView', range.end] }, { $gte: ['$lastDelivery', '$firstView'] }] }, 1, 0] } },
      checkoutBuyers: { $sum: { $cond: [{ $and: [{ $lt: ['$firstCheckout', range.end] }, { $gte: ['$lastDelivery', '$firstCheckout'] }] }, 1, 0] } },
    } },
  ];
}
