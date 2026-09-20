import type { Job } from 'bullmq';
import { Types } from 'mongoose';
import { Markup } from 'telegraf';
import {
  InventoryItemModel, NotificationChannel, NotificationModel, NotificationStatus, ProductModel, UserModel, claimableNotificationDelivery, customerMessageId,
} from '@store/database';
import { InventoryStatus, ProductStatus, UserStatus, isMongoDuplicateKey } from '@store/shared';
import type { TelegramBotClient } from './delivery.processor';
import { broadcastClaimRetryAfter, broadcastSender, BroadcastRetryError, forEachBroadcastRecipient, type BroadcastSender } from './broadcast-sender';

export interface StockAlertJob {
  productId: string;
  importBatchId: string;
  importedRows: number;
}

export interface StockAlertBatch extends StockAlertJob {
  /** Process users after this ObjectId; used by the serverless task route. */
  cursor?: string;
  /** 0/undefined means all users (the existing long-running worker behaviour). */
  limit?: number;
}

/** Sends a single restock announcement per imported batch to each active Telegram customer. */
export class StockAlertProcessor {
  constructor(private readonly bot: TelegramBotClient, private readonly sender: BroadcastSender = broadcastSender) {}

  async process(job: Job<StockAlertJob>) { return this.processBatch(job.data); }

  /**
   * A Vercel function uses small pages rather than one unbounded customer
   * cursor. The notification row is the idempotency record for each customer,
   * so QStash can safely retry a page.
   */
  async processBatch(input: StockAlertBatch) {
    if (!Types.ObjectId.isValid(input.productId) || !Types.ObjectId.isValid(input.importBatchId)) {
      throw new Error('Invalid product restock job');
    }
    if (input.cursor && !Types.ObjectId.isValid(input.cursor)) throw new Error('Invalid restock cursor');
    const productId = new Types.ObjectId(input.productId);
    const product = await ProductModel.findOne({ _id: productId, deletedAt: null, status: ProductStatus.ACTIVE })
      .select('name price categoryId').lean();
    if (!product) return { status: 'product-not-public', sent: 0, failed: 0 };

    const availableStock = await InventoryItemModel.countDocuments({ productId, status: InventoryStatus.AVAILABLE, deletedAt: null });
    const categoryKey = product.categoryId?.toString() ?? 'uncategorized';
    const message = [
      '🆕 *HÀNG ĐÃ VỀ!*',
      `🛍 ${escapeMarkdown(product.name)}`,
      `💰 ${formatMoney(product.price)}`,
      `📦 Hiện còn: ${availableStock}`,
      '',
      'Bấm nút bên dưới để xem và mua ngay.',
    ].join('\n');
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('🛍 Xem sản phẩm', `select:${product._id.toString()}:${categoryKey}`)],
    ]);
    let sent = 0; let failed = 0; let skipped = 0;
    const requestedLimit = Number.isSafeInteger(input.limit) && input.limit! > 0 ? Math.min(input.limit!, 100) : 0;
    const users = await UserModel.find({ status: UserStatus.ACTIVE, deletedAt: null,
      ...(input.cursor ? { _id: { $gt: new Types.ObjectId(input.cursor) } } : {}),
    }).select('_id telegramId').sort({ _id: 1 }).limit(requestedLimit ? requestedLimit + 1 : 0).lean();
    const hasMore = requestedLimit > 0 && users.length > requestedLimit;
    const page = hasMore ? users.slice(0, requestedLimit) : users;
    await forEachBroadcastRecipient(page, async (user) => {
      const notification = await createRestockNotification(user._id, productId, input.importBatchId, input.importedRows);
      if (notification.status === NotificationStatus.SENT) { skipped++; return; }
      if (notification.status === NotificationStatus.FAILED) { failed++; return; }
      const claimed = await NotificationModel.findOneAndUpdate({ _id: notification._id,
        status: { $ne: NotificationStatus.FAILED }, ...claimableNotificationDelivery() },
        { $set: { status: NotificationStatus.SENDING }, $unset: { errorCode: 1 } }, { new: true });
      if (!claimed) throw new BroadcastRetryError('Restock recipient is being delivered by another worker', {
        retryAfterMs: broadcastClaimRetryAfter(notification.updatedAt),
      });
      try {
        await this.sender.send(user.telegramId, () => this.bot.telegram.sendMessage(user.telegramId, message, { parse_mode: 'Markdown', ...keyboard }));
      } catch (error) {
        await NotificationModel.updateOne({ _id: notification._id }, { $set: {
          status: error instanceof BroadcastRetryError ? NotificationStatus.PENDING : NotificationStatus.FAILED,
          errorCode: error instanceof BroadcastRetryError ? 'BROADCAST_RETRY' : telegramErrorCode(error),
        } });
        if (error instanceof BroadcastRetryError) throw error;
        failed++;
        return;
      }
      await NotificationModel.updateOne({ _id: notification._id }, { $set: { status: NotificationStatus.SENT, sentAt: new Date() }, $unset: { errorCode: 1 } });
      sent++;
    });
    return { status: 'complete', sent, failed, skipped, nextCursor: hasMore ? page.at(-1)?._id.toString() : undefined };
  }
}

async function createRestockNotification(userId: Types.ObjectId, productId: Types.ObjectId, importBatchId: string, importedRows: number) {
  const filter = {
    deduplicationKey: `restock:${importBatchId}:${userId.toString()}`,
  };
  const createdAt = new Date();
  try {
    return await NotificationModel.findOneAndUpdate(filter, { $setOnInsert: {
      _id: customerMessageId(filter.deduplicationKey),
      userId, channel: NotificationChannel.TELEGRAM, title: 'Hàng đã về', body: `Restock announcement for ${productId}`,
      status: NotificationStatus.PENDING, referenceType: 'PRODUCT_RESTOCK', referenceId: productId,
      deduplicationKey: filter.deduplicationKey,
      metadata: { importBatchId, importedRows }, createdAt, updatedAt: createdAt,
    } }, { upsert: true, new: true, setDefaultsOnInsert: true, timestamps: false });
  } catch (error) {
    // The unique restock index turns overlapping QStash retries into a read.
    if (!isMongoDuplicateKey(error)) throw error;
    const existing = await NotificationModel.findOne(filter);
    if (!existing) throw error;
    return existing;
  }
}

function escapeMarkdown(value: string) {
  return value.replace(/([_*!\[\]()`])/g, '\\$1');
}

function formatMoney(value: number) {
  return new Intl.NumberFormat('vi-VN').format(value) + ' đ';
}

function telegramErrorCode(error: unknown) {
  const code = (error as { response?: { error_code?: number } }).response?.error_code;
  return code ? `TELEGRAM_${code}` : 'TELEGRAM_SEND_FAILED';
}
