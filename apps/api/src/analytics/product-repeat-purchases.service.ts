import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model, type PipelineStage } from 'mongoose';
import type { Order } from '@store/database';
import { OrderStatus } from '@store/shared';
import { insightsDateRange, type InsightsDateRange } from './insights.service';
import type { ProductRepeatPurchasesQueryDto } from './product-repeat-purchases.dto';
import { ReportCache } from './report-cache';

const TIMEZONE = 'Asia/Ho_Chi_Minh';
const DAY_MS = 86_400_000;

interface RepeatPurchaseItem {
  userId: string; telegramId: string | null; username: string | null; displayName: string | null;
  productId: string; productName: string; purchaseCount: number; quantity: number; totalSpent: number;
  purchaseDays: string[]; longestStreak: number; streakFrom: string; streakTo: string; lastPurchaseAt: Date;
}

interface RepeatPurchaseFacet {
  summary: Array<{ buyers: number; repeatBuyers: number }>;
  products: Array<{ productId: string; name: string }>;
  items: RepeatPurchaseItem[];
  meta: Array<{ total: number }>;
}

@Injectable()
export class ProductRepeatPurchasesService {
  private readonly reports = new ReportCache<{ result: RepeatPurchaseFacet | undefined; generatedAt: string }>();

  constructor(@InjectModel('Order') private readonly orders: Model<Order>) {}

  async report(query: Partial<ProductRepeatPurchasesQueryDto>, refresh = false) {
    const range = insightsDateRange(query);
    const days = query.days ?? 2;
    const maxDays = query.maxDays ?? null;
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    if (!Number.isSafeInteger(days) || days < 2 || days > 366
      || (maxDays !== null && (!Number.isSafeInteger(maxDays) || maxDays < days || maxDays > 366))
      || !Number.isSafeInteger(page) || page < 1
      || !Number.isSafeInteger(limit) || limit < 1 || limit > 100
      || !Number.isSafeInteger((page - 1) * limit)
      || (query.productId !== undefined && !/^[a-fA-F0-9]{24}$/.test(query.productId))) {
      throw new BadRequestException('Chọn số ngày liên tiếp từ 2 đến 366, số ngày tối đa không nhỏ hơn tối thiểu, sản phẩm và phân trang hợp lệ.');
    }
    const key = JSON.stringify([range.from, range.to, days, maxDays, page, limit, query.productId?.toLowerCase()]);
    const { result, generatedAt } = await this.reports.get(key, async () => {
      const [report] = await this.orders.aggregate<RepeatPurchaseFacet>(repeatPurchasePipeline(
        range, days, maxDays, page, limit, query.productId,
      )).option({ maxTimeMS: 20_000, allowDiskUse: true }).exec();
      return { result: report, generatedAt: new Date().toISOString() };
    }, refresh);
    const summary = result?.summary[0] ?? { buyers: 0, repeatBuyers: 0 };
    const total = result?.meta[0]?.total ?? 0;
    return {
      generatedAt,
      range: { from: range.from, to: range.to, days: range.days }, timezone: TIMEZONE, days, maxDays,
      summary: { buyers: summary.buyers, repeatBuyers: summary.repeatBuyers,
        repeatRate: summary.buyers ? summary.repeatBuyers / summary.buyers * 100 : null },
      products: result?.products ?? [], items: result?.items ?? [],
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }
}

function repeatPurchasePipeline(range: InsightsDateRange, days: number, maxDays: number | null, page: number, limit: number,
  productId?: string): PipelineStage[] {
  const productFilter: PipelineStage.Match[] = productId
    ? [{ $match: { '_id.product': new Types.ObjectId(productId) } }] : [];
  const qualifies = { $and: [
    { $gte: ['$streak.longest', days] },
    ...(maxDays === null ? [] : [{ $lte: ['$streak.longest', maxDays] }]),
  ] };
  const qualified: PipelineStage.Match = { $match: { $expr: qualifies } };
  const delivered = { $eq: ['$status', OrderStatus.DELIVERED] };
  return [
    // Group before the range filter: one checkout can straddle midnight and
    // its deliveries can span days. Include every status in its purchase date
    // so later fulfillment/refunds cannot move the checkout to another day;
    // only successfully delivered units contribute spend or quantity.
    { $group: {
      _id: { user: '$userId', product: '$productId', purchase: {
        $ifNull: ['$metadata.paymentRequestId', { $ifNull: ['$metadata.purchaseGroupId', { $toString: '$_id' }] }],
      } },
      purchasedAt: { $min: '$createdAt' }, deliveredCount: { $sum: { $cond: [delivered, 1, 0] } },
      quantity: { $sum: { $cond: [delivered, { $ifNull: ['$quantity', 1] }, 0] } },
      totalSpent: { $sum: { $cond: [delivered, '$totalAmount', 0] } },
    } },
    { $match: { deliveredCount: { $gt: 0 }, purchasedAt: { $gte: range.start, $lt: range.end } } },
    { $group: {
      _id: { user: '$_id.user', product: '$_id.product', day: {
        $dateToString: { date: '$purchasedAt', format: '%Y-%m-%d', timezone: TIMEZONE },
      } },
      purchaseCount: { $sum: 1 }, quantity: { $sum: '$quantity' }, totalSpent: { $sum: '$totalSpent' },
      lastPurchaseAt: { $max: '$purchasedAt' },
    } },
    { $sort: { '_id.user': 1, '_id.product': 1, '_id.day': 1 } },
    { $group: {
      _id: { user: '$_id.user', product: '$_id.product' }, purchaseDays: { $push: '$_id.day' },
      purchaseCount: { $sum: '$purchaseCount' }, quantity: { $sum: '$quantity' }, totalSpent: { $sum: '$totalSpent' },
      lastPurchaseAt: { $max: '$lastPurchaseAt' },
    } },
    { $set: { streak: { $reduce: {
      input: '$purchaseDays',
      initialValue: { previous: null, current: 0, currentFrom: null, longest: 0, from: null, to: null },
      in: { $let: {
        vars: { consecutive: { $eq: [
          { $subtract: [{ $toDate: '$$this' }, { $toDate: '$$value.previous' }] }, DAY_MS,
        ] } },
        in: { $let: {
          vars: {
            length: { $cond: ['$$consecutive', { $add: ['$$value.current', 1] }, 1] },
            start: { $cond: ['$$consecutive', '$$value.currentFrom', '$$this'] },
          },
          in: {
            previous: '$$this', current: '$$length', currentFrom: '$$start',
            longest: { $max: ['$$value.longest', '$$length'] },
            from: { $cond: [{ $gt: ['$$length', '$$value.longest'] }, '$$start', '$$value.from'] },
            to: { $cond: [{ $gt: ['$$length', '$$value.longest'] }, '$$this', '$$value.to'] },
          },
        } },
      } },
    } } } },
    { $facet: {
      summary: [
        ...productFilter,
        { $group: { _id: '$_id.user', qualified: { $max: { $cond: [qualifies, 1, 0] } } } },
        { $group: { _id: null, buyers: { $sum: 1 }, repeatBuyers: { $sum: '$qualified' } } },
      ],
      products: [
        { $group: { _id: '$_id.product' } },
        { $lookup: { from: 'products', localField: '_id', foreignField: '_id',
          pipeline: [{ $project: { name: 1 } }], as: 'product' } },
        { $unwind: { path: '$product', preserveNullAndEmptyArrays: true } },
        { $project: { _id: 0, productId: { $toString: '$_id' }, name: { $ifNull: ['$product.name', 'Sản phẩm đã xóa'] } } },
        { $sort: { name: 1, productId: 1 } },
      ],
      items: [
        ...productFilter, qualified,
        { $sort: { 'streak.longest': -1, totalSpent: -1, '_id.user': 1, '_id.product': 1 } },
        { $skip: (page - 1) * limit }, { $limit: limit },
        { $lookup: { from: 'users', localField: '_id.user', foreignField: '_id',
          pipeline: [{ $project: { telegramId: 1, username: 1, displayName: 1 } }], as: 'customer' } },
        { $unwind: { path: '$customer', preserveNullAndEmptyArrays: true } },
        { $lookup: { from: 'products', localField: '_id.product', foreignField: '_id',
          pipeline: [{ $project: { name: 1 } }], as: 'product' } },
        { $unwind: { path: '$product', preserveNullAndEmptyArrays: true } },
        { $project: {
          _id: 0, userId: { $toString: '$_id.user' }, productId: { $toString: '$_id.product' },
          telegramId: { $ifNull: ['$customer.telegramId', null] }, username: { $ifNull: ['$customer.username', null] },
          displayName: { $ifNull: ['$customer.displayName', null] }, productName: { $ifNull: ['$product.name', 'Sản phẩm đã xóa'] },
          purchaseCount: 1, quantity: 1, totalSpent: 1, purchaseDays: 1, longestStreak: '$streak.longest',
          streakFrom: '$streak.from', streakTo: '$streak.to', lastPurchaseAt: 1,
        } },
      ],
      meta: [...productFilter, qualified, { $count: 'total' }],
    } },
  ];
}
