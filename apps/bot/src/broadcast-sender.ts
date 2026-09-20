import { MongoBroadcastRateGate, type BroadcastRateGate } from './broadcast-rate-store';

export interface BroadcastSender {
  send<T>(chatId: string | number, deliver: () => Promise<T>): Promise<T>;
}

export interface BroadcastClock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

const systemClock: BroadcastClock = { now: () => Date.now(), sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) };
const MAX_PERMIT_WAIT_MS = 5_000;
const MAX_SEND_ATTEMPTS = 3;

/** The queue must retry this page without advancing its recipient cursor. */
export class BroadcastRetryError extends Error {
  readonly retryAfterMs: number;
  constructor(message: string, options?: ErrorOptions & { retryAfterMs?: number }) {
    super(message, options);
    this.name = 'BroadcastRetryError';
    this.retryAfterMs = Number.isFinite(options?.retryAfterMs) && options!.retryAfterMs! > 0
      ? Math.ceil(options!.retryAfterMs!) : 5_000;
  }
}

/** Match the five-minute recipient claim window in the database schemas. */
export function broadcastClaimRetryAfter(updatedAt?: Date) {
  const startedAt = updatedAt?.getTime();
  return Math.max(1_000, (Number.isFinite(startedAt) ? startedAt! : Date.now()) + 5 * 60_000 - Date.now());
}

/** Only confirmed flood-control rejections are safe to automatically resend. */
export class TelegramBroadcastSender implements BroadcastSender {
  constructor(private readonly gate: BroadcastRateGate = new MongoBroadcastRateGate(), private readonly clock: BroadcastClock = systemClock) {}

  async send<T>(chatId: string | number, deliver: () => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < MAX_SEND_ATTEMPTS; attempt++) {
      await this.acquire(String(chatId));
      try { return await deliver(); }
      catch (error) {
        const response = (error as { response?: { error_code?: number; parameters?: { retry_after?: number } } } | null)?.response;
        if (response?.error_code !== 429) throw error;
        const seconds = response.parameters?.retry_after;
        const delay = (typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds * 1_000) : 1_000) + 100;
        try { await this.gate.defer(delay); }
        catch (cause) { throw new BroadcastRetryError('Unable to share Telegram broadcast cooldown', { cause, retryAfterMs: delay }); }
        // Long cooldowns belong to the durable queue, not a 60-second serverless invocation.
        if (delay > MAX_PERMIT_WAIT_MS || attempt === MAX_SEND_ATTEMPTS - 1) {
          throw new BroadcastRetryError('Telegram broadcast is rate limited; retry this page', { cause: error, retryAfterMs: delay });
        }
      }
    }
    throw new BroadcastRetryError('Telegram broadcast attempts exhausted');
  }

  private async acquire(chatId: string) {
    const deadline = this.clock.now() + MAX_PERMIT_WAIT_MS;
    for (;;) {
      let permit: Awaited<ReturnType<BroadcastRateGate['acquire']>>;
      try { permit = await this.gate.acquire(chatId); }
      catch (cause) { throw new BroadcastRetryError('Unable to acquire Telegram broadcast permit', { cause }); }
      if (permit.granted) return;
      const delay = Math.max(1, Math.ceil(permit.retryAfterMs));
      if (!Number.isFinite(delay) || this.clock.now() + delay > deadline) {
        throw new BroadcastRetryError('Telegram broadcast capacity is busy; retry this page', { retryAfterMs: delay });
      }
      await this.clock.sleep(delay);
    }
  }
}

export const broadcastSender: BroadcastSender = new TelegramBroadcastSender();

/** Bounded concurrency hides HTTP/DB latency; the shared gate controls actual send starts. */
export async function forEachBroadcastRecipient<T>(items: readonly T[], process: (item: T) => Promise<void>, concurrency = 12) {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw new Error('Invalid broadcast concurrency');
  let cursor = 0;
  let failed = false;
  let failure: unknown;
  const worker = async () => {
    while (!failed && cursor < items.length) {
      const item = items[cursor++]!;
      try { await process(item); }
      catch (error) { if (!failed) { failed = true; failure = error; } }
    }
  };
  // Drain in-flight work before surfacing errors: no sends may outlive the page response.
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  if (failed) throw failure;
}
