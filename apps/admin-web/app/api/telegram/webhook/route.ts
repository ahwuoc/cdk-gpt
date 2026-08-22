import { createHash } from 'node:crypto';
import { getModelToken } from '@nestjs/mongoose';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { BotConfigService } from '../../../../../api/src/bot-config/bot-config.service';
import { deriveTelegramWebhookSecret, isTelegramWebhookSecretSeed } from '../../../../../api/src/bot-config/telegram-webhook-secret';
import { sharedSecretMatches } from '../../../../../api/src/auth/shared-secret';
import { getServerlessApi } from '../../../../../api/src/serverless';
import { createShopBot, type ShopBotDataContext } from '../../../../../bot/src/shop.bot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

let cachedBot: { fingerprint: string; bot: ReturnType<typeof createShopBot> } | undefined;

/**
 * Telegram webhook entry point for Vercel. Do not put the secret in the path:
 * Telegram supplies it in a verified, constant-time compared header instead.
 */
export async function POST(request: Request) {
  const secretSeed = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (!isTelegramWebhookSecretSeed(secretSeed)) return Response.json({ message: 'Telegram webhook is not configured' }, { status: 503 });
  const app = await getServerlessApi();
  const config = app.get(BotConfigService);
  const [runtimeToken, runtimeConfig] = await Promise.all([
    config.getRuntimeBotToken(), config.getRuntimeOperationalConfig(),
  ]);
  if (!sharedSecretMatches(request.headers.get('x-telegram-bot-api-secret-token') ?? undefined,
    deriveTelegramWebhookSecret(secretSeed, runtimeToken.token))) {
    return Response.json({ message: 'Invalid Telegram webhook secret' }, { status: 401 });
  }
  const botApiSecret = process.env.BOT_API_SECRET;
  if (!runtimeConfig.apiUrl || !botApiSecret) throw new Error('API URL and BOT_API_SECRET are required for the Telegram webhook');
  const fingerprint = createHash('sha256').update(JSON.stringify({ token: runtimeToken.token,
    apiUrl: runtimeConfig.apiUrl, botApiSecret, shopName: runtimeConfig.shopName })).digest('hex');
  if (!cachedBot || cachedBot.fingerprint !== fingerprint) {
    cachedBot = {
      fingerprint,
      bot: createShopBot(runtimeToken.token, runtimeConfig.apiUrl, botApiSecret, runtimeConfig.shopName, shopBotModels(app)),
    };
  }
  const update = await request.json();
  await cachedBot.bot.handleUpdate(update);
  return Response.json({ ok: true });
}

/** Resolve the same Nest models used by API services; no per-webhook connection. */
function shopBotModels(app: NestFastifyApplication): ShopBotDataContext {
  return {
    botSessions: app.get<ShopBotDataContext['botSessions']>(getModelToken('BotSession')),
    categories: app.get<ShopBotDataContext['categories']>(getModelToken('Category')),
    inventoryItems: app.get<ShopBotDataContext['inventoryItems']>(getModelToken('InventoryItem')),
    orders: app.get<ShopBotDataContext['orders']>(getModelToken('Order')),
    products: app.get<ShopBotDataContext['products']>(getModelToken('Product')),
    settings: app.get<ShopBotDataContext['settings']>(getModelToken('Setting')),
    users: app.get<ShopBotDataContext['users']>(getModelToken('User')),
  };
}
