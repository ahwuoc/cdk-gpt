import { Markup, Telegraf, type Context } from 'telegraf';
import { randomBytes } from 'node:crypto';
import type { Model } from 'mongoose';
import {
  BotSessionKind, BotSessionModel, CategoryModel, InventoryItemModel, OrderModel, ProductModel, SettingModel, UserModel,
  type BotSession, type Category, type InventoryItem, type Order, type Product, type Setting, type User,
} from '@store/database';
import { ComplaintCategory, DeliveryStatus, InventoryStatus, MAX_TELEGRAM_QUICK_CHECKOUT_QUANTITY, OrderStatus, ProductStatus, UserStatus,
  productDiscountPercent, type ComplaintCategoryValue } from '@store/shared';

/**
 * Models used by Telegram update handlers.
 *
 * The Docker worker continues to use the default Mongoose models. A serverless
 * webhook can pass the models owned by the initialized Nest connection instead
 * of relying on module-level global Mongoose models.
 */
export interface ShopBotDataContext {
  botSessions: Model<BotSession>;
  categories: Model<Category>;
  inventoryItems: Model<InventoryItem>;
  orders: Model<Order>;
  products: Model<Product>;
  settings: Model<Setting>;
  users: Model<User>;
}

const defaultDataContext: ShopBotDataContext = {
  botSessions: BotSessionModel,
  categories: CategoryModel,
  inventoryItems: InventoryItemModel,
  orders: OrderModel,
  products: ProductModel,
  settings: SettingModel,
  users: UserModel,
};

const inlineMenu = () => Markup.inlineKeyboard([
  [Markup.button.callback('🛍 Sản phẩm', 'menu:products'), Markup.button.callback('💰 Số dư', 'menu:balance')],
  [Markup.button.callback('💳 Nạp tiền', 'menu:deposit')],
  [Markup.button.callback('🎟 Voucher', 'menu:coupons')],
  [Markup.button.callback('📦 Đơn hàng của tôi', 'menu:orders'), Markup.button.callback('ℹ️ Hướng dẫn', 'menu:help')],
  [Markup.button.callback('🚨 Báo lỗi / Khiếu nại đơn', 'menu:reports')],
  [Markup.button.callback('💬 Liên hệ hỗ trợ', 'support:direct')],
]);

type PendingQuantity = { productId: string; categoryKey: string };
type PendingComplaint = { orderId: string; category: ComplaintCategoryValue };
type PendingComplaintReply = { reportId: string };

type CheckoutCart = {
  nonce: string; productId: string; productName: string; quantity: number; unitPrice: number;
  subtotal: number; discountAmount: number; totalAmount: number; couponCode?: string;
  paymentMethod: 'WALLET' | 'BANK_QR'; submitted: boolean;
};

type DepositResponse = {
  id?: string;
  requestCode?: string;
  amount?: number;
  receivedAmount?: number;
  status?: string;
  transferContent?: string;
  expiresAt?: string;
  qrUrl?: string;
  bank?: {
    bankId?: string;
    accountNo?: string;
    accountName?: string;
  };
  productId?: string;
  productName?: string;
  quantity?: number;
  unitPrice?: number;
  checkoutStatus?: string;
  subtotal?: number;
  discountAmount?: number;
  couponCode?: string;
  cancelled?: boolean;
  activeCheckoutId?: string;
  activeCheckoutCode?: string;
  checkout?: {
    productName?: string;
    quantity?: number;
    unitPrice?: number;
    totalAmount?: number;
    status?: string;
    orderCodes?: string[];
    fulfillmentError?: string;
  };
  historyCheck?: {
    status?: 'MATCHED' | 'NOT_FOUND' | 'COOLDOWN' | 'UNAVAILABLE' | 'NOT_NEEDED';
    retryAfterSeconds?: number;
  };
};

type OrderReportResponse = { id?: string; requestCode?: string; status?: string; existing?: boolean; message?: string | string[] };

export function createShopBot(
  token: string,
  apiUrl: string,
  botApiSecret: string,
  shopName: string,
  data: ShopBotDataContext = defaultDataContext,
) {
  const bot = new Telegraf(token);

  // Only named shopping events are collected. Never forward customer messages,
  // support content, credentials, or the entire Telegram update to analytics.
  bot.use(async (ctx, next) => {
    await next();
    await recordShoppingEvent(ctx, apiUrl, botApiSecret);
  });

  bot.start(async (ctx) => {
    await ensureUser(data, ctx.from.id.toString(), ctx.from.username, [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' '));
    const welcomeSetting = await data.settings.findOne({ key: 'shop.welcome_message' }).select('value').lean();
    const welcome = typeof welcomeSetting?.value === 'string' && welcomeSetting.value.trim()
      ? welcomeSetting.value.trim() : `👋 Chào mừng bạn đến với ${shopName}!`;
    await ctx.reply(`${welcome}\n\nChọn chức năng bên dưới để bắt đầu.`, inlineMenu());
  });

  bot.command('products', (ctx) => showProductCategories(ctx, data));
  bot.hears('🛍 Sản phẩm', (ctx) => showProductCategories(ctx, data));
  bot.action('menu:products', async (ctx) => { await ctx.answerCbQuery(); await showProductCategories(ctx, data); });
  bot.action(/^category:(uncategorized|[a-f\d]{24})$/, async (ctx) => {
    await ctx.answerCbQuery();
    await showProducts(ctx, ctx.match[1], data);
  });
  bot.action(/^select:([a-f\d]{24}):(uncategorized|[a-f\d]{24})$/, async (ctx) => {
    await ctx.answerCbQuery();
    await showQuantityOptions(ctx, ctx.match[1], ctx.match[2], data);
  });
  bot.action(/^qty:custom:([a-f\d]{24}):(uncategorized|[a-f\d]{24})$/, async (ctx) => {
    await ctx.answerCbQuery();
    if (!ctx.from || !ctx.chat) return;
    await savePendingInput(data, ctx.chat.id, ctx.from.id, BotSessionKind.PURCHASE_QUANTITY, {
      productId: ctx.match[1], categoryKey: ctx.match[2],
    });
    await ctx.reply(`✍️ Nhập số lượng muốn mua (tối đa ${maximumTelegramPurchaseQuantity()} mỗi lượt):`);
  });
  bot.action(/^qty:([a-f\d]{24}):(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery('Đang tính tổng tiền…');
    await purchaseQuantity(ctx, ctx.match[1], Number(ctx.match[2]), apiUrl, botApiSecret, data);
  });

  bot.action(/^cart:(pay|coupon|clear|refresh):([a-f\d]{24})$/, async (ctx) => {
    await ctx.answerCbQuery();
    if (!ctx.from || !ctx.chat) return;
    const pending = await data.botSessions.findOne({ chatId: String(ctx.chat.id), telegramUserId: String(ctx.from.id),
      kind: { $in: [BotSessionKind.CHECKOUT_CONFIRMATION, BotSessionKind.COUPON_CODE] },
      'data.nonce': ctx.match[2], expiresAt: { $gt: new Date() } }).lean();
    if (!pending || !isCheckoutCart(pending.data)) {
      await ctx.reply('⏱️ Báo giá này đã hết hạn hoặc được thay thế. Hãy chọn lại sản phẩm.', inlineMenu()); return;
    }
    const cart = pending.data;
    if (ctx.match[1] === 'pay') {
      await confirmCheckout(ctx, cart, apiUrl, botApiSecret, data); return;
    }
    if (cart.submitted) {
      await ctx.reply('ℹ️ Đơn này đã được gửi xử lý, không thể đổi mã giảm giá. Bấm xác nhận lại để kiểm tra cùng đơn, hoặc mở Đơn hàng.',
        Markup.inlineKeyboard([[Markup.button.callback('🔄 Kiểm tra cùng đơn', `cart:pay:${cart.nonce}`)],
          [Markup.button.callback('📦 Đơn hàng', 'menu:orders')]])); return;
    }
    if (ctx.match[1] === 'coupon') {
      const changed = await data.botSessions.findOneAndUpdate({ _id: pending._id, 'data.nonce': cart.nonce,
        'data.submitted': false }, { $set: { kind: BotSessionKind.COUPON_CODE } }, { new: true });
      if (changed) await ctx.reply('🎟 Nhập mã giảm giá của bạn (3–40 ký tự). Mã được kiểm tra trước khi thanh toán.',
        Markup.inlineKeyboard([[Markup.button.callback('↩️ Không dùng mã', `cart:clear:${cart.nonce}`)]]));
      return;
    }
    await quoteCart(ctx, cart.productId, cart.quantity, ctx.match[1] === 'clear' ? undefined : cart.couponCode,
      apiUrl, botApiSecret, data, cart.nonce);
  });

  bot.command('balance', (ctx) => showBalance(ctx, data));
  bot.hears('💰 Số dư', (ctx) => showBalance(ctx, data));
  bot.action('menu:balance', async (ctx) => { await ctx.answerCbQuery(); await showBalance(ctx, data); });
  bot.command('deposit', (ctx) => showDepositOptions(ctx));
  bot.command('nap', (ctx) => showDepositOptions(ctx));
  bot.hears('💳 Nạp tiền', (ctx) => showDepositOptions(ctx));
  bot.action('menu:deposit', async (ctx) => { await ctx.answerCbQuery(); await showDepositOptions(ctx); });
  bot.command('voucher', (ctx) => showCoupons(ctx, apiUrl, botApiSecret, data));
  bot.command('vouchers', (ctx) => showCoupons(ctx, apiUrl, botApiSecret, data));
  bot.hears('🎟 Voucher', (ctx) => showCoupons(ctx, apiUrl, botApiSecret, data));
  bot.action('menu:coupons', async (ctx) => { await ctx.answerCbQuery(); await showCoupons(ctx, apiUrl, botApiSecret, data); });
  bot.action(/^deposit:(\d{4,13})$/, async (ctx) => {
    await ctx.answerCbQuery('Đang tạo mã nạp tiền…');
    await createDeposit(ctx, Number(ctx.match[1]), apiUrl, botApiSecret, data);
  });
  bot.action('deposit:custom', async (ctx) => {
    await ctx.answerCbQuery();
    if (!ctx.from || !ctx.chat) return;
    await savePendingInput(data, ctx.chat.id, ctx.from.id, BotSessionKind.DEPOSIT_AMOUNT, {});
    await ctx.reply('✍️ Nhập số tiền muốn nạp (tối thiểu 1.000đ, ví dụ: 50000):');
  });
  bot.action(/^deposit:check:([a-f\d]{24})$/, async (ctx) => {
    await ctx.answerCbQuery('Đang kiểm tra giao dịch…');
    await checkDeposit(ctx, ctx.match[1], apiUrl, botApiSecret, data);
  });
  bot.action(/^checkout:check:([a-f\d]{24})$/, async (ctx) => {
    await ctx.answerCbQuery('Đang kiểm tra thanh toán…');
    await checkDeposit(ctx, ctx.match[1], apiUrl, botApiSecret, data, true);
  });
  bot.action(/^checkout:cancel-confirm:([a-f\d]{24})$/, async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply('⚠️ Chỉ hủy nếu bạn CHƯA chuyển khoản. Nếu đã chuyển, hãy giữ mã và bấm kiểm tra thanh toán.', {
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🗑 Xác nhận hủy mã', `checkout:cancel:${ctx.match[1]}`)],
        [Markup.button.callback('↩️ Giữ mã — kiểm tra tiền', `checkout:check:${ctx.match[1]}`)],
      ]),
    });
  });
  bot.action(/^checkout:cancel:([a-f\d]{24})$/, async (ctx) => {
    await ctx.answerCbQuery('Đang hủy mã thanh toán…');
    await cancelQuickCheckout(ctx, ctx.match[1], apiUrl, botApiSecret, data);
  });
  bot.action('menu:home', async (ctx) => { await ctx.answerCbQuery(); await ctx.reply('🏠 Menu chính', inlineMenu()); });

  bot.hears('📦 Đơn hàng của tôi', (ctx) => showOrders(ctx, data));
  bot.action('menu:orders', async (ctx) => { await ctx.answerCbQuery(); await showOrders(ctx, data); });
  bot.command('report', async (ctx) => {
    const orderCode = ctx.message.text.trim().split(/\s+/)[1];
    if (!orderCode) { await showReportMenu(ctx); return; }
    const order = await ownedOrderByCode(ctx, orderCode, data);
    if (!order) { await ctx.reply('❌ Không tìm thấy mã đơn thuộc tài khoản của bạn.', inlineMenu()); return; }
    await showComplaintReasons(ctx, order._id.toString(), data);
  });
  bot.action('menu:reports', async (ctx) => { await ctx.answerCbQuery(); await showReportMenu(ctx); });
  bot.action('report:recent', async (ctx) => { await ctx.answerCbQuery(); await showOrders(ctx, data, true); });
  bot.action('report:lookup', async (ctx) => {
    await ctx.answerCbQuery();
    if (!ctx.from || !ctx.chat) return;
    await savePendingInput(data, ctx.chat.id, ctx.from.id, BotSessionKind.ORDER_LOOKUP, {}, 10 * 60_000);
    await ctx.reply('🔎 Nhập mã đơn cũ cần khiếu nại (ví dụ: ORD-XXXXXXXX):');
  });
  bot.action(/^report:([a-f\d]{24})$/, async (ctx) => {
    await ctx.answerCbQuery();
    await showComplaintReasons(ctx, ctx.match[1], data);
  });
  bot.action(/^reportreason:([a-f\d]{24}):([A-Z_]+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    if (!ctx.from || !ctx.chat || !isComplaintCategory(ctx.match[2])) return;
    const order = await ownedOrder(ctx, ctx.match[1], data);
    if (!order) { await ctx.reply('❌ Không tìm thấy đơn hàng thuộc tài khoản của bạn.', inlineMenu()); return; }
    await savePendingInput(data, ctx.chat.id, ctx.from.id, BotSessionKind.ORDER_COMPLAINT,
      { orderId: order._id.toString(), category: ctx.match[2] }, 10 * 60_000);
    await ctx.reply(`✍️ Hãy mô tả chi tiết vấn đề của đơn *${order.orderCode}* (5–2.000 ký tự).\n\nKhông gửi mật khẩu hoặc thông tin nhạy cảm không cần thiết.`,
      { parse_mode: 'Markdown' });
  });
  bot.action(/^support:reply:([a-f\d]{24})$/, async (ctx) => {
    await ctx.answerCbQuery();
    if (!ctx.from || !ctx.chat) return;
    await savePendingInput(data, ctx.chat.id, ctx.from.id, BotSessionKind.COMPLAINT_REPLY,
      { reportId: ctx.match[1] }, 10 * 60_000);
    await ctx.reply('💬 Nhập nội dung muốn gửi thêm cho nhân viên hỗ trợ (tối đa 4.000 ký tự):');
  });
  bot.action('support:direct', async (ctx) => {
    await ctx.answerCbQuery();
    if (!ctx.from || !ctx.chat) return;
    await savePendingInput(data, ctx.chat.id, ctx.from.id, BotSessionKind.DIRECT_SUPPORT, {}, 10 * 60_000);
    await ctx.reply('💬 Nhập nội dung cần hỗ trợ. Shop sẽ đọc và trả lời trực tiếp tại đây:');
  });
  bot.hears('ℹ️ Hướng dẫn', (ctx) => showHelp(ctx));
  bot.action('menu:help', async (ctx) => { await ctx.answerCbQuery(); await showHelp(ctx); });
  bot.hears('🔄 Menu chính', async (ctx) => { await ctx.reply('🏠 Menu chính', inlineMenu()); });

  bot.action(/^buy:([a-f\d]{24})$/, async (ctx) => {
    await ctx.answerCbQuery('Đang xử lý đơn hàng…');
    await purchaseQuantity(ctx, ctx.match[1], 1, apiUrl, botApiSecret, data);
  });
  bot.command('buy', async (ctx) => {
    const productId = ctx.message.text.split(/\s+/)[1];
    await purchaseQuantity(ctx, productId, 1, apiUrl, botApiSecret, data);
  });

  bot.on('text', async (ctx) => {
    if (!ctx.from || !ctx.chat) return;
    const pending = await takePendingInput(data, ctx.chat.id, ctx.from.id);
    if (!pending) return;
    if (pending.expired) {
      if (pending.kind === BotSessionKind.COUPON_CODE) {
        await ctx.reply('⏱️ Báo giá đã hết hạn. Hãy chọn lại sản phẩm và nhập mã giảm giá.', inlineMenu());
      } else if (pending.kind === BotSessionKind.DEPOSIT_AMOUNT) {
        await ctx.reply('⏱️ Yêu cầu nhập số tiền đã hết hạn. Hãy chọn Nạp tiền lại.', inlineMenu());
      } else if (pending.kind === BotSessionKind.ORDER_LOOKUP) {
        await ctx.reply('⏱️ Yêu cầu tìm đơn đã hết hạn. Hãy mở Khiếu nại và thử lại.', inlineMenu());
      } else if (pending.kind === BotSessionKind.ORDER_COMPLAINT) {
        await ctx.reply('⏱️ Yêu cầu khiếu nại đã hết hạn. Hãy mở Đơn hàng và bấm Báo lỗi lại.', inlineMenu());
      } else if (pending.kind === BotSessionKind.COMPLAINT_REPLY || pending.kind === BotSessionKind.DIRECT_SUPPORT) {
        await ctx.reply('⏱️ Phiên nhắn tin hỗ trợ đã hết hạn. Hãy bấm Liên hệ hỗ trợ và thử lại.', inlineMenu());
      } else {
        await ctx.reply('⏱️ Yêu cầu nhập số lượng đã hết hạn. Hãy chọn lại sản phẩm.', inlineMenu());
      }
      return;
    }
    if (pending.kind === BotSessionKind.COUPON_CODE) {
      if (!isCheckoutCart(pending.data) || pending.data.submitted) return;
      const couponCode = ctx.message.text.trim().toUpperCase();
      if (!/^[A-Z0-9_-]{3,40}$/.test(couponCode)) {
        await ctx.reply('❌ Mã gồm 3–40 chữ cái, chữ số, dấu gạch ngang hoặc gạch dưới. Vui lòng nhập lại.'); return;
      }
      await quoteCart(ctx, pending.data.productId, pending.data.quantity, couponCode,
        apiUrl, botApiSecret, data, pending.data.nonce); return;
    }
    if (pending.kind === BotSessionKind.DEPOSIT_AMOUNT) {
      const amount = Number(ctx.message.text.trim());
      if (!Number.isSafeInteger(amount) || amount < 1_000 || amount > 9_999_999_999_999) {
        await ctx.reply('❌ Số tiền không hợp lệ. Vui lòng chọn lại Nạp tiền và nhập số nguyên từ 1.000đ.');
        return;
      }
      await createDeposit(ctx, amount, apiUrl, botApiSecret, data);
      return;
    }
    if (pending.kind === BotSessionKind.ORDER_LOOKUP) {
      const orderCode = ctx.message.text.trim().toUpperCase();
      if (!/^ORD-[A-Z0-9-]{8,40}$/.test(orderCode)) {
        await savePendingInput(data, ctx.chat.id, ctx.from.id, BotSessionKind.ORDER_LOOKUP, {}, 10 * 60_000);
        await ctx.reply('❌ Mã đơn không đúng định dạng. Hãy nhập lại mã bắt đầu bằng ORD-:');
        return;
      }
      const order = await ownedOrderByCode(ctx, orderCode, data);
      if (!order) {
        await savePendingInput(data, ctx.chat.id, ctx.from.id, BotSessionKind.ORDER_LOOKUP, {}, 10 * 60_000);
        await ctx.reply('❌ Không tìm thấy mã đơn thuộc tài khoản của bạn. Kiểm tra và nhập lại:');
        return;
      }
      await showComplaintReasons(ctx, order._id.toString(), data);
      return;
    }
    if (pending.kind === BotSessionKind.ORDER_COMPLAINT) {
      if (!isPendingComplaint(pending.data)) {
        await ctx.reply('❌ Phiên khiếu nại không hợp lệ. Hãy mở lại danh sách đơn hàng.', inlineMenu());
        return;
      }
      const description = ctx.message.text.trim();
      if (description.length < 5 || description.length > 2_000) {
        await savePendingInput(data, ctx.chat.id, ctx.from.id, BotSessionKind.ORDER_COMPLAINT, pending.data, 10 * 60_000);
        await ctx.reply('❌ Nội dung phải từ 5 đến 2.000 ký tự. Vui lòng nhập lại:');
        return;
      }
      await createOrderReport(ctx, pending.data, description, apiUrl, botApiSecret, data);
      return;
    }
    if (pending.kind === BotSessionKind.COMPLAINT_REPLY) {
      if (!isPendingComplaintReply(pending.data)) {
        await ctx.reply('❌ Phiên trả lời khiếu nại không hợp lệ.', inlineMenu()); return;
      }
      await sendComplaintReply(ctx, pending.data.reportId, ctx.message.text, apiUrl, botApiSecret, data);
      return;
    }
    if (pending.kind === BotSessionKind.DIRECT_SUPPORT) {
      await sendDirectSupport(ctx, ctx.message.text, apiUrl, botApiSecret, data);
      return;
    }
    if (!isPendingQuantity(pending.data)) {
      await ctx.reply('❌ Phiên mua hàng không hợp lệ. Hãy chọn lại sản phẩm.', inlineMenu());
      return;
    }
    const quantity = Number(ctx.message.text.trim());
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > maximumTelegramPurchaseQuantity()) {
      await ctx.reply(`❌ Số lượng không hợp lệ. Hãy nhập số nguyên từ 1 đến ${maximumTelegramPurchaseQuantity()}.`);
      return;
    }
    await purchaseQuantity(ctx, pending.data.productId, quantity, apiUrl, botApiSecret, data);
  });

  bot.catch((error) => console.error({ event: 'bot-handler-error', message: error instanceof Error ? error.message : 'unknown error' }));
  return bot;
}

async function showDepositOptions(ctx: Context) {
  await ctx.reply('💳 Nạp tiền vào ví\n\nChọn số tiền hoặc nhập số tiền khác. Sau khi chuyển khoản đúng nội dung, hệ thống sẽ tự cộng tiền vào ví.', {
    ...Markup.inlineKeyboard([
      [Markup.button.callback('10.000đ', 'deposit:10000'), Markup.button.callback('20.000đ', 'deposit:20000')],
      [Markup.button.callback('50.000đ', 'deposit:50000'), Markup.button.callback('100.000đ', 'deposit:100000')],
      [Markup.button.callback('500.000đ', 'deposit:500000'), Markup.button.callback('✍️ Nhập số khác', 'deposit:custom')],
      [Markup.button.callback('⬅️ Menu chính', 'menu:home')],
    ]),
  });
}

async function createDeposit(ctx: Context, amount: number, apiUrl: string, botApiSecret: string, data: ShopBotDataContext) {
  if (!ctx.from || !ctx.chat) return;
  if (!Number.isSafeInteger(amount) || amount < 1_000 || amount > 9_999_999_999_999) {
    await ctx.reply('❌ Số tiền nạp không hợp lệ.', inlineMenu());
    return;
  }
  const user = await ensureUser(data, ctx.from.id.toString(), ctx.from.username, [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' '));
  try {
    const response = await fetch(`${apiUrl}/api/bot/deposits`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-bot-secret': botApiSecret },
      // Telegram can retry an update; using its update id makes creation safely idempotent.
      body: JSON.stringify({ userId: user._id.toString(), amount, idempotencyKey: `topup:${ctx.chat.id}:${ctx.update.update_id}` }),
    });
    const body = await response.json().catch(() => ({})) as DepositResponse & { message?: string | string[] };
    if (!response.ok || !body.id || !body.transferContent || !body.qrUrl || !body.bank?.accountNo) {
      throw new Error(readErrorMessage(body.message, 'Không thể tạo yêu cầu nạp tiền.'));
    }
    const caption = [
      `💳 NẠP ${formatMoney(body.amount ?? amount)}`,
      '',
      `Ngân hàng: ${body.bank.bankId ?? '—'}`,
      `Số tài khoản: ${body.bank.accountNo}`,
      `Chủ tài khoản: ${body.bank.accountName ?? '—'}`,
      `Nội dung bắt buộc: ${body.transferContent}`,
      '',
      bankPollingHint(),
    ].join('\n');
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('🔄 Kiểm tra tiền', `deposit:check:${body.id}`)],
      [Markup.button.callback('💳 Nạp khoản khác', 'menu:deposit'), Markup.button.callback('🏠 Menu chính', 'menu:home')],
    ]);
    try {
      await ctx.replyWithPhoto(body.qrUrl, { caption, ...keyboard });
    } catch {
      await ctx.reply(`${caption}\n\nQR: ${body.qrUrl}`, keyboard);
    }
  } catch (error) {
    await ctx.reply(`❌ ${error instanceof Error ? error.message : 'Không thể tạo yêu cầu nạp tiền.'}`, inlineMenu());
  }
}

async function createQuickCheckout(ctx: Context, input: { userId: string; productId: string; productName: string;
  quantity: number; unitPrice: number; couponCode?: string; totalAmount?: number; discountAmount?: number; nonce?: string }, apiUrl: string, botApiSecret: string) {
  if (!ctx.chat) return;
  try {
    const response = await fetch(`${apiUrl}/api/bot/checkouts`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-bot-secret': botApiSecret },
      body: JSON.stringify({ userId: input.userId, productId: input.productId, quantity: input.quantity,
        expectedUnitPrice: input.unitPrice,
        couponCode: input.couponCode, expectedTotalAmount: input.totalAmount,
        idempotencyKey: `checkout:${ctx.chat.id}:${input.nonce ?? ctx.update.update_id}:${input.productId}:${input.quantity}` }),
    });
    const body = await response.json().catch(() => ({})) as DepositResponse & { message?: string | string[] };
    if (!response.ok && body.activeCheckoutId) {
      await ctx.reply(`⚠️ ${readErrorMessage(body.message, 'Bạn đang có một mã thanh toán chưa xử lý.')}`, {
        ...Markup.inlineKeyboard([
          [Markup.button.callback('✅ Kiểm tra mã hiện tại', `checkout:check:${body.activeCheckoutId}`)],
          [Markup.button.callback('🗑 Hủy mã hiện tại', `checkout:cancel-confirm:${body.activeCheckoutId}`)],
          [Markup.button.callback('🏠 Menu chính', 'menu:home')],
        ]),
      });
      return;
    }
    if (!response.ok || !body.id) {
      throw new Error(readErrorMessage(body.message, 'Không thể tạo mã thanh toán nhanh.'));
    }
    // A retried confirmation returns the original payment request, which may
    // already be paid or cancelled. Never ask the buyer to transfer again.
    if (body.status === 'APPROVED' || body.checkoutStatus === 'FULFILLED' || body.checkoutStatus === 'PROCESSING') {
      await ctx.reply('✅ Mã thanh toán này đã được ghi nhận hoặc đang xử lý. Không chuyển khoản thêm. Bấm kiểm tra để xem đơn hàng hoặc số tiền đã được cộng vào ví.',
        Markup.inlineKeyboard([[Markup.button.callback('🔄 Kiểm tra thanh toán cũ', 'checkout:check:' + body.id)],
          [Markup.button.callback('📦 Đơn hàng', 'menu:orders')]])); return;
    }
    const expired = !!body.expiresAt && new Date(body.expiresAt).getTime() <= Date.now();
    if (body.status !== 'PENDING' || body.checkoutStatus !== 'PENDING_PAYMENT' || body.cancelled || expired) {
      await ctx.reply('⏱️ Mã thanh toán này đã hết hạn, bị hủy hoặc không còn chờ thanh toán. Không chuyển tiền vào mã cũ. Nếu đã chuyển, hãy kiểm tra giao dịch; nếu chưa, chọn sản phẩm để tạo đơn mới.',
        Markup.inlineKeyboard([[Markup.button.callback('🔄 Kiểm tra giao dịch cũ', 'checkout:check:' + body.id)],
          [Markup.button.callback('🛍 Chọn sản phẩm', 'menu:products')]])); return;
    }
    if (!body.transferContent || !body.qrUrl || !body.bank?.accountNo) {
      throw new Error('Thông tin QR chưa đầy đủ. Hãy kiểm tra lại cùng đơn.');
    }
    const total = body.amount ?? input.unitPrice * input.quantity;
    const caption = [
      '⚡ THANH TOÁN ĐƠN HÀNG',
      `🛍 ${body.productName ?? input.productName}`,
      `📦 ${body.quantity ?? input.quantity} × ${formatMoney(body.unitPrice ?? input.unitPrice)}`,
      ...((body.couponCode ?? input.couponCode) ? [`🎟 Mã ${body.couponCode ?? input.couponCode}: −${formatMoney(body.discountAmount ?? input.discountAmount ?? 0)}`] : []),
      `💵 CẦN CHUYỂN: ${formatMoney(total)}`, '',
      `🏦 ${body.bank.bankId ?? '—'} · ${body.bank.accountNo}`,
      `👤 ${body.bank.accountName ?? '—'}`,
      `📝 Nội dung: ${body.transferContent}`,
      body.expiresAt ? `⏰ Hạn: ${formatDeadline(body.expiresAt)}` : '⏰ Thanh toán trước khi mã hết hạn.', '',
      '✅ Chuyển đúng số tiền + nội dung.',
      '👇 Chuyển xong hãy bấm “Kiểm tra & nhận hàng”.',
    ].join('\n');
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('✅ Đã chuyển — Kiểm tra & nhận hàng', `checkout:check:${body.id}`)],
      [Markup.button.callback('🗑 Hủy mã thanh toán', `checkout:cancel-confirm:${body.id}`)],
      [Markup.button.callback('🛍 Chọn sản phẩm khác', 'menu:products'), Markup.button.callback('🏠 Menu chính', 'menu:home')],
    ]);
    try {
      const sent = await ctx.replyWithPhoto(body.qrUrl, { caption, ...keyboard });
      await rememberCheckoutPrompt(apiUrl, botApiSecret, body.id, input.userId, ctx.chat.id, sent.message_id);
    } catch {
      const sent = await ctx.reply(`${caption}\n\nQR: ${body.qrUrl}`, keyboard);
      await rememberCheckoutPrompt(apiUrl, botApiSecret, body.id, input.userId, ctx.chat.id, sent.message_id);
    }
  } catch (error) {
    await ctx.reply(`❌ ${error instanceof Error ? error.message : 'Không thể tạo mã thanh toán nhanh.'}`, inlineMenu());
  }
}

async function checkDeposit(ctx: Context, requestId: string, apiUrl: string, botApiSecret: string,
  data: ShopBotDataContext, quickCheckout = false) {
  if (!ctx.from) return;
  const user = await ensureUser(data, ctx.from.id.toString(), ctx.from.username, [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' '));
  try {
    const response = await fetch(`${apiUrl}/api/bot/deposits/${requestId}/check`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-bot-secret': botApiSecret },
      body: JSON.stringify({ userId: user._id.toString() }),
    });
    const body = await response.json().catch(() => ({})) as DepositResponse & { message?: string | string[] };
    if (!response.ok || !body.status) throw new Error(readErrorMessage(body.message, 'Không thể kiểm tra giao dịch.'));
    if (body.status === 'APPROVED') {
      const receivedAmount = body.receivedAmount ?? body.amount ?? 0;
      if (body.checkout?.status === 'FULFILLED') {
        await clearPaidPrompt(ctx);
        const orderCodes = body.checkout.orderCodes?.length ? `\nMã đơn: ${body.checkout.orderCodes.join(', ')}` : '';
        await ctx.reply(`✅ Thanh toán thành công ${formatMoney(receivedAmount)}\n🛍 *${markdownEscape(body.checkout.productName ?? 'Sản phẩm')}* × ${body.checkout.quantity ?? 0}${orderCodes}\n\n📦 Tài khoản đang được gửi ngay bên dưới.`,
          { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[
            Markup.button.callback('📦 Xem đơn hàng', 'menu:orders'), Markup.button.callback('🏠 Menu chính', 'menu:home'),
          ]]) });
        return;
      }
      if (body.checkout?.status === 'FAILED') {
        await clearPaidPrompt(ctx);
        const refreshed = await data.users.findById(user._id).select('walletBalance').lean();
        await ctx.reply(`⚠️ Đã nhận ${formatMoney(receivedAmount)} nhưng chưa thể tạo đơn tự động.\n\n${body.checkout.fulfillmentError ?? 'Vui lòng chọn mua lại.'}\nSố tiền hiện nằm trong ví: ${formatMoney(refreshed?.walletBalance ?? user.walletBalance)}.`, {
          ...Markup.inlineKeyboard([[Markup.button.callback('🛍 Chọn mua lại', 'menu:products'),
            Markup.button.callback('💰 Xem số dư', 'menu:balance')]]),
        });
        return;
      }
      if (body.checkout) {
        await ctx.reply('⏳ Đã nhận tiền và đang tạo đơn. Hãy chờ hàng được gửi hoặc bấm kiểm tra lại sau ít phút.', {
          ...Markup.inlineKeyboard([[Markup.button.callback('🔄 Kiểm tra lại', `checkout:check:${requestId}`)],
            [Markup.button.callback('🏠 Menu chính', 'menu:home')]]),
        });
        return;
      }
      await clearPaidPrompt(ctx);
      const refreshed = await data.users.findById(user._id).select('walletBalance').lean();
      await ctx.reply(`✅ Đã nhận ${formatMoney(receivedAmount)}. Số dư hiện tại: ${formatMoney(refreshed?.walletBalance ?? user.walletBalance)}.`, {
        ...Markup.inlineKeyboard([[Markup.button.callback('💰 Xem số dư', 'menu:balance'),
          Markup.button.callback('🏠 Menu chính', 'menu:home')]]),
      });
      return;
    }
    if (body.cancelled) {
      await ctx.reply('🗑 Mã thanh toán này đã được hủy. Bạn có thể chọn sản phẩm và tạo mã mới.', {
        ...Markup.inlineKeyboard([[Markup.button.callback('🛍 Chọn sản phẩm', 'menu:products')],
          [Markup.button.callback('🏠 Menu chính', 'menu:home')]]),
      });
      return;
    }
    if (body.status === 'EXPIRED') {
      if (body.historyCheck?.status === 'UNAVAILABLE') {
        await ctx.reply('⚠️ Mã đã hết hạn và API lịch sử Cake đang tạm thời không phản hồi. Nếu bạn đã chuyển tiền, hãy thử kiểm tra lại sau; callback vẫn được xử lý tự động khi gửi tới.', {
          ...Markup.inlineKeyboard([[Markup.button.callback('🔄 Kiểm tra lại', `${quickCheckout ? 'checkout' : 'deposit'}:check:${requestId}`)],
            [Markup.button.callback('🏠 Menu chính', 'menu:home')]]),
        });
        return;
      }
      await ctx.reply('⌛ Mã nạp tiền này đã hết hạn. Hãy tạo yêu cầu nạp mới.', inlineMenu());
      return;
    }
    const pendingMessage = body.historyCheck?.status === 'UNAVAILABLE'
      ? `⚠️ API lịch sử Cake đang tạm thời không phản hồi. Chưa thể đối soát ${formatMoney(body.amount ?? 0)}; callback tự động vẫn hoạt động, bạn hãy thử lại sau.`
      : body.historyCheck?.status === 'COOLDOWN'
        ? `⏱ Bạn vừa kiểm tra. Hãy đợi khoảng ${body.historyCheck.retryAfterSeconds ?? 10} giây rồi thử lại để tránh gửi quá nhiều yêu cầu.`
        : `⏳ Đã dò lịch sử nhưng chưa thấy giao dịch ${formatMoney(body.amount ?? 0)} đúng nội dung. Hãy chuyển đúng số tiền và nội dung, rồi thử lại sau ít phút.`;
    await ctx.reply(pendingMessage, {
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🔄 Kiểm tra lại', `${quickCheckout ? 'checkout' : 'deposit'}:check:${requestId}`)],
        ...(quickCheckout ? [[Markup.button.callback('🗑 Hủy mã thanh toán', `checkout:cancel-confirm:${requestId}`)]] : []),
        [Markup.button.callback(quickCheckout ? '🛍 Sản phẩm' : '💳 Nạp khoản khác', quickCheckout ? 'menu:products' : 'menu:deposit'),
          Markup.button.callback('🏠 Menu chính', 'menu:home')],
      ]),
    });
  } catch (error) {
    await ctx.reply(`❌ ${error instanceof Error ? error.message : 'Không thể kiểm tra giao dịch.'}`, inlineMenu());
  }
}

async function cancelQuickCheckout(ctx: Context, requestId: string, apiUrl: string, botApiSecret: string,
  data: ShopBotDataContext) {
  if (!ctx.from) return;
  const user = await ensureUser(data, ctx.from.id.toString(), ctx.from.username,
    [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' '));
  try {
    const response = await fetch(`${apiUrl}/api/bot/checkouts/${requestId}/cancel`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-bot-secret': botApiSecret },
      body: JSON.stringify({ userId: user._id.toString() }),
    });
    const body = await response.json().catch(() => ({})) as DepositResponse & { message?: string | string[] };
    if (!response.ok) throw new Error(readErrorMessage(body.message, 'Không thể hủy mã thanh toán.'));
    if (body.cancelled) {
      await ctx.reply('✅ Đã hủy mã thanh toán. Hàng không bị giữ và bạn có thể tạo đơn mới ngay.', {
        ...Markup.inlineKeyboard([[Markup.button.callback('🛍 Chọn sản phẩm khác', 'menu:products')],
          [Markup.button.callback('🏠 Menu chính', 'menu:home')]]),
      });
      return;
    }
    if (body.status === 'APPROVED') {
      await ctx.reply('⚠️ Khoản thanh toán đã được ghi nhận nên không thể hủy. Hãy kiểm tra để nhận trạng thái đơn.', {
        ...Markup.inlineKeyboard([[Markup.button.callback('✅ Kiểm tra & nhận hàng', `checkout:check:${requestId}`)],
          [Markup.button.callback('🏠 Menu chính', 'menu:home')]]),
      });
      return;
    }
    await ctx.reply('⌛ Mã thanh toán đã hết hạn hoặc không còn ở trạng thái chờ.', inlineMenu());
  } catch (error) {
    await ctx.reply(`❌ ${error instanceof Error ? error.message : 'Không thể hủy mã thanh toán.'}`, inlineMenu());
  }
}

async function rememberCheckoutPrompt(apiUrl: string, botApiSecret: string, requestId: string, userId: string,
  chatId: string | number, messageId: number) {
  try {
    const response = await fetch(`${apiUrl}/api/bot/checkouts/${requestId}/prompt`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-bot-secret': botApiSecret },
      body: JSON.stringify({ userId, chatId: String(chatId), messageId }),
    });
    if (!response.ok) console.error({ event: 'checkout-prompt-save-failed', requestId, status: response.status });
  } catch (error) {
    console.error({ event: 'checkout-prompt-save-failed', requestId,
      message: error instanceof Error ? error.message : 'unknown error' });
  }
}

async function clearPaidPrompt(ctx: Context) {
  try { await ctx.deleteMessage(); return; } catch { /* The delivery worker may already have removed the QR. */ }
  try { await ctx.editMessageReplyMarkup({ inline_keyboard: [] }); } catch { /* Old prompt can safely remain read-only. */ }
}

function readErrorMessage(message: unknown, fallback: string) {
  if (typeof message === 'string' && message.trim()) return message;
  if (Array.isArray(message)) return message.filter((item): item is string => typeof item === 'string').join(', ') || fallback;
  return fallback;
}

async function showProductCategories(ctx: Context, data: ShopBotDataContext) {
  const products = await data.products.find({ status: ProductStatus.ACTIVE, deletedAt: null })
    .select('categoryId').sort({ sortOrder: 1, createdAt: -1 }).limit(500).lean();
  if (!products.length) { await ctx.reply('Hiện chưa có sản phẩm đang bán.', inlineMenu()); return; }

  const categoryIds = [...new Set(products.map((product) => product.categoryId?.toString()).filter((id): id is string => Boolean(id)))];
  const categories = await data.categories.find({ _id: { $in: categoryIds }, deletedAt: null })
    .select('name sortOrder').sort({ sortOrder: 1, name: 1 }).lean();
  const categoryNames = new Map(categories.map((category) => [category._id.toString(), category.name]));
  const counts = new Map<string, number>();
  for (const product of products) {
    const id = product.categoryId?.toString();
    const key = id && categoryNames.has(id) ? id : 'uncategorized';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const buttons = categories
    .filter((category) => counts.has(category._id.toString()))
    .map((category) => [Markup.button.callback(`📂 ${category.name} (${counts.get(category._id.toString())})`, `category:${category._id.toString()}`)]);
  if (counts.has('uncategorized')) {
    buttons.push([Markup.button.callback(`📁 Chưa phân loại (${counts.get('uncategorized')})`, 'category:uncategorized')]);
  }
  buttons.push([Markup.button.callback('⬅️ Menu chính', 'menu:home'), Markup.button.callback('🔄 Cập nhật', 'menu:products')]);
  await ctx.reply('🛍 *Danh mục sản phẩm*\n\nChọn một danh mục để xem các sản phẩm bên trong:', { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
}

async function showProducts(ctx: Context, categoryKey: string, data: ShopBotDataContext) {
  const filter: Record<string, unknown> = { status: ProductStatus.ACTIVE, deletedAt: null };
  let categoryName = 'Chưa phân loại';
  let categoryDescription = '';
  if (categoryKey === 'uncategorized') {
    filter.$or = [{ categoryId: null }, { categoryId: { $exists: false } }];
  } else {
    filter.categoryId = categoryKey;
    const category = await data.categories.findOne({ _id: categoryKey, deletedAt: null }).select('name description').lean();
    if (!category) { await ctx.reply('Danh mục không còn tồn tại.', inlineMenu()); return; }
    categoryName = category.name; categoryDescription = category.description?.trim() ?? '';
  }

  const products = await data.products.find(filter).select('name price originalPrice').sort({ sortOrder: 1, createdAt: -1 }).limit(50).lean();
  const categoryHeading = markdownEscape(categoryName);
  const categoryDetails = descriptionBlock(categoryDescription, 1_000);
  if (!products.length) {
    await ctx.reply(`📂 *${categoryHeading}*${categoryDetails}\n\nDanh mục này hiện chưa có sản phẩm.`, { parse_mode: 'Markdown', ...Markup.inlineKeyboard([
      [Markup.button.callback('⬅️ Danh mục', 'menu:products')],
    ]) });
    return;
  }
  const stockRows = await data.inventoryItems.aggregate<{ _id: string; count: number }>([
    { $match: sellableInventoryFilter({ $in: products.map((product) => product._id) }) },
    { $group: { _id: '$productId', count: { $sum: 1 } } },
  ]);
  const stockByProduct = new Map(stockRows.map((row) => [row._id.toString(), row.count]));
  const buttons = products.map((product) => {
    const discount = productDiscountPercent(product.price, product.originalPrice);
    return [Markup.button.callback(
      `🛒 ${product.name.slice(0, 28)} · ${discount ? `🔥-${discount}% · ` : ''}${formatMoney(product.price)} · Còn ${stockByProduct.get(product._id.toString()) ?? 0}`,
      `select:${product._id.toString()}:${categoryKey}`)];
  });
  buttons.push([Markup.button.callback('⬅️ Danh mục', 'menu:products'), Markup.button.callback('🔄 Cập nhật', `category:${categoryKey}`)]);
  await ctx.reply(`📂 *${categoryHeading}*${categoryDetails}\n\nChọn sản phẩm để mua:`, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
}

async function showQuantityOptions(ctx: Context, productId: string, categoryKey: string, data: ShopBotDataContext) {
  const product = await data.products.findOne({ _id: productId, status: ProductStatus.ACTIVE, deletedAt: null }).select('name price originalPrice description').lean();
  if (!product) { await ctx.reply('Không tìm thấy sản phẩm.', inlineMenu()); return; }
  const available = await data.inventoryItems.countDocuments(sellableInventoryFilter(productId));
  if (!available) {
    await ctx.reply(`❌ *${product.name}* hiện đã hết hàng.`, { parse_mode: 'Markdown', ...Markup.inlineKeyboard([
      [Markup.button.callback('⬅️ Danh mục', 'menu:products')],
    ]) });
    return;
  }
  const maxQuickQuantity = Math.min(5, available);
  const quickButtons = Array.from({ length: maxQuickQuantity }, (_, index) =>
    Markup.button.callback(`Mua ${index + 1}`, `qty:${productId}:${index + 1}`));
  const rows = [quickButtons];
  rows.push([Markup.button.callback(`✍️ Nhập số lượng khác (≤${maximumTelegramPurchaseQuantity()})`, `qty:custom:${productId}:${categoryKey}`)]);
  rows.push([Markup.button.callback('⬅️ Danh mục', 'menu:products')]);
  await ctx.reply(`🛍 <b>${htmlEscape(product.name)}</b>${htmlDescriptionBlock(product.description, 2_500)}\n\n${salePriceBlock(product.price, product.originalPrice)}\n📦 Còn ${available} sản phẩm\n\nChọn số lượng muốn mua:`, {
    parse_mode: 'HTML', ...Markup.inlineKeyboard(rows),
  });
}

async function showBalance(ctx: Context, data: ShopBotDataContext) {
  if (!ctx.from) return;
  const user = await ensureUser(data, ctx.from.id.toString(), ctx.from.username, ctx.from.first_name);
  await ctx.reply(`💰 Số dư ví của bạn: *${formatMoney(user.walletBalance)}*`, { parse_mode: 'Markdown', ...inlineMenu() });
}

interface AvailableCoupon {
  code: string;
  type: 'PERCENT' | 'FIXED';
  value: number;
  minSubtotal: number;
  maxDiscount?: number | null;
  endsAt?: string | null;
  remainingUses?: number | null;
  remainingUserUses: number;
  productIds?: string[];
  products?: Array<{ id: string; name: string }>;
}

async function showCoupons(ctx: Context, apiUrl: string, botApiSecret: string, data: ShopBotDataContext) {
  if (!ctx.from) return;
  try {
    const user = await ensureUser(data, ctx.from.id.toString(), ctx.from.username, ctx.from.first_name);
    const query = new URLSearchParams({ userId: user._id.toString(), page: '1', limit: '5' });
    const response = await fetch(`${apiUrl}/api/bot/coupons?${query.toString()}`, {
      headers: { 'x-bot-secret': botApiSecret }, signal: AbortSignal.timeout(10_000),
    });
    const body = await response.json() as { items?: AvailableCoupon[]; message?: string | string[] };
    if (!response.ok) throw new Error(readErrorMessage(body.message, 'Không thể tải danh sách voucher.'));
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) {
      await ctx.reply('🎟 Hiện chưa có voucher phù hợp với tài khoản của bạn.', inlineMenu());
      return;
    }
    const lines = items.map((coupon) => {
      const discount = coupon.type === 'PERCENT'
        ? `Giảm ${coupon.value}%${coupon.maxDiscount ? ` tối đa ${formatMoney(coupon.maxDiscount)}` : ''}`
        : `Giảm ${formatMoney(coupon.value)}`;
      const minimum = coupon.minSubtotal > 0 ? ` · Đơn từ ${formatMoney(coupon.minSubtotal)}` : '';
      const expiry = coupon.endsAt ? ` · HSD ${formatDeadline(coupon.endsAt)}` : '';
      const remaining = Number.isSafeInteger(coupon.remainingUserUses) ? ` · Còn ${coupon.remainingUserUses} lượt` : '';
      const scope = coupon.productIds?.length
        ? `\n   Áp dụng: ${coupon.products?.length ? coupon.products.map((product) => markdownEscape(product.name)).join(', ') : 'sản phẩm được chọn'}`
        : '\n   Áp dụng cho mọi sản phẩm';
      return `🎟 *${markdownEscape(coupon.code)}* — ${discount}${minimum}${expiry}${remaining}${scope}`;
    });
    await ctx.reply(`🎟 *Voucher đang có*\n\n${lines.join('\n\n')}\n\nKhi mua hàng, bấm *Nhập mã giảm giá* rồi gửi mã voucher.`, {
      parse_mode: 'Markdown', ...Markup.inlineKeyboard([
        [Markup.button.callback('🛍 Xem sản phẩm', 'menu:products')],
        [Markup.button.callback('🏠 Menu chính', 'menu:home')],
      ]),
    });
  } catch (error) {
    await ctx.reply(`❌ ${error instanceof Error ? error.message : 'Không thể tải danh sách voucher.'}`, inlineMenu());
  }
}

async function showOrders(ctx: Context, data: ShopBotDataContext, reporting = false) {
  if (!ctx.from) return;
  const user = await ensureUser(data, ctx.from.id.toString(), ctx.from.username, ctx.from.first_name);
  const limit = reporting ? 5 : 10;
  const orders = await data.orders.find({ userId: user._id }).sort({ createdAt: -1 }).limit(limit).lean();
  if (!orders.length) { await ctx.reply('📦 Bạn chưa có đơn hàng nào.', inlineMenu()); return; }
  const products = await data.products.find({ _id: { $in: orders.map((order) => order.productId) } }).select('name').lean();
  const names = new Map(products.map((product) => [product._id.toString(), product.name]));
  const lines = orders.map((order) => `${statusIcon(order.deliveryStatus)} *${order.orderCode}* · ${names.get(order.productId.toString()) ?? 'Sản phẩm'} · ${formatMoney(order.totalAmount)}`);
  const buttons = orders.map((order) => [Markup.button.callback(
    `🚨 Báo lỗi ${order.orderCode}`, `report:${order._id.toString()}`)]);
  buttons.push([Markup.button.callback('🔎 Khiếu nại đơn cũ bằng mã đơn', 'report:lookup')]);
  buttons.push([Markup.button.callback('🏠 Menu chính', 'menu:home')]);
  const heading = reporting ? '🚨 *5 đơn mới nhất*' : '📦 *10 đơn gần nhất*';
  await ctx.reply(`${heading}\n\n${lines.join('\n')}\n\nBấm nút tương ứng nếu đơn hàng gặp vấn đề.`, {
    parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons),
  });
}

async function showReportMenu(ctx: Context) {
  await ctx.reply('🚨 *Báo lỗi / Khiếu nại đơn*\n\nChọn cách tìm đơn hàng cần hỗ trợ:', {
    parse_mode: 'Markdown', ...Markup.inlineKeyboard([
      [Markup.button.callback('🧾 Chọn trong 5 đơn mới nhất', 'report:recent')],
      [Markup.button.callback('🔎 Nhập mã đơn', 'report:lookup')],
      [Markup.button.callback('🏠 Menu chính', 'menu:home')],
    ]),
  });
}

async function showComplaintReasons(ctx: Context, orderId: string, data: ShopBotDataContext) {
  const order = await ownedOrder(ctx, orderId, data);
  if (!order) { await ctx.reply('❌ Không tìm thấy đơn hàng thuộc tài khoản của bạn.', inlineMenu()); return; }
  const callback = (category: ComplaintCategoryValue) => `reportreason:${orderId}:${category}`;
  await ctx.reply(`🚨 *Khiếu nại đơn ${order.orderCode}*\n\nChọn vấn đề bạn đang gặp:`, {
    parse_mode: 'Markdown', ...Markup.inlineKeyboard([
      [Markup.button.callback('📭 Chưa nhận được hàng', callback(ComplaintCategory.NO_DELIVERY))],
      [Markup.button.callback('🔐 Tài khoản không đăng nhập được', callback(ComplaintCategory.INVALID_CREDENTIALS))],
      [Markup.button.callback('📦 Sản phẩm không đúng mô tả', callback(ComplaintCategory.PRODUCT_MISMATCH))],
      [Markup.button.callback('🛡 Yêu cầu bảo hành', callback(ComplaintCategory.WARRANTY))],
      [Markup.button.callback('📝 Vấn đề khác', callback(ComplaintCategory.OTHER))],
      [Markup.button.callback('⬅️ Tùy chọn khiếu nại', 'menu:reports')],
    ]),
  });
}

async function createOrderReport(ctx: Context, pending: PendingComplaint, description: string,
  apiUrl: string, botApiSecret: string, data: ShopBotDataContext) {
  if (!ctx.from) return;
  const user = await ensureUser(data, ctx.from.id.toString(), ctx.from.username, ctx.from.first_name);
  try {
    const response = await fetch(`${apiUrl}/api/bot/order-reports`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-bot-secret': botApiSecret },
      body: JSON.stringify({ userId: user._id.toString(), orderId: pending.orderId,
        category: pending.category, description }),
    });
    const body = await response.json().catch(() => ({})) as OrderReportResponse;
    if (!response.ok || !body.id || !body.requestCode) {
      throw new Error(readErrorMessage(body.message, 'Không thể gửi khiếu nại.'));
    }
    const prefix = body.existing ? 'ℹ️ Đơn này đã có khiếu nại đang xử lý.' : '✅ Đã gửi khiếu nại thành công.';
    await ctx.reply(`${prefix}\n\nMã khiếu nại: *${body.requestCode}*\nTrạng thái: ${reportStatusLabel(body.status)}\n\nShop sẽ kiểm tra và xử lý sớm nhất.`, {
      parse_mode: 'Markdown', ...Markup.inlineKeyboard([
        [Markup.button.callback('💬 Nhắn thêm cho hỗ trợ', `support:reply:${body.id}`)],
        [Markup.button.callback('🏠 Menu chính', 'menu:home')],
      ]),
    });
  } catch (error) {
    await ctx.reply(`❌ ${error instanceof Error ? error.message : 'Không thể gửi khiếu nại.'}`, inlineMenu());
  }
}

async function ownedOrder(ctx: Context, orderId: string, data: ShopBotDataContext) {
  if (!ctx.from) return null;
  const user = await ensureUser(data, ctx.from.id.toString(), ctx.from.username, ctx.from.first_name);
  return data.orders.findOne({ _id: orderId, userId: user._id }).select('_id orderCode').lean();
}

async function ownedOrderByCode(ctx: Context, orderCode: string, data: ShopBotDataContext) {
  if (!ctx.from) return null;
  const user = await ensureUser(data, ctx.from.id.toString(), ctx.from.username, ctx.from.first_name);
  return data.orders.findOne({ orderCode: orderCode.trim().toUpperCase(), userId: user._id }).select('_id orderCode').lean();
}

async function showHelp(ctx: Context) {
  await ctx.reply('ℹ️ *Hướng dẫn nhanh*\n\n1. Chọn *Sản phẩm* và số lượng cần mua.\n2. Nhập mã giảm giá nếu có, kiểm tra tổng tiền rồi *xác nhận*.\n3. Nếu ví đủ tiền, bot trừ ví; nếu chưa đủ, bot tạo QR đúng tổng tiền sau giảm giá. Chuyển đúng số tiền và nội dung QR để nhận hàng tự động.\n4. Nếu đơn gặp lỗi, chọn *Báo lỗi / Khiếu nại đơn*.\n\nBạn cũng có thể dùng /products, /balance, /buy <productId> hoặc /report <mã đơn>.', { parse_mode: 'Markdown', ...inlineMenu() });
}

async function sendComplaintReply(ctx: Context, reportId: string, rawBody: string,
  apiUrl: string, botApiSecret: string, data: ShopBotDataContext) {
  if (!ctx.from) return;
  const body = rawBody.trim();
  if (!body || body.length > 4_000) { await ctx.reply('❌ Nội dung phải từ 1 đến 4.000 ký tự.', inlineMenu()); return; }
  const user = await ensureUser(data, ctx.from.id.toString(), ctx.from.username, ctx.from.first_name);
  try {
    const response = await fetch(`${apiUrl}/api/bot/order-reports/${reportId}/messages`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-bot-secret': botApiSecret },
      body: JSON.stringify({ userId: user._id.toString(), body,
        idempotencyKey: `complaint-reply:${ctx.chat?.id ?? ctx.from.id}:${ctx.update.update_id}` }),
    });
    const result = await response.json().catch(() => ({})) as { message?: string | string[] };
    if (!response.ok) throw new Error(readErrorMessage(result.message, 'Không thể gửi phản hồi.'));
    await ctx.reply('✅ Đã gửi tin nhắn vào cuộc hội thoại khiếu nại. Shop sẽ phản hồi tại đây.', inlineMenu());
  } catch (error) {
    await ctx.reply(`❌ ${error instanceof Error ? error.message : 'Không thể gửi phản hồi.'}`, inlineMenu());
  }
}

async function sendDirectSupport(ctx: Context, rawBody: string, apiUrl: string, botApiSecret: string,
  data: ShopBotDataContext) {
  if (!ctx.from) return;
  const body = rawBody.trim();
  if (!body || body.length > 4_000) { await ctx.reply('❌ Nội dung phải từ 1 đến 4.000 ký tự.', inlineMenu()); return; }
  const user = await ensureUser(data, ctx.from.id.toString(), ctx.from.username, ctx.from.first_name);
  try {
    const response = await fetch(`${apiUrl}/api/bot/support/messages`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-bot-secret': botApiSecret },
      body: JSON.stringify({ userId: user._id.toString(), body,
        idempotencyKey: `direct-support:${ctx.chat?.id ?? ctx.from.id}:${ctx.update.update_id}` }),
    });
    const result = await response.json().catch(() => ({})) as { message?: string | string[] };
    if (!response.ok) throw new Error(readErrorMessage(result.message, 'Không thể gửi tin nhắn.'));
    await ctx.reply('✅ Đã gửi tin nhắn cho shop. Nhân viên sẽ trả lời trực tiếp tại đây.', inlineMenu());
  } catch (error) {
    await ctx.reply(`❌ ${error instanceof Error ? error.message : 'Không thể gửi tin nhắn.'}`, inlineMenu());
  }
}

async function purchaseQuantity(ctx: Context, productId: string | undefined, quantity: number, apiUrl: string, botApiSecret: string, data: ShopBotDataContext) {
  if (!ctx.from || !ctx.chat) return;
  if (!productId || !/^[a-f\d]{24}$/.test(productId) || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > maximumTelegramPurchaseQuantity()) {
    await ctx.reply(`❌ Số lượng không hợp lệ. Mỗi lượt mua tối đa ${maximumTelegramPurchaseQuantity()} sản phẩm.`, inlineMenu());
    return;
  }
  await quoteCart(ctx, productId, quantity, undefined, apiUrl, botApiSecret, data);
  await recordShoppingEvent(ctx, apiUrl, botApiSecret, { type: 'CHECKOUT_START', productId });
}

async function quoteCart(ctx: Context, productId: string, quantity: number, couponCode: string | undefined,
  apiUrl: string, botApiSecret: string, data: ShopBotDataContext, previousNonce?: string) {
  if (!ctx.from || !ctx.chat) return;
  try {
    const product = await data.products.findOne({ _id: productId, status: ProductStatus.ACTIVE, deletedAt: null }).select('price name').lean();
    if (!product) throw new Error('Sản phẩm không còn được bán.');
    const user = await ensureUser(data, ctx.from.id.toString(), ctx.from.username, ctx.from.first_name);
    const response = await fetch(`${apiUrl}/api/purchases/quote`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-bot-secret': botApiSecret },
      body: JSON.stringify({ userId: user._id.toString(), productId, quantity, expectedUnitPrice: product.price, couponCode }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = await response.json() as Partial<CheckoutCart> & { message?: string | string[] };
    if (!response.ok) throw new Error(readErrorMessage(body.message, 'Không thể tính tổng tiền.'));
    const cart: CheckoutCart = { nonce: randomBytes(12).toString('hex'), productId, quantity,
      productName: body.productName ?? product.name, unitPrice: body.unitPrice!,
      subtotal: body.subtotal!, discountAmount: body.discountAmount!, totalAmount: body.totalAmount!,
      ...(body.couponCode ? { couponCode: body.couponCode } : {}),
      paymentMethod: user.walletBalance >= body.totalAmount! ? 'WALLET' : 'BANK_QR', submitted: false };
    if (!isCheckoutCart(cart)) throw new Error('Báo giá không hợp lệ. Vui lòng thử lại.');
    if (previousNonce) {
      // A coupon edit cannot replace a cart that another callback already submitted.
      const updated = await data.botSessions.findOneAndUpdate({ chatId: String(ctx.chat.id), telegramUserId: String(ctx.from.id),
        'data.nonce': previousNonce, 'data.submitted': false, expiresAt: { $gt: new Date() } },
      { $set: { kind: BotSessionKind.CHECKOUT_CONFIRMATION, data: cart, expiresAt: new Date(Date.now() + 10 * 60_000) } }, { new: true });
      if (!updated) { await ctx.reply('Báo giá đã thay đổi hoặc đơn đang xử lý. Hãy dùng tin nhắn xác nhận mới nhất.'); return; }
    } else await savePendingInput(data, ctx.chat.id, ctx.from.id, BotSessionKind.CHECKOUT_CONFIRMATION, cart, 10 * 60_000);
    await ctx.reply([
      '🧾 XÁC NHẬN ĐƠN HÀNG', `🛍 ${cart.productName} × ${cart.quantity}`,
      `Tạm tính: ${formatMoney(cart.subtotal)}`,
      ...(cart.couponCode ? [`🎟 ${cart.couponCode}: −${formatMoney(cart.discountAmount)}`] : []),
      `💵 Thanh toán: ${formatMoney(cart.totalAmount)}`, `💰 Số dư ví: ${formatMoney(user.walletBalance)}`,
      cart.paymentMethod === 'WALLET' ? 'Tiền sẽ trừ từ ví sau khi bạn xác nhận.' : 'Ví chưa đủ: bot sẽ tạo QR đúng số tiền sau giảm giá.',
      'Báo giá có hiệu lực 10 phút; giá, tồn kho và mã được kiểm tra lại khi đặt đơn.',
    ].join('\n'), Markup.inlineKeyboard([
      [Markup.button.callback(cart.paymentMethod === 'WALLET' ? '✅ Xác nhận mua bằng ví' : '📱 Tạo QR thanh toán', `cart:pay:${cart.nonce}`)],
      [Markup.button.callback(cart.couponCode ? '🎟 Đổi mã giảm giá' : '🎟 Nhập mã giảm giá', `cart:coupon:${cart.nonce}`)],
      ...(cart.couponCode ? [[Markup.button.callback('Bỏ mã giảm giá', `cart:clear:${cart.nonce}`)]] : []),
      [Markup.button.callback('🔄 Cập nhật báo giá', `cart:refresh:${cart.nonce}`), Markup.button.callback('⬅️ Sản phẩm', 'menu:products')],
    ]));
  } catch (error) {
    await ctx.reply(`❌ ${error instanceof Error ? error.message : 'Không thể áp dụng mã giảm giá.'}`,
      previousNonce ? Markup.inlineKeyboard([[Markup.button.callback('🎟 Nhập lại mã', `cart:coupon:${previousNonce}`)],
        [Markup.button.callback('Tiếp tục không dùng mã', `cart:clear:${previousNonce}`)]]) : inlineMenu());
  }
}

async function confirmCheckout(ctx: Context, cart: CheckoutCart, apiUrl: string, botApiSecret: string, data: ShopBotDataContext) {
  if (!ctx.from || !ctx.chat) return;
  const current = await data.botSessions.findOneAndUpdate({ chatId: String(ctx.chat.id), telegramUserId: String(ctx.from.id),
    'data.nonce': cart.nonce, expiresAt: { $gt: new Date() } },
  { $set: { kind: BotSessionKind.CHECKOUT_CONFIRMATION, 'data.submitted': true } }, { new: true });
  if (!current) { await ctx.reply('Báo giá đã được thay thế. Hãy chọn báo giá mới nhất.'); return; }
  const user = await ensureUser(data, ctx.from.id.toString(), ctx.from.username, ctx.from.first_name);
  if (cart.paymentMethod === 'BANK_QR') {
    await createQuickCheckout(ctx, { ...cart, userId: user._id.toString() }, apiUrl, botApiSecret); return;
  }
  try {
    const response = await fetch(`${apiUrl}/api/purchases/batch`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-bot-secret': botApiSecret },
      body: JSON.stringify({ userId: user._id.toString(), productId: cart.productId, quantity: cart.quantity,
        expectedUnitPrice: cart.unitPrice, expectedTotalAmount: cart.totalAmount, couponCode: cart.couponCode,
        idempotencyPrefix: `cart:${ctx.chat.id}:${cart.nonce}` }), signal: AbortSignal.timeout(25_000),
    });
    const body = await response.json() as { message?: string | string[] };
    if (!response.ok) throw new Error(readErrorMessage(body.message, 'Chưa thể xác nhận đơn.'));
    await ctx.reply(`✅ Đã đặt ${cart.quantity} sản phẩm ${cart.productName}.\nThanh toán: ${formatMoney(cart.totalAmount)}${cart.couponCode ? `\n🎟 Mã ${cart.couponCode}: tiết kiệm ${formatMoney(cart.discountAmount)}` : ''}\n📦 Hàng sẽ được gửi tự động.`, inlineMenu());
  } catch (error) {
    // Keep the same cart and payment route on ambiguous failures. The API's
    // idempotency key recovers the original purchase instead of charging twice.
    await ctx.reply(`⚠️ ${error instanceof Error ? error.message : 'Chưa nhận được kết quả đặt đơn.'}\nBấm thử lại để kiểm tra cùng đơn, không tạo một giao dịch mới.`,
      Markup.inlineKeyboard([[Markup.button.callback('🔄 Thử lại cùng đơn', `cart:pay:${cart.nonce}`)],
        [Markup.button.callback('📦 Kiểm tra đơn hàng', 'menu:orders')]]));
  }
}

function isCheckoutCart(value: Record<string, unknown>): value is CheckoutCart {
  return typeof value.nonce === 'string' && /^[a-f\d]{24}$/.test(value.nonce)
    && typeof value.productId === 'string' && /^[a-f\d]{24}$/.test(value.productId)
    && typeof value.productName === 'string' && typeof value.submitted === 'boolean'
    && [value.quantity, value.unitPrice, value.subtotal, value.discountAmount, value.totalAmount].every(Number.isSafeInteger)
    && Number(value.quantity) >= 1 && Number(value.quantity) <= maximumTelegramPurchaseQuantity()
    && Number(value.unitPrice) >= 0 && Number(value.discountAmount) >= 0 && Number(value.totalAmount) >= 0
    && value.subtotal === Number(value.quantity) * Number(value.unitPrice)
    && value.totalAmount === Number(value.subtotal) - Number(value.discountAmount)
    && (value.couponCode === undefined || (typeof value.couponCode === 'string' && /^[A-Z0-9_-]{3,40}$/.test(value.couponCode)))
    && (value.paymentMethod === 'WALLET' || value.paymentMethod === 'BANK_QR');
}

async function recordShoppingEvent(ctx: Context, apiUrl: string, botApiSecret: string,
  explicit?: { type: 'CHECKOUT_START'; productId: string }) {
  if (!ctx.from) return;
  const callback = ctx.callbackQuery && 'data' in ctx.callbackQuery ? ctx.callbackQuery.data : '';
  const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
  const product = /^select:([a-f\d]{24}):/.exec(callback);
  const menu = ['menu:home', 'menu:products', 'menu:coupons'].includes(callback)
    || /^\/(?:start|products)(?:@\w+)?(?:\s|$)/.test(text) || text === '🛍 Sản phẩm';
  const type = explicit?.type ?? (product ? 'PRODUCT_VIEW' : menu ? 'MENU_VIEW' : undefined);
  if (!type) return;
  try {
    const response = await fetch(`${apiUrl}/api/bot/analytics/events`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-bot-secret': botApiSecret },
      body: JSON.stringify({ telegramId: String(ctx.from.id), updateId: ctx.update.update_id, type,
        ...(explicit || product ? { productId: explicit?.productId ?? product![1] } : {}) }),
      signal: AbortSignal.timeout(1_500),
    });
    if (!response.ok) console.warn({ event: 'shopping-analytics-unavailable', status: response.status });
  } catch { console.warn({ event: 'shopping-analytics-unavailable' }); }
}

async function savePendingInput(models: ShopBotDataContext, chatId: number, userId: number,
  kind: typeof BotSessionKind[keyof typeof BotSessionKind], payload: Record<string, unknown>, ttlMs = 2 * 60_000) {
  await models.botSessions.findOneAndUpdate({ chatId: String(chatId), telegramUserId: String(userId) }, { $set: {
    kind, data: payload, expiresAt: new Date(Date.now() + ttlMs),
  } }, { upsert: true, new: true, setDefaultsOnInsert: true });
}

async function takePendingInput(models: ShopBotDataContext, chatId: number, userId: number): Promise<
  | { kind: typeof BotSessionKind[keyof typeof BotSessionKind]; data: Record<string, unknown>; expired: boolean }
  | undefined
> {
  const owner = { chatId: String(chatId), telegramUserId: String(userId) };
  const pending = await models.botSessions.findOneAndDelete({ ...owner,
    kind: { $nin: [BotSessionKind.CHECKOUT_CONFIRMATION, BotSessionKind.COUPON_CODE] } }).lean()
    ?? await models.botSessions.findOne({ ...owner, kind: BotSessionKind.COUPON_CODE }).lean();
  if (!pending) return undefined;
  return {
    kind: pending.kind,
    data: pending.data,
    expired: pending.expiresAt.getTime() <= Date.now(),
  };
}

function isPendingQuantity(value: Record<string, unknown>): value is PendingQuantity {
  return typeof value.productId === 'string' && /^[a-f\d]{24}$/.test(value.productId)
    && typeof value.categoryKey === 'string';
}
function isPendingComplaint(value: Record<string, unknown>): value is PendingComplaint {
  return typeof value.orderId === 'string' && /^[a-f\d]{24}$/.test(value.orderId)
    && isComplaintCategory(value.category);
}
function isPendingComplaintReply(value: Record<string, unknown>): value is PendingComplaintReply {
  return typeof value.reportId === 'string' && /^[a-f\d]{24}$/.test(value.reportId);
}
function isComplaintCategory(value: unknown): value is ComplaintCategoryValue {
  return typeof value === 'string' && Object.values(ComplaintCategory).includes(value as ComplaintCategoryValue);
}
function reportStatusLabel(value?: string) {
  const labels: Record<string, string> = { PENDING: 'Đang chờ xử lý', REVIEWING: 'Đang kiểm tra', APPROVED: 'Đã chấp nhận',
    RESOLVED: 'Đã giải quyết', REJECTED: 'Đã từ chối', REPLACED: 'Đã thay thế', REFUNDED: 'Đã hoàn tiền' };
  return value ? labels[value] ?? value : 'Đang chờ xử lý';
}

function formatMoney(value: number) { return new Intl.NumberFormat('vi-VN').format(value) + ' đ'; }
function sellableInventoryFilter(productId: unknown) {
  return { productId, deletedAt: null, $or: [
    { status: InventoryStatus.AVAILABLE },
    { status: InventoryStatus.RESERVED, reservedPaymentRequestId: { $exists: true },
      reservedOrderId: { $exists: false }, reservationExpiresAt: { $lte: new Date() } },
  ] };
}
function formatDeadline(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit',
    day: '2-digit', month: '2-digit', year: 'numeric' }).format(parsed);
}
function bankPollingHint() {
  return 'Chuyển ĐÚNG số tiền và ĐÚNG nội dung. Cake sẽ gửi callback tự động; nếu callback chậm, nút “Kiểm tra tiền” sẽ đối soát trực tiếp lịch sử giao dịch.';
}
/** Small orders bound callback work and limit abuse consistently on every runtime. */
function maximumTelegramPurchaseQuantity() { return MAX_TELEGRAM_QUICK_CHECKOUT_QUANTITY; }
function markdownEscape(value: string) { return value.replace(/[\\_*`\[\]()]/g, '\\$&'); }
function descriptionBlock(value: string | undefined, limit: number) {
  const description = value?.trim();
  if (!description) return '';
  const clipped = description.length > limit ? `${description.slice(0, Math.max(0, limit - 1)).trimEnd()}…` : description;
  return `\n\n${markdownEscape(clipped)}`;
}
function htmlEscape(value: string) { return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function htmlDescriptionBlock(value: string | undefined, limit: number) {
  const description = value?.trim();
  if (!description) return '';
  const clipped = description.length > limit ? `${description.slice(0, Math.max(0, limit - 1)).trimEnd()}…` : description;
  return `\n\n${htmlEscape(clipped)}`;
}
function salePriceBlock(price: number, originalPrice?: number) {
  const discount = productDiscountPercent(price, originalPrice);
  if (!discount || !originalPrice) return `💰 <b>${htmlEscape(formatMoney(price))}</b> / sản phẩm`;
  return `🏷 Giá gốc: <s>${htmlEscape(formatMoney(originalPrice))}</s>\n🔥 <b>ĐANG SALE -${discount}%</b>\n💰 Giá sale: <b>${htmlEscape(formatMoney(price))}</b> / sản phẩm`;
}
function statusIcon(status: string) { return status === DeliveryStatus.DELIVERED ? '✅' : status === DeliveryStatus.FAILED || status === OrderStatus.DELIVERY_FAILED ? '⚠️' : '⏳'; }

async function ensureUser(models: ShopBotDataContext, telegramId: string, username?: string, displayName?: string) {
  const normalizedUsername = username?.trim();
  return models.users.findOneAndUpdate({ telegramId, deletedAt: null }, {
    $set: { ...(normalizedUsername ? { username: normalizedUsername } : {}), ...(displayName ? { displayName } : {}) },
    ...(!normalizedUsername ? { $unset: { username: 1 } } : {}),
    $setOnInsert: {
    status: UserStatus.ACTIVE, walletBalance: 0, referralCode: `TG${telegramId.replace('-', '')}`, purchaseCount: 0, deletedAt: null,
  } }, { upsert: true, new: true, setDefaultsOnInsert: true });
}
