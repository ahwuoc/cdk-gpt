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
import { PurchaseAlertProcessor, type PurchaseAlertBatch } from '../../bot/src/purchase-alert.processor';
import { AdminBroadcastProcessor, type AdminBroadcastBatch } from '../../bot/src/admin-broadcast.processor';
import { processServerlessBroadcastPage } from '../../bot/src/broadcast-queue-retry';

type TelegramClient = { telegram: Pick<Telegram, 'sendMessage' | 'sendDocument' | 'deleteMessage'> };
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

export function purchaseAlertTaskFrom(value: unknown): PurchaseAlertBatch | undefined {
  if (!isRecord(value) || typeof value.purchaseGroupId !== 'string' || typeof value.productId !== 'string' ||
    typeof value.buyerId !== 'string' || !Types.ObjectId.isValid(value.purchaseGroupId) ||
    !Types.ObjectId.isValid(value.productId) || !Types.ObjectId.isValid(value.buyerId) ||
    typeof value.quantity !== 'number' || !Number.isSafeInteger(value.quantity) || value.quantity < 1 || value.quantity > 100) {
    return undefined;
  }
  if (value.cursor !== undefined && (typeof value.cursor !== 'string' || !Types.ObjectId.isValid(value.cursor))) return undefined;
  if (value.limit !== undefined && (typeof value.limit !== 'number' || !Number.isSafeInteger(value.limit) || value.limit < 1 || value.limit > 100)) return undefined;
  return {
    purchaseGroupId: value.purchaseGroupId, productId: value.productId, buyerId: value.buyerId,
    quantity: value.quantity,
    ...(typeof value.cursor === 'string' ? { cursor: value.cursor } : {}),
    ...(typeof value.limit === 'number' ? { limit: value.limit } : {}),
  };
}

export function adminBroadcastTaskFrom(value: unknown): AdminBroadcastBatch | undefined {
  if (!isRecord(value) || typeof value.campaignId !== 'string' || !Types.ObjectId.isValid(value.campaignId)) return undefined;
  if (value.cursor !== undefined && (typeof value.cursor !== 'string' || !Types.ObjectId.isValid(value.cursor))) return undefined;
  if (value.limit !== undefined && (typeof value.limit !== 'number' || !Number.isSafeInteger(value.limit) || value.limit < 1 || value.limit > 100)) return undefined;
  return { campaignId: value.campaignId,
    ...(typeof value.cursor === 'string' ? { cursor: value.cursor } : {}),
    ...(typeof value.limit === 'number' ? { limit: value.limit } : {}) };
}

export async function processDeliveryTask(orderId: string, retried = 0) {
  const { client, runtime } = await currentTelegramRuntime();
  const processor = new DeliveryProcessor(client, runtime.adminTelegramIds, runtime.apiUrl);
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
  const publisher = new QStashTaskPublisher(() => config.getQStashRuntimeConfig());
  const result = await processServerlessBroadcastPage(() => processor.processBatch(task), {
    publisher, path: '/api/internal/tasks/restock', payload: { ...task },
    deduplicationId: `product-restocked-${task.importBatchId}-${task.cursor ?? 'start'}`,
  });
  if ('nextCursor' in result && result.nextCursor) {
    await publisher.publish('/api/internal/tasks/restock', {
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

export async function processPurchaseAlertTask(task: PurchaseAlertBatch) {
  const { client, config } = await currentTelegramRuntime();
  const processor = new PurchaseAlertProcessor(client);
  const publisher = new QStashTaskPublisher(() => config.getQStashRuntimeConfig());
  const result = await processServerlessBroadcastPage(() => processor.processBatch(task), {
    publisher, path: '/api/internal/tasks/purchase-alert', payload: { ...task },
    deduplicationId: `purchase-proof-${task.purchaseGroupId}-${task.cursor ?? 'start'}`,
  });
  if ('nextCursor' in result && result.nextCursor) {
    await publisher.publish('/api/internal/tasks/purchase-alert', {
      ...task, cursor: result.nextCursor, limit: task.limit ?? 50,
    }, {
      deduplicationId: `purchase-proof-${task.purchaseGroupId}-${result.nextCursor}`,
      retries: 5,
    });
  }
  return result;
}

export async function processAdminBroadcastTask(task: AdminBroadcastBatch) {
  const { client, config } = await currentTelegramRuntime();
  const publisher = new QStashTaskPublisher(() => config.getQStashRuntimeConfig());
  const result = await processServerlessBroadcastPage(() => new AdminBroadcastProcessor(client).processBatch(task), {
    publisher, path: '/api/internal/tasks/admin-broadcast', payload: { ...task },
    deduplicationId: `admin-broadcast-${task.campaignId}-${task.cursor ?? 'start'}`,
  });
  if ('nextCursor' in result && result.nextCursor) {
    await publisher.publish('/api/internal/tasks/admin-broadcast', {
      ...task, cursor: result.nextCursor, limit: task.limit ?? 50,
    }, { deduplicationId: `admin-broadcast-${task.campaignId}-${result.nextCursor}`, retries: 5 });
  }
  return result;
}

/**
 * Scheduled maintenance is deliberately idempotent. Bank credit is callback-
 * driven; this route only releases expired reservations and re-publishes a
 * delivery if a task acknowledgement was lost after a Mongo transaction.
 */
export async function runServerlessMaintenance() {
  const app = await getServerlessApi();
  const reservations = app.get(InventoryReservationService);
  const payments = app.get(PaymentService);
  const queue = app.get<DeliveryQueueClient>(DELIVERY_QUEUE);
  const quickCheckouts = await payments.recoverApprovedQuickCheckouts(25);
  const pending = await OrderModel.find({ status: OrderStatus.PENDING_DELIVERY, deliveryStatus: DeliveryStatus.PENDING })
    // Keep the cron below Vercel's 60-second deadline even if QStash is slow.
    // The next maintenance run picks up the next page; publishing is idempotent.
    .select('_id').sort({ 'metadata.deliveryDispatchAttemptAt': 1, createdAt: 1 })
    .limit(PENDING_DELIVERY_RECOVERY_LIMIT).lean();
  const pendingIds = pending.map((order) => order._id.toString());
  const dispatch = await republishPendingDeliveries(queue, pendingIds);
  const dispatchedObjectIds = dispatch.succeededIds.map((id) => new Types.ObjectId(id));
  await OrderModel.updateMany({ _id: { $in: dispatchedObjectIds },
    status: OrderStatus.PENDING_DELIVERY, deliveryStatus: DeliveryStatus.PENDING },
  { $set: { 'metadata.deliveryDispatchAttemptAt': new Date() } });
  // A successfully re-published task needs a fresh delivery window. Do not
  // cancel/refund it in the same maintenance run before QStash can execute it.
  await reservations.extendOrderReservations(dispatch.succeededIds, new Date(Date.now() + 15 * 60_000));
  if (dispatch.failed) console.error({ event: 'pending-delivery-republish-partial-failure', failed: dispatch.failed });
  // Serverless recovery never auto-cancels paid orders. It only frees unpaid
  // QR holds; pending paid orders stay in the durable outbox until dispatched.
  const released = await reservations.releaseExpiredPaymentHolds(100);
  const bankPayments = await payments.expireBankTopups(25);
  return { reservations: released, quickCheckouts, pendingDeliveriesRepublished: dispatch.republished,
    pendingDeliveryPublishFailures: dispatch.failed, bankPayments };
}

async function republishPendingDeliveries(queue: DeliveryQueueClient, orderIds: string[]) {
  let cursor = 0;
  let republished = 0;
  let failed = 0;
  const succeededIds: string[] = [];
  await Promise.all(Array.from({ length: Math.min(PENDING_DELIVERY_PUBLISH_CONCURRENCY, orderIds.length) }, async () => {
    while (cursor < orderIds.length) {
      const orderId = orderIds[cursor++];
      try {
        await queue.enqueue(orderId);
        republished++;
        succeededIds.push(orderId);
      } catch { failed++; }
    }
  }));
  return { republished, failed, succeededIds };
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
