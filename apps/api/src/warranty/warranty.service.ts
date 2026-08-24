import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Connection, FilterQuery, Model, PipelineStage, Types as MongooseTypes } from 'mongoose';
import { AuditLog, Order, Product, User, WarrantyRequest, WarrantyStatus } from '@store/database';
import { ComplaintCategory, isMongoDuplicateKey } from '@store/shared';
import type { CreateOrderReportDto, OrderReportQueryDto, UpdateOrderReportDto } from './warranty.dto';
import { WarrantyNotifier, type ReportResolutionNotification } from './warranty.notifier';

const ACTIVE_REPORT_STATUSES = [WarrantyStatus.PENDING, WarrantyStatus.REVIEWING, WarrantyStatus.APPROVED];
const RESOLUTION_NOTE_REQUIRED: Array<typeof WarrantyStatus[keyof typeof WarrantyStatus]> = [
  WarrantyStatus.RESOLVED, WarrantyStatus.REJECTED,
];

interface JoinedOrder extends Order { _id: MongooseTypes.ObjectId; }
interface JoinedUser extends User { _id: MongooseTypes.ObjectId; }
interface JoinedProduct extends Product { _id: MongooseTypes.ObjectId; }
interface ReportRecord extends WarrantyRequest {
  _id: MongooseTypes.ObjectId;
  order?: JoinedOrder | null;
  user?: JoinedUser | null;
  product?: JoinedProduct | null;
}
interface FacetResult { items: ReportRecord[]; meta: Array<{ total: number }>; }

@Injectable()
export class WarrantyService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel('WarrantyRequest') private readonly reports: Model<WarrantyRequest>,
    @InjectModel('Order') private readonly orders: Model<Order>,
    @InjectModel('AuditLog') private readonly audits: Model<AuditLog>,
    private readonly notifier: WarrantyNotifier,
  ) {}

  async create(input: CreateOrderReportDto) {
    if (!Types.ObjectId.isValid(input.userId) || !Types.ObjectId.isValid(input.orderId)) {
      throw new NotFoundException('Order not found');
    }
    if (!Object.values(ComplaintCategory).includes(input.category)) throw new BadRequestException('Invalid report category');
    const description = input.description?.trim();
    if (!description || description.length < 5 || description.length > 2_000) {
      throw new BadRequestException('Description must contain between 5 and 2000 characters');
    }
    const userId = new Types.ObjectId(input.userId);
    const orderId = new Types.ObjectId(input.orderId);
    const order = await this.orders.findOne({ _id: orderId, userId }).lean();
    if (!order) throw new NotFoundException('Order not found');
    const existing = await this.reports.findOne({ orderId, status: { $in: ACTIVE_REPORT_STATUSES } }).lean();
    if (existing) return createResponse(existing, true);

    const reportId = new Types.ObjectId();
    try {
      const report = await this.reports.create({
        _id: reportId,
        requestCode: `REP-${reportId.toString().slice(-10).toUpperCase()}`,
        userId, orderId, inventoryItemId: order.inventoryItemId,
        category: input.category, reason: description, evidenceUrls: [], status: WarrantyStatus.PENDING,
        metadata: { source: 'TELEGRAM' },
      });
      return createResponse(report, false);
    } catch (error) {
      if (!isMongoDuplicateKey(error)) throw error;
      const raced = await this.reports.findOne({ orderId, status: { $in: ACTIVE_REPORT_STATUSES } }).lean();
      if (!raced) throw new ConflictException('An active report already exists for this order');
      return createResponse(raced, true);
    }
  }

  async list(query: OrderReportQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const match: FilterQuery<WarrantyRequest> = {};
    if (query.status) match.status = query.status;
    if (query.category) match.category = query.category;
    if (query.userId) match.userId = new Types.ObjectId(query.userId);
    if (query.orderId) match.orderId = new Types.ObjectId(query.orderId);
    addDateRange(match, query.from, query.to);

    const pipeline: PipelineStage[] = [];
    if (Object.keys(match).length) pipeline.push({ $match: match });
    const joins = reportJoinStages();
    const regex = searchRegex(query.search);
    if (regex) pipeline.push(...joins, { $match: { $or: [
      { requestCode: regex }, { reason: regex }, { 'order.orderCode': regex },
      { 'user.displayName': regex }, { 'user.username': regex }, { 'user.telegramId': regex },
      { 'product.name': regex }, { 'product.slug': regex },
    ] } });
    pipeline.push({ $facet: {
      items: [{ $sort: { createdAt: -1, _id: -1 } }, { $skip: (page - 1) * limit }, { $limit: limit },
        ...(!regex ? joins : [])],
      meta: [{ $count: 'total' }],
    } });
    const [result] = await this.reports.aggregate<FacetResult>(pipeline).exec();
    const total = result?.meta[0]?.total ?? 0;
    return { items: (result?.items ?? []).map(reportListItem), page, limit, total, totalPages: Math.ceil(total / limit) };
  }

  async update(id: string, adminId: string, input: UpdateOrderReportDto, requestId?: string) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Report not found');
    if (!Types.ObjectId.isValid(adminId)) throw new BadRequestException('Invalid administrator');
    const note = input.resolutionNote?.trim();
    if (RESOLUTION_NOTE_REQUIRED.includes(input.status) && !note) {
      throw new BadRequestException('A resolution note is required for the selected status');
    }
    const session = await this.connection.startSession();
    let result: { id: string; requestCode: string; status: string; resolutionNote: string | null; reviewedAt: Date } | undefined;
    let notification: ReportResolutionNotification | undefined;
    try {
      await session.withTransaction(async () => {
        const report = await this.reports.findById(id).session(session);
        if (!report) throw new NotFoundException('Report not found');
        assertStatusTransition(report.status, input.status);
        const previousStatus = report.status;
        report.status = input.status;
        report.reviewedBy = new Types.ObjectId(adminId);
        report.reviewedAt = new Date();
        report.resolutionNote = note || undefined;
        await report.save({ session });
        await this.audits.create([{
          actorType: 'ADMIN', actorId: new Types.ObjectId(adminId), action: 'WARRANTY_REQUEST_UPDATED',
          resourceType: 'WarrantyRequest', resourceId: report._id, requestId,
          changes: { status: { from: previousStatus, to: report.status } },
          metadata: { requestCode: report.requestCode, resolutionNoteLength: note?.length ?? 0 },
        }], { session });
        const order = await this.orders.findById(report.orderId).select('orderCode').session(session).lean();
        result = { id: report._id.toString(), requestCode: report.requestCode, status: report.status,
          resolutionNote: report.resolutionNote ?? null, reviewedAt: report.reviewedAt };
        notification = { userId: report.userId, requestCode: report.requestCode,
          orderCode: order?.orderCode ?? report.orderId.toString(), status: report.status,
          resolutionNote: report.resolutionNote };
      });
    } finally {
      await session.endSession();
    }
    if (!result || !notification) throw new Error('Report transaction did not update a report');
    let notificationSent = false;
    try { notificationSent = await this.notifier.notify(notification); } catch { notificationSent = false; }
    return { ...result, notificationSent };
  }
}

function createResponse(report: WarrantyRequest & { _id: MongooseTypes.ObjectId }, existing: boolean) {
  return { id: report._id.toString(), requestCode: report.requestCode, status: report.status, existing };
}

function reportListItem(report: ReportRecord) {
  return {
    id: report._id.toString(), requestCode: report.requestCode,
    category: report.category ?? (typeof report.metadata?.category === 'string' ? report.metadata.category : ComplaintCategory.OTHER),
    reason: report.reason, evidenceUrls: report.evidenceUrls ?? [], status: report.status,
    resolutionNote: report.resolutionNote ?? null, reviewedAt: report.reviewedAt ?? null,
    createdAt: report.createdAt, updatedAt: report.updatedAt,
    order: report.order ? { id: report.order._id.toString(), orderCode: report.order.orderCode,
      status: report.order.status, deliveryStatus: report.order.deliveryStatus,
      totalAmount: report.order.totalAmount, createdAt: report.order.createdAt } : null,
    user: report.user ? { id: report.user._id.toString(), telegramId: report.user.telegramId,
      username: report.user.username ?? null, displayName: report.user.displayName ?? null } : null,
    product: report.product ? { id: report.product._id.toString(), name: report.product.name, slug: report.product.slug } : null,
  };
}

function reportJoinStages(): PipelineStage.FacetPipelineStage[] {
  return [
    { $lookup: { from: 'orders', localField: 'orderId', foreignField: '_id', as: 'order' } },
    { $unwind: { path: '$order', preserveNullAndEmptyArrays: true } },
    { $lookup: { from: 'users', localField: 'userId', foreignField: '_id', as: 'user' } },
    { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
    { $lookup: { from: 'products', localField: 'order.productId', foreignField: '_id', as: 'product' } },
    { $unwind: { path: '$product', preserveNullAndEmptyArrays: true } },
  ];
}

function addDateRange(match: FilterQuery<WarrantyRequest>, from?: string, to?: string) {
  const start = from ? parseBoundary(from, false) : undefined;
  const end = to ? parseBoundary(to, true) : undefined;
  if (start && end && start > end) throw new BadRequestException('The from date must be before the to date');
  if (start || end) match.createdAt = { ...(start ? { $gte: start } : {}), ...(end ? { $lte: end } : {}) };
}

function parseBoundary(value: string, end: boolean) {
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value}T${end ? '23:59:59.999' : '00:00:00.000'}+07:00` : value);
  if (Number.isNaN(date.getTime())) throw new BadRequestException('Invalid date filter');
  return date;
}

function searchRegex(search?: string) {
  const value = search?.trim();
  return value ? new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : undefined;
}

function assertStatusTransition(current: string, next: string) {
  const allowed: Record<string, readonly string[]> = {
    [WarrantyStatus.PENDING]: [WarrantyStatus.REVIEWING, WarrantyStatus.RESOLVED, WarrantyStatus.REJECTED],
    [WarrantyStatus.REVIEWING]: [WarrantyStatus.RESOLVED, WarrantyStatus.REJECTED],
    [WarrantyStatus.REJECTED]: [],
    [WarrantyStatus.RESOLVED]: [],
    // Legacy statuses remain readable and can be normalized by an administrator.
    [WarrantyStatus.APPROVED]: [WarrantyStatus.REVIEWING, WarrantyStatus.RESOLVED, WarrantyStatus.REJECTED],
    [WarrantyStatus.REPLACED]: [WarrantyStatus.RESOLVED],
    [WarrantyStatus.REFUNDED]: [WarrantyStatus.RESOLVED],
  };
  if (!allowed[current]?.includes(next)) throw new ConflictException('Invalid report status transition');
}
