import { randomBytes } from 'node:crypto';
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
    sendDocument?(chatId: string | number, document: Parameters<Telegram['sendDocument']>[1], extra?: Parameters<Telegram['sendDocument']>[2]): Promise<{ message_id: number }>;
    deleteMessage?(chatId: string | number, messageId: number): Promise<unknown>;
  };
}

export class DeliveryProcessor {
  private readonly encryption = EncryptionService.fromEnvironment();
  private readonly inventoryRepository = new InventoryRepository(InventoryItemModel);
  private readonly orderRepository = new OrderRepository(OrderModel);
  constructor(private readonly bot: TelegramBotClient,
    private readonly adminTelegramIds: string[] | (() => Promise<string[]>),
    private readonly publicBaseUrl = process.env.API_URL || process.env.WEB_APP_URL || '') {}

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
      ProductModel.findById(claimed.productId).select('name deliveryTemplate fieldDefinitions instructions warrantyPolicy warrantyDays').lean(),
      this.inventoryRepository.findForDelivery(orderId),
    ]);
    if (!user || !product || !inventory) throw new UnrecoverableError('Order delivery data is incomplete');
    let payload: Record<string, unknown>;
    try { payload = this.encryption.decrypt<Record<string, unknown>>(inventory.encryptedPayload); }
    catch { throw new UnrecoverableError('Inventory payload cannot be decrypted'); }
    const message = renderTemplate(product.deliveryTemplate, payload).trim();
    const accessToken = deliveryAccessToken(claimed.metadata);
    const baseUrl = this.publicBaseUrl.replace(/\/+$/, '');
    const deliveryUrl = baseUrl ? `${baseUrl}/delivery/${orderId.toString()}?token=${encodeURIComponent(accessToken)}` : '';
    const fileText = deliveryText({ orderCode: claimed.orderCode, productName: product.name, message,
      instructions: product.instructions, warrantyPolicy: product.warrantyPolicy, warrantyDays: product.warrantyDays });
    try {
      await OrderModel.updateOne({ _id: orderId }, { $set: { 'metadata.deliveryAccessToken': accessToken } });
      const sent = await this.bot.telegram.sendMessage(user.telegramId, deliveryNotice({
        productName: product.name, orderCode: claimed.orderCode, deliveryUrl,
      }), deliveryKeyboard(deliveryUrl));
      let documentMessageId: number | undefined;
      if (this.bot.telegram.sendDocument) {
        try {
          const document = await this.bot.telegram.sendDocument(user.telegramId, {
            source: Buffer.from(fileText, 'utf8'), filename: deliveryFilename(claimed.orderCode, product.name),
          }, { caption: `📄 File tài khoản cho ${claimed.orderCode}` });
          documentMessageId = document.message_id;
        } catch (error) {
          console.error({ event: 'delivery-document-send-failed', orderId: orderId.toString(), message: error instanceof Error ? error.message : 'unknown error' });
        }
      }
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          const sold = await this.inventoryRepository.markSold(inventory._id, user._id, orderId, session);
          if (!sold) {
            const alreadySold = await InventoryItemModel.exists({ _id: inventory._id, soldOrderId: orderId, status: InventoryStatus.SOLD }).session(session);
            if (!alreadySold) throw new Error('Inventory state changed during delivery');
          }
          await this.orderRepository.markDelivered(orderId, session);
          await OrderModel.updateOne({ _id: orderId }, { $set: { 'metadata.telegramMessageId': sent.message_id, ...(documentMessageId ? { 'metadata.telegramDocumentMessageId': documentMessageId } : {}) } }, { session });
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

function deliveryKeyboard(deliveryUrl: string): Parameters<Telegram['sendMessage']>[2] {
  const inline_keyboard = deliveryUrl ? [[
    { text: '🔐 Xem tài khoản trên web', url: deliveryUrl },
  ]] : undefined;
  return {
    ...(inline_keyboard ? { reply_markup: { inline_keyboard } } : {}),
    link_preview_options: { is_disabled: true },
  } as unknown as Parameters<Telegram['sendMessage']>[2];
}

function deliveryNotice(input: { productName: string; orderCode: string; deliveryUrl: string }) {
  return [
    '✅ Đã giao hàng thành công',
    `🛍 ${input.productName}`,
    `🧾 Mã đơn: ${input.orderCode}`,
    '',
    input.deliveryUrl ? 'Bấm nút bên dưới để xem tài khoản dạng đẹp trên web.' : 'File tài khoản được gửi ngay bên dưới.',
    'Bot cũng đính kèm file .txt để bạn tải/lưu trực tiếp.',
  ].join('\n');
}

function deliveryText(input: { orderCode: string; productName: string; message: string; instructions?: string; warrantyPolicy?: string; warrantyDays?: number }) {
  const blocks = [input.productName, `Mã đơn: ${input.orderCode}`, '', '=== TÀI KHOẢN ===', input.message];
  if (input.instructions?.trim()) blocks.push('', '=== HƯỚNG DẪN SỬ DỤNG ===', input.instructions.trim());
  if (input.warrantyPolicy?.trim() || Number(input.warrantyDays) > 0) blocks.push('', '=== BẢO HÀNH ===', [
    Number(input.warrantyDays) > 0 ? `Số ngày bảo hành: ${input.warrantyDays}` : '',
    input.warrantyPolicy?.trim() ?? '',
  ].filter(Boolean).join('\n'));
  return `${blocks.join('\n')}\n`;
}

function deliveryFilename(orderCode: string, productName: string) {
  const name = productName.toLowerCase().normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'tai-khoan';
  return `${orderCode}-${name}.txt`;
}

function deliveryAccessToken(metadata: Record<string, unknown> | undefined) {
  const existing = metadata?.deliveryAccessToken;
  return typeof existing === 'string' && /^[A-Za-z0-9_-]{24,128}$/.test(existing)
    ? existing
    : randomBytes(24).toString('base64url');
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
