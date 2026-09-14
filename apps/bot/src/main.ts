import 'reflect-metadata';
import mongoose from 'mongoose';
import { Worker } from 'bullmq';
import { loadConfig, redisConnectionOptions } from '@store/config';
import '@store/database';
import { BotRuntimeManager } from './bot-runtime.manager';
import { DeliveryProcessor, type DeliveryJob } from './delivery.processor';
import { StockAlertProcessor, type StockAlertJob } from './stock-alert.processor';
import { PurchaseAlertProcessor } from './purchase-alert.processor';
import type { PurchaseAlertJob } from '../../api/src/purchase/purchase-alert.queue';
import { AdminBroadcastProcessor } from './admin-broadcast.processor';
import type { AdminBroadcastJob } from '../../api/src/messaging/admin-broadcast.queue';

const config = loadConfig();
const botApiSecret = process.env.BOT_API_SECRET;
if (!botApiSecret) throw new Error('BOT_API_SECRET is required');
await mongoose.connect(config.mongoUri, { autoIndex: false });
const bot = new BotRuntimeManager(config.botToken, config.apiUrl, botApiSecret, config.shopName,
  config.botConfigPollSeconds, config.adminTelegramIds);
await bot.start();
const processor = new DeliveryProcessor(bot, () => bot.getAdminTelegramIds(), config.apiUrl);
const worker = new Worker<DeliveryJob>('delivery', (job) => processor.process(job), { connection: redisConnectionOptions(config.redisUrl), concurrency: Number(process.env.DELIVERY_CONCURRENCY ?? 5),
  lockDuration: 60_000, stalledInterval: 30_000, maxStalledCount: 1 });
worker.on('failed', (job, error) => {
  const exhausted = !job || error instanceof Error && error.name === 'UnrecoverableError' || job.attemptsMade >= (job.opts.attempts ?? 1);
  if (exhausted) void processor.onFailed(job, error);
});
worker.on('error', (error) => console.error({ event: 'delivery-worker-error', message: error.message }));
const stockAlertProcessor = new StockAlertProcessor(bot);
const stockAlertWorker = new Worker<StockAlertJob>('product-restock-alerts', (job) => stockAlertProcessor.process(job), {
  connection: redisConnectionOptions(config.redisUrl), concurrency: 1, lockDuration: 10 * 60_000, stalledInterval: 60_000, maxStalledCount: 1,
});
stockAlertWorker.on('failed', (job, error) => console.error({ event: 'product-restock-alert-failed', jobId: job?.id, message: error.message }));
stockAlertWorker.on('error', (error) => console.error({ event: 'product-restock-alert-worker-error', message: error.message }));
const purchaseAlertProcessor = new PurchaseAlertProcessor(bot);
const purchaseAlertWorker = new Worker<PurchaseAlertJob>('purchase-social-proofs',
  (job) => purchaseAlertProcessor.process(job), {
    connection: redisConnectionOptions(config.redisUrl), concurrency: 1,
    lockDuration: 10 * 60_000, stalledInterval: 60_000, maxStalledCount: 1,
  });
purchaseAlertWorker.on('failed', (job, error) => console.error({ event: 'purchase-social-proof-failed',
  jobId: job?.id, message: error.message }));
purchaseAlertWorker.on('error', (error) => console.error({ event: 'purchase-social-proof-worker-error', message: error.message }));
const adminBroadcastProcessor = new AdminBroadcastProcessor(bot);
const adminBroadcastWorker = new Worker<AdminBroadcastJob>('admin-broadcasts',
  (job) => adminBroadcastProcessor.process(job), { connection: redisConnectionOptions(config.redisUrl), concurrency: 1,
    lockDuration: 10 * 60_000, stalledInterval: 60_000, maxStalledCount: 1 });
adminBroadcastWorker.on('failed', (job, error) => console.error({ event: 'admin-broadcast-failed', jobId: job?.id, message: error.message }));
adminBroadcastWorker.on('error', (error) => console.error({ event: 'admin-broadcast-worker-error', message: error.message }));
console.log('Telegram bot, delivery, restock, purchase-proof, and admin-broadcast workers started');

async function shutdown(signal: string) {
  console.log(`Received ${signal}, shutting down`);
  bot.stop(signal); await Promise.all([worker.close(), stockAlertWorker.close(), purchaseAlertWorker.close(), adminBroadcastWorker.close()]);
  await mongoose.disconnect(); process.exit(0);
}
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
