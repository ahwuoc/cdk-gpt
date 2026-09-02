import { UnrecoverableError, type Job } from 'bullmq';
import mongoose, { Types } from 'mongoose';
import type { Telegram } from 'telegraf';
import {
  InventoryItemModel, InventoryRepository, NotificationModel, OrderModel, OrderRepository, PaymentRequestModel,
  ProductModel, UserModel, type Order,
} from '@store/database';
import { EncryptionService } from '@store/encryption';
import { DeliveryStatus, InventoryStatus, OrderStatus } from '@store/shared';

export interface DeliveryJob { orderId: string; }
export interface TelegramBotClient {
  telegram: {
    sendMessage(chatId: string | number, text: string, extra?: Parameters<Telegram['sendMessage']>[2]): Promise<{ message_id: number }>;
    deleteMessage?(chatId: string | number, messageId: number): Promise<unknown>;
  };
}

export class DeliveryProcessor {
  private readonly encryption = EncryptionService.fromEnvironment();
  private readonly inventoryRepository = new InventoryRepository(InventoryItemModel);
  private readonly orderRepository = new OrderRepository(OrderModel);
  constructor(private readonly bot: TelegramBotClient,
    private readonly adminTelegramIds: string[] | (() => Promise<string[]>)) {}

  async process(job: Job<DeliveryJob>) {
    if (!Types.ObjectId.isValid(job.data.orderId)) throw new UnrecoverableError('Invalid order identifier');
    const orderId = new Types.ObjectId(job.data.orderId);
    const initial = await OrderModel.findById(orderId);
    if (!initial) throw new UnrecoverableError('Order not found');
    if (initial.status === OrderStatus.DELIVERED) return { status: 'already-delivered' };
    if (initial.status === OrderStatus.DELIVERY_FAILED) throw new UnrecoverableError('Order already requires manual review');
    if (initial.status === OrderStatus.DELIVERING) {
      // A prior process may have sent the secret but crashed before confirmation. Never send twice automatically.
      throw new UnrecoverableError('Ambiguous prior delivery attempt; manual review required');
    }
    const claimed = await this.orderRepository.markDelivering(orderId, job.id);
    if (!claimed) {
      const current = await OrderModel.findById(orderId).lean();
      if (current?.status === OrderStatus.DELIVERED) return { status: 'already-delivered' };
      throw new UnrecoverableError('Order could not be claimed for delivery');
    }

    const [user, product, inventory] = await Promise.all([
      UserModel.findById(claimed.userId).select('telegramId').lean(),
      ProductModel.findById(claimed.productId).select('deliveryTemplate fieldDefinitions').lean(),
      this.inventoryRepository.findForDelivery(orderId),
    ]);
    if (!user || !product || !inventory) throw new UnrecoverableError('Order delivery data is incomplete');
    let payload: Record<string, unknown>;
    try { payload = this.encryption.decrypt<Record<string, unknown>>(inventory.encryptedPayload); }
    catch { throw new UnrecoverableError('Inventory payload cannot be decrypted'); }
    const message = renderTemplate(product.deliveryTemplate, payload);
    try {
      const sent = await this.bot.telegram.sendMessage(user.telegramId, message, deliveryCopyKeyboard(message));
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          const sold = await this.inventoryRepository.markSold(inventory._id, user._id, orderId, session);
          if (!sold) {
            const alreadySold = await InventoryItemModel.exists({ _id: inventory._id, soldOrderId: orderId, status: InventoryStatus.SOLD }).session(session);
            if (!alreadySold) throw new Error('Inventory state changed during delivery');
          }
          await this.orderRepository.markDelivered(orderId, session);
          await OrderModel.updateOne({ _id: orderId }, { $set: { 'metadata.telegramMessageId': sent.message_id } }, { session });
        }, { writeConcern: { w: 'majority' } });
      } finally { await session.endSession(); }
      await this.clearCheckoutPrompt(claimed, user.telegramId);
      return { status: 'delivered' };
    } catch (error) {
      const classification = classifyTelegramError(error);
      if (classification === 'TEMPORARY_CONFIRMED_FAILURE') {
        await OrderModel.updateOne({ _id: orderId, status: OrderStatus.DELIVERING }, { $set: {
          status: OrderStatus.PENDING_DELIVERY, deliveryStatus: DeliveryStatus.PENDING,
        }, $unset: { 'metadata.deliveryAttemptId': 1, 'metadata.deliveryStartedAt': 1 } });
        throw error;
      }
      if (classification === 'PERMANENT') throw new UnrecoverableError(safeErrorCode(error));
      // Timeout or post-send database error is ambiguous: retain RESERVED and require an admin decision.
      throw new UnrecoverableError('Ambiguous delivery result; inventory retained for manual review');
    }
  }

  private async clearCheckoutPrompt(order: Order, telegramId: string) {
    try {
      const paymentRequestId = order.metadata?.paymentRequestId;
      if (typeof paymentRequestId !== 'string' || !Types.ObjectId.isValid(paymentRequestId) ||
        !this.bot.telegram.deleteMessage) return;
      const request = await PaymentRequestModel.findById(paymentRequestId).select('metadata.telegramPrompt').lean();
      const prompt = request?.metadata?.telegramPrompt;
      if (!prompt || typeof prompt !== 'object' || Array.isArray(prompt)) return;
      const chatId = String((prompt as Record<string, unknown>).chatId ?? '');
      const messageId = Number((prompt as Record<string, unknown>).messageId);
      if (chatId !== telegramId || !Number.isSafeInteger(messageId) || messageId < 1) return;
      await this.bot.telegram.deleteMessage(chatId, messageId);
    } catch { /* Cleanup must never turn a successful delivery into a failed order. */ }
  }

  async onFailed(job: Job<DeliveryJob> | undefined, error: Error) {
    if (!job || !Types.ObjectId.isValid(job.data.orderId)) return;
    const reason = safeErrorCode(error);
    const order = await this.orderRepository.markDeliveryFailed(new Types.ObjectId(job.data.orderId), reason);
    if (!order) return;
    await NotificationModel.create({ channel: 'ADMIN_WEB', title: 'Delivery requires attention',
      body: `Order ${order.orderCode} failed delivery: ${reason}`, status: 'PENDING', referenceType: 'Order',
      referenceId: order._id, metadata: { attemptsMade: job.attemptsMade } });
    const adminTelegramIds = typeof this.adminTelegramIds === 'function'
      ? await this.adminTelegramIds().catch(() => []) : this.adminTelegramIds;
    await Promise.allSettled(adminTelegramIds.map((chatId) => this.bot.telegram.sendMessage(chatId,
      `⚠️ Delivery failed for ${order.orderCode}. Inventory remains reserved. Reason: ${reason}`)));
  }
}

function renderTemplate(template: string, payload: Record<string, unknown>) {
  return template.replace(/\{\{\s*([^{}]+?)\s*\}\}/gu, (_, key: string) => {
    const value = payload[key.trim()]; return value === undefined || value === null ? '' : String(value);
  });
}

function deliveryCopyKeyboard(message: string): Parameters<Telegram['sendMessage']>[2] {
  const parts = copyTextParts(message);
  const inline_keyboard = parts.map((text, index) => [{
    text: parts.length === 1 ? '📋 Sao chép tài khoản' : `📋 Sao chép ${index + 1}/${parts.length}`,
    copy_text: { text },
  }]);
  // Telegraf 4.16 bundles Bot API types older than copy_text, but forwards the
  // current Bot API object unchanged to Telegram.
  return { reply_markup: { inline_keyboard } } as unknown as Parameters<Telegram['sendMessage']>[2];
}

function copyTextParts(message: string) {
  const parts: string[] = [];
  for (let offset = 0; offset < message.length; offset += 256) parts.push(message.slice(offset, offset + 256));
  return parts;
}

function classifyTelegramError(error: unknown): 'TEMPORARY_CONFIRMED_FAILURE' | 'PERMANENT' | 'AMBIGUOUS' {
  const code = (error as { response?: { error_code?: number }; code?: string }).response?.error_code;
  if (code === 400 || code === 401 || code === 403) return 'PERMANENT';
  if (code === 429 || (code !== undefined && code >= 500)) return 'TEMPORARY_CONFIRMED_FAILURE';
  return 'AMBIGUOUS';
}

function safeErrorCode(error: unknown) {
  const response = (error as { response?: { error_code?: number; description?: string } }).response;
  if (response?.error_code) return `TELEGRAM_${response.error_code}:${(response.description ?? 'request failed').slice(0, 200)}`;
  return error instanceof UnrecoverableError ? error.message.slice(0, 500) : 'DELIVERY_SYSTEM_ERROR';
}
