import type { Job } from 'bullmq';
import { Types } from 'mongoose';
import { Markup } from 'telegraf';
import {
  NotificationChannel, NotificationModel, NotificationStatus, ProductModel, UserModel,
} from '@store/database';
import { ProductStatus, UserStatus, isMongoDuplicateKey } from '@store/shared';
import type { PurchaseAlertJob } from '../../api/src/purchase/purchase-alert.queue';
import type { TelegramBotClient } from './delivery.processor';

export interface PurchaseAlertBatch extends PurchaseAlertJob {
  cursor?: string;
  limit?: number;
}

/** Broadcasts real, anonymous purchase activity once per order group and customer. */
export class PurchaseAlertProcessor {
  constructor(private readonly bot: TelegramBotClient) {}

  async process(job: Job<PurchaseAlertJob>) { return this.processBatch(job.data); }

  async processBatch(input: PurchaseAlertBatch) {
    if (![input.purchaseGroupId, input.productId, input.buyerId].every((id) => Types.ObjectId.isValid(id)) ||
      !Number.isSafeInteger(input.quantity) || input.quantity < 1 || input.quantity > 100) {
      throw new Error('Invalid purchase announcement job');
    }
    if (input.cursor && !Types.ObjectId.isValid(input.cursor)) throw new Error('Invalid purchase announcement cursor');
    const productId = new Types.ObjectId(input.productId);
    const buyerId = new Types.ObjectId(input.buyerId);
    const groupId = new Types.ObjectId(input.purchaseGroupId);
    const product = await ProductModel.findOne({ _id: productId, deletedAt: null, status: ProductStatus.ACTIVE })
      .select('name categoryId').lean();
    if (!product) return { status: 'product-not-public', sent: 0, failed: 0, skipped: 0 };

    const categoryKey = product.categoryId?.toString() ?? 'uncategorized';
    const message = [
      '🔥 *VỪA CÓ KHÁCH MUA THÀNH CÔNG*',
      `🛍 ${escapeMarkdown(product.name)}`,
      `📦 Số lượng: *${input.quantity}*`,
      '✅ Đơn đã được shop xác nhận và đang giao tự động.',
    ].join('\n');
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('🛍 Xem & mua sản phẩm', `select:${product._id.toString()}:${categoryKey}`)],
    ]);
    let sent = 0; let failed = 0; let skipped = 0;
    const requestedLimit = Number.isSafeInteger(input.limit) && input.limit! > 0 ? Math.min(input.limit!, 100) : 0;
    const users = await UserModel.find({ _id: {
      $ne: buyerId, ...(input.cursor ? { $gt: new Types.ObjectId(input.cursor) } : {}),
    }, status: UserStatus.ACTIVE, deletedAt: null })
      .select('_id telegramId').sort({ _id: 1 }).limit(requestedLimit ? requestedLimit + 1 : 0).lean();
    const hasMore = requestedLimit > 0 && users.length > requestedLimit;
    const page = hasMore ? users.slice(0, requestedLimit) : users;
    for (const user of page) {
      const notification = await createPurchaseNotification(user._id, productId, groupId, input.quantity);
      if (notification.status === NotificationStatus.SENT) { skipped++; continue; }
      try {
        await this.bot.telegram.sendMessage(user.telegramId, message, { parse_mode: 'Markdown', ...keyboard });
        await NotificationModel.updateOne({ _id: notification._id }, { $set: {
          status: NotificationStatus.SENT, sentAt: new Date(),
        }, $unset: { errorCode: 1 } });
        sent++;
      } catch (error) {
        await NotificationModel.updateOne({ _id: notification._id }, { $set: {
          status: NotificationStatus.FAILED, errorCode: telegramErrorCode(error),
        } });
        failed++;
      }
      await new Promise((resolve) => setTimeout(resolve, 45));
    }
    return { status: 'complete', sent, failed, skipped,
      nextCursor: hasMore ? page.at(-1)?._id.toString() : undefined };
  }
}

async function createPurchaseNotification(userId: Types.ObjectId, productId: Types.ObjectId,
  groupId: Types.ObjectId, quantity: number) {
  const filter = { deduplicationKey: `purchase-proof:${groupId.toString()}:${userId.toString()}` };
  try {
    return await NotificationModel.findOneAndUpdate(filter, { $setOnInsert: {
      userId, channel: NotificationChannel.TELEGRAM, title: 'Vừa có khách mua hàng',
      body: `Anonymous purchase announcement for ${productId.toString()}`,
      status: NotificationStatus.PENDING, referenceType: 'PURCHASE_SOCIAL_PROOF', referenceId: groupId,
      deduplicationKey: filter.deduplicationKey, metadata: { productId: productId.toString(), quantity },
    } }, { upsert: true, new: true, setDefaultsOnInsert: true });
  } catch (error) {
    if (!isMongoDuplicateKey(error)) throw error;
    const existing = await NotificationModel.findOne(filter);
    if (!existing) throw error;
    return existing;
  }
}

function escapeMarkdown(value: string) { return value.replace(/([_*!\[\]()`])/g, '\\$1'); }
function telegramErrorCode(error: unknown) {
  const code = (error as { response?: { error_code?: number } }).response?.error_code;
  return code ? `TELEGRAM_${code}` : 'TELEGRAM_SEND_FAILED';
}
