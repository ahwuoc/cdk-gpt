import { UnrecoverableError } from 'bullmq';
import { Telegram } from 'telegraf';
import { Types } from 'mongoose';
import { OrderModel } from '@store/database';
import { DeliveryStatus, OrderStatus } from '@store/shared';
import { BotConfigService } from '../../api/src/bot-config/bot-config.service';
import { sharedSecretMatches } from '../../api/src/auth/shared-secret';
import { DELIVERY_QUEUE, type DeliveryQueueClient } from '../../api/src/delivery/delivery.queue';
import { InventoryReservationService } from '../../api/src/inventory/inventory-reservation.service';
import { PaymentService } from '../../api/src/payment/payment.service';
import { getServerlessApi } from '../../api/src/serverless';
import { QStashTaskPublisher } from '../../api/src/serverless/qstash';
import { DeliveryProcessor } from '../../bot/src/delivery.processor';
import { StockAlertProcessor, type StockAlertBatch } from '../../bot/src/stock-alert.processor';

type TelegramClient = { telegram: Telegram };
const PENDING_DELIVERY_RECOVERY_LIMIT = 10;
const PENDING_DELIVERY_PUBLISH_CONCURRENCY = 5;

export function taskRequestIsAuthorized(request: Request) {
  return sharedSecretMatches(request.headers.get('x-task-secret') ?? undefined, process.env.TASK_QUEUE_SECRET);
}

export function cronRequestIsAuthorized(request: Request) {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  return sharedSecretMatches(token, process.env.CRON_SECRET);
}

export function deliveryTaskFrom(value: unknown) {
  if (!isRecord(value) || typeof value.orderId !== 'string' || !Types.ObjectId.isValid(value.orderId)) return undefined;
  return { orderId: value.orderId };
}

export function restockTaskFrom(value: unknown): StockAlertBatch | undefined {
  if (!isRecord(value) || typeof value.productId !== 'string' || typeof value.importBatchId !== 'string'
    || !Types.ObjectId.isValid(value.productId) || !Types.ObjectId.isValid(value.importBatchId)
    || typeof value.importedRows !== 'number' || !Number.isSafeInteger(value.importedRows) || value.importedRows < 1) return undefined;
  if (value.cursor !== undefined && (typeof value.cursor !== 'string' || !Types.ObjectId.isValid(value.cursor))) return undefined;
  if (value.limit !== undefined && (typeof value.limit !== 'number' || !Number.isSafeInteger(value.limit) || value.limit < 1 || value.limit > 100)) return undefined;
  return {
    productId: value.productId,
    importBatchId: value.importBatchId,
    importedRows: value.importedRows,
    ...(typeof value.cursor === 'string' ? { cursor: value.cursor } : {}),
    ...(typeof value.limit === 'number' ? { limit: value.limit } : {}),
  };
}

export async function processDeliveryTask(orderId: string, retried = 0) {
  const { client, runtime } = await currentTelegramRuntime();
  const processor = new DeliveryProcessor(client, runtime.adminTelegramIds);
  const attempt = { id: `qstash-${orderId}`, data: { orderId }, attemptsMade: retried };
  try {
    return await processor.process(attempt as never);
  } catch (error) {
    // Permanent and ambiguous delivery failures are intentionally not retried:
    // the processor preserves the reserved item and creates an admin alert.
    if (error instanceof UnrecoverableError) {
      await processor.onFailed(attempt as never, error);
      return { status: 'manual-review' };
    }
    throw error;
  }
}

export async function processRestockTask(task: StockAlertBatch) {
  const { client, config } = await currentTelegramRuntime();
  const processor = new StockAlertProcessor(client);
  const result = await processor.processBatch(task);
  if ('nextCursor' in result && result.nextCursor) {
    await new QStashTaskPublisher(() => config.getQStashRuntimeConfig()).publish('/api/internal/tasks/restock', {
      ...task,
      cursor: result.nextCursor,
      limit: task.limit ?? 50,
    }, {
      deduplicationId: `product-restocked-${task.importBatchId}-${result.nextCursor}`,
      retries: 5,
    });
  }
  return result;
}

/**
 * Scheduled maintenance is deliberately idempotent. It handles automatic bank
 * checks, expired reservations, and re-publishes pending deliveries if a task
 * publish acknowledgement was lost after a Mongo transaction committed.
 */
export async function runServerlessMaintenance() {
  const app = await getServerlessApi();
  const payments = app.get(PaymentService);
  const reservations = app.get(InventoryReservationService);
  const queue = app.get<DeliveryQueueClient>(DELIVERY_QUEUE);
  const [bank, released] = await Promise.all([payments.pollBankHistory(), reservations.releaseExpired(100)]);
  const pending = await OrderModel.find({ status: OrderStatus.PENDING_DELIVERY, deliveryStatus: DeliveryStatus.PENDING })
    // Keep the cron below Vercel's 60-second deadline even if QStash is slow.
    // The next minute picks up the next page; queue publishing is idempotent.
    .select('_id').sort({ createdAt: 1 }).limit(PENDING_DELIVERY_RECOVERY_LIMIT).lean();
  const republished = await republishPendingDeliveries(queue, pending.map((order) => order._id.toString()));
  return { bank, reservations: released, pendingDeliveriesRepublished: republished };
}

async function republishPendingDeliveries(queue: DeliveryQueueClient, orderIds: string[]) {
  let cursor = 0;
  let republished = 0;
  const failures: unknown[] = [];
  await Promise.all(Array.from({ length: Math.min(PENDING_DELIVERY_PUBLISH_CONCURRENCY, orderIds.length) }, async () => {
    while (cursor < orderIds.length) {
      const orderId = orderIds[cursor++];
      try {
        await queue.enqueue(orderId);
        republished++;
      } catch (error) {
        failures.push(error);
      }
    }
  }));
  if (failures.length) throw failures[0];
  return republished;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

async function currentTelegramRuntime() {
  const app = await getServerlessApi();
  const config = app.get(BotConfigService);
  const [{ token }, runtime] = await Promise.all([config.getRuntimeBotToken(), config.getRuntimeOperationalConfig()]);
  return { client: { telegram: new Telegram(token) } satisfies TelegramClient, runtime, config };
}
