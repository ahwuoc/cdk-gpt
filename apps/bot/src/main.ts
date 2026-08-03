import 'reflect-metadata';
import mongoose from 'mongoose';
import { Worker } from 'bullmq';
import { loadConfig, redisConnectionOptions } from '@store/config';
import '@store/database';
import { createShopBot } from './shop.bot';
import { DeliveryProcessor, type DeliveryJob } from './delivery.processor';

const config = loadConfig();
const botApiSecret = process.env.BOT_API_SECRET;
if (!botApiSecret) throw new Error('BOT_API_SECRET is required');
await mongoose.connect(config.mongoUri, { autoIndex: false });
const bot = createShopBot(config.botToken, config.apiUrl, botApiSecret, config.shopName);
const processor = new DeliveryProcessor(bot, config.adminTelegramIds);
const worker = new Worker<DeliveryJob>('delivery', (job) => processor.process(job), { connection: redisConnectionOptions(config.redisUrl), concurrency: Number(process.env.DELIVERY_CONCURRENCY ?? 5),
  lockDuration: 60_000, stalledInterval: 30_000, maxStalledCount: 1 });
worker.on('failed', (job, error) => {
  const exhausted = !job || error instanceof Error && error.name === 'UnrecoverableError' || job.attemptsMade >= (job.opts.attempts ?? 1);
  if (exhausted) void processor.onFailed(job, error);
});
worker.on('error', (error) => console.error({ event: 'delivery-worker-error', message: error.message }));
await bot.launch();
console.log('Telegram bot and delivery worker started');

async function shutdown(signal: string) {
  console.log(`Received ${signal}, shutting down`);
  bot.stop(signal); await worker.close(); await mongoose.disconnect(); process.exit(0);
}
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
