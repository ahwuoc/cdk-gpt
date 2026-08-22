import { Markup, Telegraf, type Context } from 'telegraf';
import type { Model } from 'mongoose';
import { isServerlessRuntime } from '@store/config';
import {
  BotSessionKind, BotSessionModel, CategoryModel, InventoryItemModel, OrderModel, ProductModel, SettingModel, UserModel,
  type BotSession, type Category, type InventoryItem, type Order, type Product, type Setting, type User,
} from '@store/database';
import { DeliveryStatus, InventoryStatus, OrderStatus, ProductStatus, UserStatus } from '@store/shared';

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
  [Markup.button.callback('📦 Đơn hàng của tôi', 'menu:orders'), Markup.button.callback('ℹ️ Hướng dẫn', 'menu:help')],
]);

type PendingQuantity = { productId: string; categoryKey: string };

type DepositResponse = {
  id?: string;
  requestCode?: string;
  amount?: number;
  status?: string;
  transferContent?: string;
  qrUrl?: string;
  bank?: {
    bankId?: string;
    accountNo?: string;
    accountName?: string;
  };
};

export function createShopBot(
  token: string,
  apiUrl: string,
  botApiSecret: string,
  shopName: string,
  data: ShopBotDataContext = defaultDataContext,
) {
  const bot = new Telegraf(token);

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
    await ctx.answerCbQuery('Đang xử lý đơn hàng…');
    await purchaseQuantity(ctx, ctx.match[1], Number(ctx.match[2]), apiUrl, botApiSecret, data);
  });

  bot.command('balance', (ctx) => showBalance(ctx, data));
  bot.hears('💰 Số dư', (ctx) => showBalance(ctx, data));
  bot.action('menu:balance', async (ctx) => { await ctx.answerCbQuery(); await showBalance(ctx, data); });
  bot.command('deposit', (ctx) => showDepositOptions(ctx));
  bot.command('nap', (ctx) => showDepositOptions(ctx));
  bot.hears('💳 Nạp tiền', (ctx) => showDepositOptions(ctx));
  bot.action('menu:deposit', async (ctx) => { await ctx.answerCbQuery(); await showDepositOptions(ctx); });
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
  bot.action('menu:home', async (ctx) => { await ctx.answerCbQuery(); await ctx.reply('🏠 Menu chính', inlineMenu()); });

  bot.hears('📦 Đơn hàng của tôi', (ctx) => showOrders(ctx, data));
  bot.action('menu:orders', async (ctx) => { await ctx.answerCbQuery(); await showOrders(ctx, data); });
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
      if (pending.kind === BotSessionKind.DEPOSIT_AMOUNT) {
        await ctx.reply('⏱️ Yêu cầu nhập số tiền đã hết hạn. Hãy chọn Nạp tiền lại.', inlineMenu());
      } else {
        await ctx.reply('⏱️ Yêu cầu nhập số lượng đã hết hạn. Hãy chọn lại sản phẩm.', inlineMenu());
      }
      return;
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

async function checkDeposit(ctx: Context, requestId: string, apiUrl: string, botApiSecret: string, data: ShopBotDataContext) {
  if (!ctx.from) return;
  const user = await ensureUser(data, ctx.from.id.toString(), ctx.from.username, [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' '));
  try {
    const response = await fetch(`${apiUrl}/api/bot/deposits/${requestId}/check`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-bot-secret': botApiSecret },
      body: JSON.stringify({ userId: user._id.toString() }),
    });
    const body = await response.json().catch(() => ({})) as { status?: string; amount?: number; message?: string | string[] };
    if (!response.ok || !body.status) throw new Error(readErrorMessage(body.message, 'Không thể kiểm tra giao dịch.'));
    if (body.status === 'APPROVED') {
      const refreshed = await data.users.findById(user._id).select('walletBalance').lean();
      await ctx.reply(`✅ Đã nhận ${formatMoney(body.amount ?? 0)}. Số dư hiện tại: ${formatMoney(refreshed?.walletBalance ?? user.walletBalance)}.`, inlineMenu());
      return;
    }
    if (body.status === 'EXPIRED') {
      await ctx.reply('⌛ Mã nạp tiền này đã hết hạn. Hãy tạo yêu cầu nạp mới.', inlineMenu());
      return;
    }
    await ctx.reply(`⏳ Chưa thấy giao dịch ${formatMoney(body.amount ?? 0)}. Hãy chuyển đúng số tiền và nội dung, rồi thử lại sau ít phút.`, {
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🔄 Kiểm tra lại', `deposit:check:${requestId}`)],
        [Markup.button.callback('💳 Nạp khoản khác', 'menu:deposit'), Markup.button.callback('🏠 Menu chính', 'menu:home')],
      ]),
    });
  } catch (error) {
    await ctx.reply(`❌ ${error instanceof Error ? error.message : 'Không thể kiểm tra giao dịch.'}`, inlineMenu());
  }
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

  const products = await data.products.find(filter).select('name price').sort({ sortOrder: 1, createdAt: -1 }).limit(50).lean();
  const categoryHeading = markdownEscape(categoryName);
  const categoryDetails = descriptionBlock(categoryDescription, 1_000);
  if (!products.length) {
    await ctx.reply(`📂 *${categoryHeading}*${categoryDetails}\n\nDanh mục này hiện chưa có sản phẩm.`, { parse_mode: 'Markdown', ...Markup.inlineKeyboard([
      [Markup.button.callback('⬅️ Danh mục', 'menu:products')],
    ]) });
    return;
  }
  const stockRows = await data.inventoryItems.aggregate<{ _id: string; count: number }>([
    { $match: { productId: { $in: products.map((product) => product._id) }, status: InventoryStatus.AVAILABLE, deletedAt: null } },
    { $group: { _id: '$productId', count: { $sum: 1 } } },
  ]);
  const stockByProduct = new Map(stockRows.map((row) => [row._id.toString(), row.count]));
  const buttons = products.map((product) => [Markup.button.callback(
    `🛒 ${product.name.slice(0, 32)} · ${formatMoney(product.price)} · Còn ${stockByProduct.get(product._id.toString()) ?? 0}`, `select:${product._id.toString()}:${categoryKey}`)]);
  buttons.push([Markup.button.callback('⬅️ Danh mục', 'menu:products'), Markup.button.callback('🔄 Cập nhật', `category:${categoryKey}`)]);
  await ctx.reply(`📂 *${categoryHeading}*${categoryDetails}\n\nChọn sản phẩm để mua:`, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
}

async function showQuantityOptions(ctx: Context, productId: string, categoryKey: string, data: ShopBotDataContext) {
  const product = await data.products.findOne({ _id: productId, status: ProductStatus.ACTIVE, deletedAt: null }).select('name price description').lean();
  if (!product) { await ctx.reply('Không tìm thấy sản phẩm.', inlineMenu()); return; }
  const available = await data.inventoryItems.countDocuments({ productId, status: InventoryStatus.AVAILABLE, deletedAt: null });
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
  await ctx.reply(`🛍 *${markdownEscape(product.name)}*${descriptionBlock(product.description, 2_500)}\n\n💰 ${formatMoney(product.price)} / sản phẩm\n📦 Còn ${available} sản phẩm\n\nChọn số lượng muốn mua:`, {
    parse_mode: 'Markdown', ...Markup.inlineKeyboard(rows),
  });
}

async function showBalance(ctx: Context, data: ShopBotDataContext) {
  if (!ctx.from) return;
  const user = await ensureUser(data, ctx.from.id.toString(), ctx.from.username, ctx.from.first_name);
  await ctx.reply(`💰 Số dư ví của bạn: *${formatMoney(user.walletBalance)}*`, { parse_mode: 'Markdown', ...inlineMenu() });
}

async function showOrders(ctx: Context, data: ShopBotDataContext) {
  if (!ctx.from) return;
  const user = await ensureUser(data, ctx.from.id.toString(), ctx.from.username, ctx.from.first_name);
  const orders = await data.orders.find({ userId: user._id }).sort({ createdAt: -1 }).limit(10).lean();
  if (!orders.length) { await ctx.reply('📦 Bạn chưa có đơn hàng nào.', inlineMenu()); return; }
  const products = await data.products.find({ _id: { $in: orders.map((order) => order.productId) } }).select('name').lean();
  const names = new Map(products.map((product) => [product._id.toString(), product.name]));
  const lines = orders.map((order) => `${statusIcon(order.deliveryStatus)} *${order.orderCode}* · ${names.get(order.productId.toString()) ?? 'Sản phẩm'} · ${formatMoney(order.totalAmount)}`);
  await ctx.reply(`📦 *10 đơn gần nhất*\n\n${lines.join('\n')}`, { parse_mode: 'Markdown', ...inlineMenu() });
}

async function showHelp(ctx: Context) {
  await ctx.reply('ℹ️ *Hướng dẫn nhanh*\n\n1. Chọn *Sản phẩm* để xem hàng đang bán.\n2. Bấm nút mua và kiểm tra số dư ví.\n3. Hàng sẽ được gửi tự động sau khi thanh toán.\n\nBạn cũng có thể dùng /products, /balance hoặc /buy <productId>.', { parse_mode: 'Markdown', ...inlineMenu() });
}

async function purchaseQuantity(ctx: Context, productId: string | undefined, quantity: number, apiUrl: string, botApiSecret: string, data: ShopBotDataContext) {
  if (!ctx.from || !ctx.chat) return;
  if (!productId || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > maximumTelegramPurchaseQuantity()) {
    await ctx.reply(`❌ Số lượng không hợp lệ. Mỗi lượt mua tối đa ${maximumTelegramPurchaseQuantity()} sản phẩm.`, inlineMenu());
    return;
  }
  const product = await data.products.findOne({ _id: productId, status: ProductStatus.ACTIVE, deletedAt: null }).select('price name').lean();
  if (!product) { await ctx.reply('Không tìm thấy sản phẩm. Hãy mở menu Sản phẩm để chọn lại.', inlineMenu()); return; }
  const available = await data.inventoryItems.countDocuments({ productId, status: InventoryStatus.AVAILABLE, deletedAt: null });
  if (quantity > available) {
    await ctx.reply(`❌ Chỉ còn ${available} sản phẩm *${product.name}*.`, { parse_mode: 'Markdown', ...inlineMenu() });
    return;
  }
  const user = await ensureUser(data, ctx.from.id.toString(), ctx.from.username, ctx.from.first_name);
  const total = product.price * quantity;
  if (!Number.isSafeInteger(total)) {
    await ctx.reply('❌ Tổng tiền vượt giới hạn an toàn. Hãy giảm số lượng mua.', inlineMenu());
    return;
  }
  if (user.walletBalance < total) {
    await ctx.reply(`❌ Số dư không đủ. Cần ${formatMoney(total)}.`, inlineMenu());
    return;
  }
  let purchased = 0; let firstError = '';
  for (let index = 0; index < quantity; index++) {
    const response = await fetch(`${apiUrl}/api/purchases`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-bot-secret': botApiSecret },
      body: JSON.stringify({ userId: user._id.toString(), productId: product._id.toString(), expectedUnitPrice: product.price,
        // Telegram can deliver the same webhook update again. The key must be
        // deterministic so a retry returns the original order rather than
        // reserving/debiting a second item.
        idempotencyKey: `telegram:${ctx.chat.id}:${ctx.update.update_id}:${product._id.toString()}:${index}` }) });
    const body = await response.json() as { orderCode?: string; message?: string };
    if (!response.ok) { firstError = body.message ?? 'vui lòng thử lại'; break; }
    purchased++;
  }
  if (purchased === quantity) {
    await ctx.reply(`✅ Đã đặt ${purchased} sản phẩm *${product.name}*. Hàng sẽ được gửi ngay.`, { parse_mode: 'Markdown', ...inlineMenu() });
  } else {
    await ctx.reply(`⚠️ Đã đặt ${purchased}/${quantity} sản phẩm *${product.name}*. ${firstError ? `Lý do: ${firstError}` : ''}`, { parse_mode: 'Markdown', ...inlineMenu() });
  }
}

async function savePendingInput(models: ShopBotDataContext, chatId: number, userId: number, kind: typeof BotSessionKind[keyof typeof BotSessionKind], payload: Record<string, unknown>) {
  await models.botSessions.findOneAndUpdate({ chatId: String(chatId), telegramUserId: String(userId) }, { $set: {
    kind, data: payload, expiresAt: new Date(Date.now() + 2 * 60_000),
  } }, { upsert: true, new: true, setDefaultsOnInsert: true });
}

async function takePendingInput(models: ShopBotDataContext, chatId: number, userId: number): Promise<
  | { kind: typeof BotSessionKind[keyof typeof BotSessionKind]; data: PendingQuantity; expired: boolean }
  | undefined
> {
  const pending = await models.botSessions.findOneAndDelete({ chatId: String(chatId), telegramUserId: String(userId) }).lean();
  if (!pending) return undefined;
  return {
    kind: pending.kind,
    data: isPendingQuantity(pending.data) ? pending.data : { productId: '', categoryKey: 'uncategorized' },
    expired: pending.expiresAt.getTime() <= Date.now(),
  };
}

function isPendingQuantity(value: Record<string, unknown>): value is PendingQuantity {
  return typeof value.productId === 'string' && /^[a-f\d]{24}$/.test(value.productId)
    && typeof value.categoryKey === 'string';
}

function formatMoney(value: number) { return new Intl.NumberFormat('vi-VN').format(value) + ' đ'; }
function bankPollingHint() {
  return 'Chuyển ĐÚNG số tiền và ĐÚNG nội dung. Cake sẽ gửi callback và hệ thống tự cộng tiền; nút “Kiểm tra tiền” chỉ làm mới trạng thái.';
}
/** Keep one webhook invocation below Vercel's 60-second limit; users can repeat safely. */
function maximumTelegramPurchaseQuantity() { return isServerlessRuntime() ? 5 : 100; }
function markdownEscape(value: string) { return value.replace(/[\\_*`\[\]()]/g, '\\$&'); }
function descriptionBlock(value: string | undefined, limit: number) {
  const description = value?.trim();
  if (!description) return '';
  const clipped = description.length > limit ? `${description.slice(0, Math.max(0, limit - 1)).trimEnd()}…` : description;
  return `\n\n${markdownEscape(clipped)}`;
}
function statusIcon(status: string) { return status === DeliveryStatus.DELIVERED ? '✅' : status === DeliveryStatus.FAILED || status === OrderStatus.DELIVERY_FAILED ? '⚠️' : '⏳'; }

async function ensureUser(models: ShopBotDataContext, telegramId: string, username?: string, displayName?: string) {
  return models.users.findOneAndUpdate({ telegramId, deletedAt: null }, { $set: { username, displayName }, $setOnInsert: {
    status: UserStatus.ACTIVE, walletBalance: 0, referralCode: `TG${telegramId.replace('-', '')}`, purchaseCount: 0, deletedAt: null,
  } }, { upsert: true, new: true, setDefaultsOnInsert: true });
}
