import { randomUUID } from 'node:crypto';
import { DelayedError, type Job } from 'bullmq';
import type { QStashTaskPublisher } from '../../api/src/serverless/qstash';
import { BroadcastRetryError } from './broadcast-sender';

/** Move the existing job without consuming BullMQ's ordinary failure attempts. */
export async function processBroadcastQueueJob<T>(job: Pick<Job, 'moveToDelayed'>, token: string | undefined,
  process: () => Promise<T>): Promise<T> {
  try { return await process(); }
  catch (error) {
    if (!(error instanceof BroadcastRetryError)) throw error;
    await job.moveToDelayed(Date.now() + deferredDelay(error), token);
    throw new DelayedError();
  }
}

interface BroadcastPageRetry {
  publisher: Pick<QStashTaskPublisher, 'publish'>;
  path: string;
  payload: Record<string, unknown>;
  deduplicationId: string;
}

/** Acknowledgement is safe only after the unchanged page has been durably republished. */
export async function processServerlessBroadcastPage<T>(process: () => Promise<T>, retry: BroadcastPageRetry) {
  try { return await process(); }
  catch (error) {
    if (!(error instanceof BroadcastRetryError)) throw error;
    const retryAfterMs = deferredDelay(error);
    await retry.publisher.publish(retry.path, retry.payload, {
      // QStash remembers IDs for ten minutes; a deferred page needs a fresh ID.
      // Recipient claims still make overlapping at-least-once page deliveries safe.
      deduplicationId: `${retry.deduplicationId}-deferred-${randomUUID()}`,
      retries: 5,
      delayMs: retryAfterMs,
    });
    return { status: 'deferred' as const, retryAfterMs };
  }
}

function deferredDelay(error: BroadcastRetryError) {
  const requested = Number.isFinite(error.retryAfterMs) ? error.retryAfterMs : 5_000;
  // QStash's free plan permits delays up to seven days. Longer shared cooldowns
  // are rechecked then and deferred again without spending ordinary attempts.
  return Math.min(7 * 24 * 60 * 60_000, Math.max(1_000, Math.ceil(requested)));
}
