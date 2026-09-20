import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DelayedError, Queue, Worker } from 'bullmq';
import { QStashTaskPublisher } from '../apps/api/src/serverless/qstash';
import { processBroadcastQueueJob, processServerlessBroadcastPage } from '../apps/bot/src/broadcast-queue-retry';
import { BroadcastRetryError } from '../apps/bot/src/broadcast-sender';

const originalTaskSecret = process.env.TASK_QUEUE_SECRET;
afterEach(() => {
  mock.restore();
  if (originalTaskSecret === undefined) delete process.env.TASK_QUEUE_SECRET;
  else process.env.TASK_QUEUE_SECRET = originalTaskSecret;
});

describe('durable BullMQ broadcast deferral', () => {
  test('moves a five-minute claim retry to delayed with the active job token', async () => {
    spyOn(Date, 'now').mockReturnValue(1_000);
    const moveToDelayed = mock(async (_at: number, _token?: string) => {});
    await expect(processBroadcastQueueJob({ moveToDelayed }, 'worker-lock', async () => {
      throw new BroadcastRetryError('claim still active', { retryAfterMs: 300_000 });
    })).rejects.toBeInstanceOf(DelayedError);
    expect(moveToDelayed).toHaveBeenCalledWith(301_000, 'worker-lock');
  });

  test('ordinary processor errors retain the normal retry policy', async () => {
    const moveToDelayed = mock(async () => {});
    const failure = new Error('database write failed');
    await expect(processBroadcastQueueJob({ moveToDelayed }, 'worker-lock', async () => {
      throw failure;
    })).rejects.toBe(failure);
    expect(moveToDelayed).not.toHaveBeenCalled();
  });

  test('a failed delayed move propagates instead of acknowledging the job', async () => {
    const failure = new Error('Redis unavailable');
    const moveToDelayed = mock(async () => { throw failure; });
    await expect(processBroadcastQueueJob({ moveToDelayed }, 'worker-lock', async () => {
      throw new BroadcastRetryError('cooldown');
    })).rejects.toBe(failure);
  });

  test('successful pages return normally without a delayed move', async () => {
    const moveToDelayed = mock(async () => {});
    const result = { status: 'complete', sent: 50 };
    expect(await processBroadcastQueueJob({ moveToDelayed }, 'worker-lock', async () => result)).toBe(result);
    expect(moveToDelayed).not.toHaveBeenCalled();
  });
});

describe('durable serverless broadcast deferral', () => {
  test('republishes the same page with the full cooldown and a fresh deduplication ID', async () => {
    const publish = mock<QStashTaskPublisher['publish']>(async () => {});
    const payload = { campaignId: 'campaign', cursor: 'same-cursor', limit: 50 };
    const retry = { publisher: { publish }, payload,
      path: '/api/internal/tasks/admin-broadcast', deduplicationId: 'broadcast-campaign-same-cursor' };
    const run = () => processServerlessBroadcastPage(async () => {
      throw new BroadcastRetryError('cooldown', { retryAfterMs: 120_100 });
    }, retry);

    expect(await run()).toEqual({ status: 'deferred', retryAfterMs: 120_100 });
    expect(await run()).toEqual({ status: 'deferred', retryAfterMs: 120_100 });
    for (const [path, body, options] of publish.mock.calls) {
      expect(path).toBe(retry.path);
      expect(body).toEqual(payload);
      expect(options).toMatchObject({ delayMs: 120_100, retries: 5 });
      expect(options.deduplicationId).toStartWith(`${retry.deduplicationId}-deferred-`);
    }
    expect(publish.mock.calls[0]![2].deduplicationId).not.toBe(publish.mock.calls[1]![2].deduplicationId);
  });

  test('a failed republish propagates so the current QStash delivery retries', async () => {
    const failure = new Error('QStash unavailable');
    const publish = mock<QStashTaskPublisher['publish']>(async () => { throw failure; });
    await expect(processServerlessBroadcastPage(async () => {
      throw new BroadcastRetryError('cooldown');
    }, { publisher: { publish }, path: '/api/internal/tasks/restock', payload: { cursor: 'unchanged' },
      deduplicationId: 'restock' })).rejects.toBe(failure);
  });

  test('successful pages and ordinary failures are not republished by the deferral helper', async () => {
    const publish = mock<QStashTaskPublisher['publish']>(async () => {});
    const retry = { publisher: { publish }, path: '/api/internal/tasks/purchase-alert',
      payload: { cursor: 'unchanged' }, deduplicationId: 'purchase-proof' };
    const result = { status: 'complete', nextCursor: 'next-cursor' };
    expect(await processServerlessBroadcastPage(async () => result, retry)).toBe(result);
    const failure = new Error('invalid task');
    await expect(processServerlessBroadcastPage(async () => { throw failure; }, retry)).rejects.toBe(failure);
    expect(publish).not.toHaveBeenCalled();
  });

  test('caps each delayed publish to seven days while longer cooldowns remain in the rate store', async () => {
    const publish = mock<QStashTaskPublisher['publish']>(async () => {});
    const result = await processServerlessBroadcastPage(async () => {
      throw new BroadcastRetryError('cooldown', { retryAfterMs: 8 * 86_400_000 });
    }, { publisher: { publish }, path: '/api/internal/tasks/restock', payload: {}, deduplicationId: 'restock' });
    expect(result.retryAfterMs).toBe(7 * 86_400_000);
    expect(publish.mock.calls[0]![2].delayMs).toBe(7 * 86_400_000);
  });
});

describe('QStash delayed publish HTTP request', () => {
  const publisher = () => new QStashTaskPublisher(async () => ({ endpoint: 'https://queue.example.invalid',
    taskBaseUrl: 'https://shop.example.invalid', token: 'fixture-token' }));

  test('uses the documented delay header rounded up to whole seconds', async () => {
    process.env.TASK_QUEUE_SECRET = 'fixture-secret';
    const request = spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    await publisher().publish('/api/internal/tasks/admin-broadcast', { cursor: 'unchanged' },
      { deduplicationId: 'deferred-fixture', delayMs: 120_100, retries: 5 });
    const options = request.mock.calls[0]![1]!;
    const headers = new Headers(options.headers);
    expect(headers.get('upstash-delay')).toBe('121s');
    expect(headers.get('upstash-deduplication-id')).toBe('deferred-fixture');
    expect(headers.get('upstash-retries')).toBe('5');
    expect(JSON.parse(options.body as string)).toEqual({ cursor: 'unchanged' });
  });

  test('regular publishes have no delay and HTTP failures propagate', async () => {
    process.env.TASK_QUEUE_SECRET = 'fixture-secret';
    const request = spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 503 }));
    await expect(publisher().publish('/api/internal/tasks/restock', {}, { deduplicationId: 'regular' }))
      .rejects.toThrow('HTTP 503');
    expect(new Headers(request.mock.calls[0]![1]!.headers).has('upstash-delay')).toBe(false);
  });

  test('rejects invalid delays before attempting a publish', async () => {
    const request = spyOn(globalThis, 'fetch');
    for (const delayMs of [-1, Number.NaN, Number.POSITIVE_INFINITY, 8 * 86_400_000]) {
      await expect(publisher().publish('/api/internal/tasks/restock', {}, { deduplicationId: 'invalid', delayMs }))
        .rejects.toThrow('Invalid serverless task delay');
    }
    expect(request).not.toHaveBeenCalled();
  });
});

const integration = process.env.RUN_INTEGRATION === '1' ? test : test.skip;
integration('BullMQ deferrals preserve the one-attempt job across repeated five-minute cooldowns', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'broadcast-retry-'));
  const socket = join(directory, 'redis.sock');
  const redis = spawn('redis-server', ['--port', '0', '--unixsocket', socket, '--save', '', '--appendonly', 'no'],
    { stdio: 'ignore' });
  const connection = { path: socket, maxRetriesPerRequest: null };
  const queue = new Queue('broadcast-deferred-fixture', { connection });
  let starts = 0;
  const failures: Error[] = [];
  const worker = new Worker('broadcast-deferred-fixture', (job, token) => processBroadcastQueueJob(job, token, async () => {
    starts++;
    if (starts <= 2) throw new BroadcastRetryError('five-minute cooldown', { retryAfterMs: 300_000 });
    return job.data;
  }), { connection });
  worker.on('failed', (_job, error) => { failures.push(error); });
  try {
    await worker.waitUntilReady();
    const queued = await queue.add('broadcast', { cursor: 'unchanged' }, { attempts: 1 });
    for (let iteration = 0; iteration < 2; iteration++) {
      await waitFor(async () => (await queued.getState()) === 'delayed');
      const delayed = (await queue.getJob(queued.id!))!;
      expect(delayed.attemptsMade).toBe(0);
      expect(delayed.delay).toBeGreaterThanOrEqual(299_000);
      expect(delayed.data).toEqual({ cursor: 'unchanged' });
      await delayed.promote();
    }
    await waitFor(async () => (await queued.getState()) === 'completed');
    expect(starts).toBe(3);
    expect(failures).toHaveLength(0);
    expect((await queue.getJob(queued.id!))!.returnvalue).toEqual({ cursor: 'unchanged' });
  } finally {
    await worker.close(true);
    await queue.close();
    redis.kill('SIGTERM');
    await new Promise<void>((resolve) => { if (redis.exitCode !== null) resolve(); else redis.once('exit', () => resolve()); });
    await rm(directory, { recursive: true, force: true });
  }
}, 20_000);

async function waitFor(check: () => Promise<boolean>) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for isolated test queue');
}
