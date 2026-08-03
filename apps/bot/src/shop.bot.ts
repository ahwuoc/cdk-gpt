import { Telegraf } from 'telegraf';
import { randomUUID } from 'node:crypto';
import { ProductModel, UserModel } from '@store/database';
import { ProductStatus, UserStatus } from '@store/shared';

export function createShopBot(token: string, apiUrl: string, botApiSecret: string, shopName: string) {
  const bot = new Telegraf(token);
  bot.start(async (ctx) => {
    await ensureUser(ctx.from.id.toString(), ctx.from.username, [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' '));
    await ctx.reply(`Welcome to ${shopName}. Use /products, /balance, or /buy <productId>.`);
  });
  bot.command('products', async (ctx) => {
    const products = await ProductModel.find({ status: ProductStatus.ACTIVE, deletedAt: null }).select('name price').sort({ sortOrder: 1 }).limit(50).lean();
    await ctx.reply(products.length ? products.map((product) => `${product._id} — ${product.name}: ${product.price}`).join('\n') : 'No products are available.');
  });
  bot.command('balance', async (ctx) => {
    const user = await ensureUser(ctx.from.id.toString(), ctx.from.username, ctx.from.first_name);
    await ctx.reply(`Wallet balance: ${user.walletBalance}`);
  });
  bot.command('buy', async (ctx) => {
    const productId = ctx.message.text.split(/\s+/)[1];
    const product = productId ? await ProductModel.findOne({ _id: productId, status: ProductStatus.ACTIVE, deletedAt: null }).select('price name').lean() : null;
    if (!product) { await ctx.reply('Usage: /buy <productId>'); return; }
    const user = await ensureUser(ctx.from.id.toString(), ctx.from.username, ctx.from.first_name);
    const response = await fetch(`${apiUrl}/api/purchases`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-bot-secret': botApiSecret },
      body: JSON.stringify({ userId: user._id.toString(), productId: product._id.toString(), expectedUnitPrice: product.price,
        idempotencyKey: `telegram:${ctx.chat.id}:${ctx.message.message_id}:${randomUUID()}` }) });
    const body = await response.json() as { orderCode?: string; message?: string };
    await ctx.reply(response.ok ? `Order ${body.orderCode} accepted. Delivery is queued.` : `Purchase failed: ${body.message ?? 'unknown error'}`);
  });
  bot.catch((error) => console.error({ event: 'bot-handler-error', message: error instanceof Error ? error.message : 'unknown' }));
  return bot;
}

async function ensureUser(telegramId: string, username?: string, displayName?: string) {
  return UserModel.findOneAndUpdate({ telegramId, deletedAt: null }, { $set: { username, displayName }, $setOnInsert: {
    status: UserStatus.ACTIVE, walletBalance: 0, referralCode: `TG${telegramId.replace('-', '')}`, purchaseCount: 0, deletedAt: null,
  } }, { upsert: true, new: true, setDefaultsOnInsert: true });
}
