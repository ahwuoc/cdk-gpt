import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import type { FilterQuery, Model } from 'mongoose';
import {
  AuditLog, CustomerConversationType, CustomerMessage, CustomerMessageAudience, CustomerMessageDirection,
  CustomerMessageStatus, Notification, NotificationChannel, NotificationStatus, User,
  claimableCustomerMessageDelivery, customerMessageId,
} from '@store/database';
import { UserStatus, isMongoDuplicateKey } from '@store/shared';
import type { AdminMessageQueryDto, BroadcastQueryDto, ReceiveSupportMessageDto } from './messaging.dto';
import { ADMIN_BROADCAST_QUEUE, type AdminBroadcastQueueClient } from './admin-broadcast.queue';
import { TelegramMessenger } from './telegram-messenger';

@Injectable()
export class MessagingService {
  constructor(
    @InjectModel('User') private readonly users: Model<User>,
    @InjectModel('CustomerMessage') private readonly messages: Model<CustomerMessage>,
    @InjectModel('Notification') private readonly notifications: Model<Notification>,
    @InjectModel('AuditLog') private readonly audits: Model<AuditLog>,
    private readonly telegram: TelegramMessenger,
    @Inject(ADMIN_BROADCAST_QUEUE) private readonly broadcasts: AdminBroadcastQueueClient,
  ) {}

  async sendDirect(adminId: string, telegramId: string, rawBody: string, requestId?: string) {
    const body = normalizeBody(rawBody);
    const user = await this.users.findOne({ telegramId, deletedAt: null }).lean();
    if (!user) throw new NotFoundException('Không tìm thấy khách đã từng mở bot với Telegram ID này');
    const deduplicationKey = `admin-direct:${requestId?.trim() || randomUUID()}`;
    const message = await this.createMessageOnce({ userId: user._id, adminId: new Types.ObjectId(adminId),
      conversationType: CustomerConversationType.DIRECT, direction: CustomerMessageDirection.ADMIN_TO_USER,
      audience: CustomerMessageAudience.DIRECT, body, status: CustomerMessageStatus.PENDING, deduplicationKey });
    if (message.body !== body) throw new ConflictException('Request ID đã được dùng cho một nội dung khác');
    if (message.status === CustomerMessageStatus.SENT) return directResult(message, user);
    const claimed = await this.messages.findOneAndUpdate({ _id: message._id, ...claimableCustomerMessageDelivery() },
    { $set: { status: CustomerMessageStatus.SENDING }, $unset: { errorCode: 1 } }, { new: true });
    if (!claimed) return directResult(message, user);
    try {
      const sent = await this.telegram.sendSupportMessage(user.telegramId, message.body);
      await this.messages.updateOne({ _id: message._id }, { $set: {
        status: CustomerMessageStatus.SENT, telegramMessageId: sent.message_id,
      }, $unset: { errorCode: 1 } });
    } catch (error) {
      await this.messages.updateOne({ _id: message._id }, { $set: {
        status: CustomerMessageStatus.FAILED, errorCode: telegramErrorCode(error),
      } });
      throw new BadRequestException('Telegram không gửi được tin nhắn; khách có thể chưa mở bot hoặc đã chặn bot');
    }
    await this.audits.create({ actorType: 'ADMIN', actorId: new Types.ObjectId(adminId), action: 'CUSTOMER_MESSAGE_SENT',
      resourceType: 'User', resourceId: user._id, requestId, metadata: { telegramId: user.telegramId, messageLength: body.length } });
    const updated = await this.messages.findById(message._id).lean();
    return directResult(updated ?? message, user);
  }

  async receiveUser(input: ReceiveSupportMessageDto) {
    if (!Types.ObjectId.isValid(input.userId)) throw new NotFoundException('Customer not found');
    const user = await this.users.findOne({ _id: input.userId, deletedAt: null }).lean();
    if (!user) throw new NotFoundException('Customer not found');
    const body = normalizeBody(input.body);
    const message = await this.createMessageOnce({ userId: user._id,
      conversationType: CustomerConversationType.DIRECT, direction: CustomerMessageDirection.USER_TO_ADMIN,
      audience: CustomerMessageAudience.DIRECT, body, status: CustomerMessageStatus.RECEIVED,
      deduplicationKey: `bot-support:${input.idempotencyKey}` });
    if (message.body !== body) throw new ConflictException('Idempotency key đã được dùng cho một nội dung khác');
    return { id: message._id.toString(), status: message.status };
  }

  async list(query: AdminMessageQueryDto) {
    const page = query.page ?? 1; const limit = query.limit ?? 30;
    const filter: FilterQuery<CustomerMessage> = { conversationType: CustomerConversationType.DIRECT };
    if (query.telegramId) {
      const user = await this.users.findOne({ telegramId: query.telegramId, deletedAt: null }).select('_id').lean();
      if (!user) return { items: [], page, limit, total: 0, totalPages: 0 };
      filter.userId = user._id;
    }
    if (query.search?.trim()) filter.body = { $regex: escapeRegex(query.search.trim()), $options: 'i' };
    const [items, total] = await Promise.all([
      this.messages.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      this.messages.countDocuments(filter),
    ]);
    const users = await this.users.find({ _id: { $in: [...new Set(items.map((item) => item.userId.toString()))] } })
      .select('_id telegramId username displayName').lean();
    const byId = new Map(users.map((user) => [user._id.toString(), user]));
    return { items: items.reverse().map((message) => publicMessage(message, byId.get(message.userId.toString()))),
      page, limit, total, totalPages: Math.ceil(total / limit) };
  }

  async sendBroadcast(adminId: string, rawBody: string, requestId?: string) {
    const body = normalizeBody(rawBody); const adminObjectId = new Types.ObjectId(adminId);
    const key = `admin-broadcast:${requestId?.trim() || randomUUID()}`;
    let campaign: Notification & { _id: Types.ObjectId };
    try {
      campaign = await this.notifications.findOneAndUpdate({ deduplicationKey: key }, { $setOnInsert: {
        adminId: adminObjectId, channel: NotificationChannel.ADMIN_WEB, title: 'Telegram broadcast', body,
        status: NotificationStatus.PENDING, referenceType: 'ADMIN_BROADCAST', deduplicationKey: key,
        metadata: { queuedAt: new Date().toISOString(), sent: 0, failed: 0, skipped: 0 },
      } }, { upsert: true, new: true, setDefaultsOnInsert: true }) as Notification & { _id: Types.ObjectId };
    } catch (error) {
      if (!isMongoDuplicateKey(error)) throw error;
      const existing = await this.notifications.findOne({ deduplicationKey: key });
      if (!existing) throw error; campaign = existing as typeof campaign;
    }
    if (campaign.body !== body) throw new ConflictException('Request ID đã được dùng cho một nội dung khác');
    if (campaign.status !== NotificationStatus.SENT) await this.broadcasts.enqueue({ campaignId: campaign._id.toString() });
    await this.audits.create({ actorType: 'ADMIN', actorId: adminObjectId, action: 'TELEGRAM_BROADCAST_QUEUED',
      resourceType: 'Notification', resourceId: campaign._id, requestId, metadata: { messageLength: body.length } });
    return { id: campaign._id.toString(), status: campaign.status, queued: true };
  }

  async listBroadcasts(query: BroadcastQueryDto) {
    const page = query.page ?? 1; const limit = query.limit ?? 20;
    const filter = { referenceType: 'ADMIN_BROADCAST', channel: NotificationChannel.ADMIN_WEB };
    const [items, total] = await Promise.all([
      this.notifications.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      this.notifications.countDocuments(filter),
    ]);
    return { items: items.map((item) => ({ id: item._id.toString(), body: item.body, status: item.status,
      sentAt: item.sentAt ?? null, metadata: item.metadata, createdAt: item.createdAt })),
      page, limit, total, totalPages: Math.ceil(total / limit) };
  }

  private async createMessageOnce(value: Partial<Omit<CustomerMessage, 'deduplicationKey'>> & { deduplicationKey: string }) {
    const _id = customerMessageId(value.deduplicationKey);
    try {
      return await this.messages.findOneAndUpdate({ _id }, { $setOnInsert: { _id, ...value } },
        { upsert: true, new: true, setDefaultsOnInsert: true });
    } catch (error) {
      if (!isMongoDuplicateKey(error)) throw error;
      const existing = await this.messages.findById(_id);
      if (!existing) throw error; return existing;
    }
  }
}

function normalizeBody(value: string) {
  const body = value.trim();
  if (!body || body.length > 4_000) throw new BadRequestException('Nội dung phải từ 1 đến 4.000 ký tự');
  return body;
}
function escapeRegex(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function telegramErrorCode(error: unknown) {
  const code = (error as { response?: { error_code?: number } }).response?.error_code;
  return code ? `TELEGRAM_${code}` : 'TELEGRAM_SEND_FAILED';
}
function directResult(message: CustomerMessage & { _id: Types.ObjectId }, user: User & { _id: Types.ObjectId }) {
  return { id: message._id.toString(), status: message.status,
    user: { id: user._id.toString(), telegramId: user.telegramId, username: user.username ?? null, displayName: user.displayName ?? null } };
}
function publicMessage(message: CustomerMessage & { _id: Types.ObjectId }, user?: User & { _id: Types.ObjectId }) {
  return { id: message._id.toString(), direction: message.direction, audience: message.audience, body: message.body,
    status: message.status, errorCode: message.errorCode ?? null, createdAt: message.createdAt,
    user: user ? { id: user._id.toString(), telegramId: user.telegramId,
      username: user.username ?? null, displayName: user.displayName ?? null } : null };
}
