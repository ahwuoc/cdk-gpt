import type { Job } from 'bullmq';
import { Types } from 'mongoose';
import { Markup } from 'telegraf';
import {
  CustomerConversationType, CustomerMessageAudience, CustomerMessageDirection, CustomerMessageModel,
  CustomerMessageStatus, NotificationModel, NotificationStatus, UserModel,
  claimableCustomerMessageDelivery, customerMessageId,
} from '@store/database';
import { UserStatus, isMongoDuplicateKey } from '@store/shared';
import type { AdminBroadcastJob } from '../../api/src/messaging/admin-broadcast.queue';
import type { TelegramBotClient } from './delivery.processor';

export interface AdminBroadcastBatch extends AdminBroadcastJob { cursor?: string; limit?: number; }

export class AdminBroadcastProcessor {
  constructor(private readonly bot: TelegramBotClient) {}
  process(job: Job<AdminBroadcastJob>) { return this.processBatch(job.data); }

  async processBatch(input: AdminBroadcastBatch) {
    if (!Types.ObjectId.isValid(input.campaignId)) throw new Error('Invalid broadcast campaign');
    if (input.cursor && !Types.ObjectId.isValid(input.cursor)) throw new Error('Invalid broadcast cursor');
    const campaignId = new Types.ObjectId(input.campaignId);
    const campaign = await NotificationModel.findOne({ _id: campaignId, referenceType: 'ADMIN_BROADCAST' }).lean();
    if (!campaign) throw new Error('Broadcast campaign not found');
    if (campaign.status === NotificationStatus.SENT) return { status: 'already-complete', sent: 0, failed: 0, skipped: 0 };

    const requestedLimit = Number.isSafeInteger(input.limit) && input.limit! > 0 ? Math.min(input.limit!, 100) : 0;
    const users = await UserModel.find({
      ...(input.cursor ? { _id: { $gt: new Types.ObjectId(input.cursor) } } : {}),
      status: UserStatus.ACTIVE,
      deletedAt: null,
    }).select('_id telegramId').sort({ _id: 1 })
      .limit(requestedLimit ? requestedLimit + 1 : 0).lean();
    const hasMore = requestedLimit > 0 && users.length > requestedLimit;
    const page = hasMore ? users.slice(0, requestedLimit) : users;
    let sent = 0; let failed = 0; let skipped = 0;
    for (const user of page) {
      const record = await createDeliveryRecord(campaignId, campaign.adminId, user._id, campaign.body);
      if (record.status === CustomerMessageStatus.SENT) { skipped++; continue; }
      const claimed = await CustomerMessageModel.findOneAndUpdate({ _id: record._id,
        ...claimableCustomerMessageDelivery() },
      { $set: { status: CustomerMessageStatus.SENDING }, $unset: { errorCode: 1 } }, { new: true });
      if (!claimed) { skipped++; continue; }
      try {
        const delivered = await this.bot.telegram.sendMessage(user.telegramId, `📢 THÔNG BÁO TỪ SHOP\n\n${campaign.body}`, {
          ...Markup.inlineKeyboard([[Markup.button.callback('💬 Liên hệ shop', 'support:direct')]]),
        });
        await CustomerMessageModel.updateOne({ _id: record._id }, { $set: {
          status: CustomerMessageStatus.SENT, telegramMessageId: delivered.message_id,
        }, $unset: { errorCode: 1 } });
        sent++;
      } catch (error) {
        await CustomerMessageModel.updateOne({ _id: record._id }, { $set: {
          status: CustomerMessageStatus.FAILED, errorCode: telegramErrorCode(error),
        } });
        failed++;
      }
      await new Promise((resolve) => setTimeout(resolve, 45));
    }
    const counts = await campaignCounts(campaignId);
    await NotificationModel.updateOne({ _id: campaignId }, {
      $set: { 'metadata.sent': counts.sent, 'metadata.failed': counts.failed, 'metadata.recipientsProcessed': counts.total,
        ...(!hasMore ? { status: NotificationStatus.SENT, sentAt: new Date(), 'metadata.completedAt': new Date().toISOString() } : {}) },
    });
    return { status: hasMore ? 'page-complete' : 'complete', sent, failed, skipped,
      nextCursor: hasMore ? page.at(-1)?._id.toString() : undefined };
  }
}

async function createDeliveryRecord(campaignId: Types.ObjectId, adminId: Types.ObjectId | undefined,
  userId: Types.ObjectId, body: string) {
  const deduplicationKey = `admin-broadcast:${campaignId.toString()}:${userId.toString()}`;
  const _id = customerMessageId(deduplicationKey);
  try {
    return await CustomerMessageModel.findOneAndUpdate({ _id }, { $setOnInsert: {
      _id, userId, adminId, campaignId, conversationType: CustomerConversationType.DIRECT,
      direction: CustomerMessageDirection.ADMIN_TO_USER, audience: CustomerMessageAudience.BROADCAST,
      body, status: CustomerMessageStatus.PENDING, deduplicationKey,
    } }, { upsert: true, new: true, setDefaultsOnInsert: true });
  } catch (error) {
    if (!isMongoDuplicateKey(error)) throw error;
    const existing = await CustomerMessageModel.findById(_id);
    if (!existing) throw error; return existing;
  }
}

async function campaignCounts(campaignId: Types.ObjectId) {
  const rows = await CustomerMessageModel.aggregate<{ _id: string; count: number }>([
    { $match: { campaignId } }, { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);
  const count = (status: string) => rows.find((row) => row._id === status)?.count ?? 0;
  const sent = count(CustomerMessageStatus.SENT); const failed = count(CustomerMessageStatus.FAILED);
  return { sent, failed, total: rows.reduce((sum, row) => sum + row.count, 0) };
}
function telegramErrorCode(error: unknown) {
  const code = (error as { response?: { error_code?: number } }).response?.error_code;
  return code ? `TELEGRAM_${code}` : 'TELEGRAM_SEND_FAILED';
}
