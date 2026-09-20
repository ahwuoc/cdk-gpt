import { describe, expect, mock, test } from 'bun:test';
import {
  BroadcastRetryError,
  TelegramBroadcastSender,
  forEachBroadcastRecipient,
  type BroadcastClock,
} from '../apps/bot/src/broadcast-sender';
import type { BroadcastRateGate } from '../apps/bot/src/broadcast-rate-store';

describe('Telegram broadcast sender', () => {
  test('acquires permission for the chat before sending and preserves the Telegram result', async () => {
    const fixture = senderFixture();
    const response = { message_id: 42 };
    const deliver = mock(async () => {
      expect(fixture.gate.acquire).toHaveBeenCalledWith('123');
      return response;
    });

    expect(await fixture.sender.send(123, deliver)).toBe(response);
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(fixture.sleeps).toEqual([]);
  });

  test('waits for denied reservations and reacquires before delivering', async () => {
    const fixture = senderFixture();
    fixture.gate.acquire
      .mockResolvedValueOnce({ granted: false, retryAfterMs: 40 })
      .mockResolvedValueOnce({ granted: false, retryAfterMs: 60 });
    const deliver = mock(async () => 'sent');

    expect(await fixture.sender.send('chat', deliver)).toBe('sent');
    expect(fixture.sleeps).toEqual([40, 60]);
    expect(fixture.gate.acquire).toHaveBeenCalledTimes(3);
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  test('hands persistent rate contention back to the queue within the five-second wait budget', async () => {
    const fixture = senderFixture();
    fixture.gate.acquire.mockResolvedValue({ granted: false, retryAfterMs: 2_000 });
    const deliver = mock(async () => 'sent');

    await expect(fixture.sender.send('chat', deliver)).rejects.toBeInstanceOf(BroadcastRetryError);
    expect(fixture.clock.now()).toBeLessThanOrEqual(5_000);
    expect(fixture.gate.acquire.mock.calls.length).toBeGreaterThan(1);
    expect(deliver).not.toHaveBeenCalled();
  });

  test('does not wait out a rate reservation longer than the in-worker budget', async () => {
    const fixture = senderFixture();
    fixture.gate.acquire.mockResolvedValue({ granted: false, retryAfterMs: 10_000 });
    const deliver = mock(async () => 'sent');

    await expect(fixture.sender.send('chat', deliver)).rejects.toBeInstanceOf(BroadcastRetryError);
    expect(fixture.clock.now()).toBeLessThanOrEqual(5_000);
    expect(deliver).not.toHaveBeenCalled();
  });

  test('retries a 429 only after the shared cooldown and a new reservation', async () => {
    const fixture = senderFixture({ honorCooldown: true });
    const response = { message_id: 42 };
    const deliver = mock(async () => response).mockRejectedValueOnce(rateLimit(1));

    expect(await fixture.sender.send('chat', deliver)).toBe(response);
    expect(fixture.gate.defer).toHaveBeenCalledWith(1_100);
    expect(fixture.clock.now()).toBeGreaterThanOrEqual(1_100);
    expect(fixture.gate.acquire.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(deliver).toHaveBeenCalledTimes(2);
  });

  test('limits rate-limit delivery retries to three total attempts', async () => {
    const fixture = senderFixture({ honorCooldown: true });
    const deliver = mock(async () => { throw rateLimit(1); });

    await expect(fixture.sender.send('chat', deliver)).rejects.toBeInstanceOf(BroadcastRetryError);
    expect(deliver).toHaveBeenCalledTimes(3);
    expect(fixture.gate.defer).toHaveBeenCalledTimes(3);
    expect(fixture.clock.now()).toBeGreaterThanOrEqual(2_200);
  });

  test('publishes a long Telegram cooldown before deferring the page to the queue', async () => {
    const fixture = senderFixture({ honorCooldown: true });
    const deliver = mock(async () => { throw rateLimit(6); });

    await expect(fixture.sender.send('chat', deliver)).rejects.toBeInstanceOf(BroadcastRetryError);
    expect(fixture.gate.defer).toHaveBeenCalledWith(6_100);
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(fixture.clock.now()).toBeLessThanOrEqual(5_000);
  });

  test('an unavailable rate store is retryable without attempting delivery', async () => {
    const fixture = senderFixture();
    fixture.gate.acquire.mockRejectedValue(new Error('database unavailable'));
    const deliver = mock(async () => 'sent');

    await expect(fixture.sender.send('chat', deliver)).rejects.toBeInstanceOf(BroadcastRetryError);
    expect(deliver).not.toHaveBeenCalled();
  });

  test('a failed shared cooldown update is retryable without another Telegram call', async () => {
    const fixture = senderFixture();
    fixture.gate.defer.mockRejectedValue(new Error('database unavailable'));
    const deliver = mock(async () => { throw rateLimit(1); });

    await expect(fixture.sender.send('chat', deliver)).rejects.toBeInstanceOf(BroadcastRetryError);
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  test('does not retry a recipient who blocked the bot', async () => {
    const fixture = senderFixture();
    const error = { response: { error_code: 403, description: 'Forbidden: bot was blocked by the user' } };
    const deliver = mock(async () => { throw error; });

    await expect(fixture.sender.send('chat', deliver)).rejects.toBe(error);
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(fixture.gate.defer).not.toHaveBeenCalled();
  });

  test('does not resend an ambiguous network failure that could already have delivered', async () => {
    const fixture = senderFixture();
    const error = new Error('socket disconnected after request was sent');
    const deliver = mock(async () => { throw error; });

    await expect(fixture.sender.send('chat', deliver)).rejects.toBe(error);
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(fixture.gate.defer).not.toHaveBeenCalled();
  });
});

describe('bounded broadcast recipient pool', () => {
  test('defaults to twelve concurrent recipients and processes each recipient once', async () => {
    const recipients = Array.from({ length: 29 }, (_, index) => index);
    const firstWaveStarted = signal();
    const release = signal();
    const started: number[] = [];
    let active = 0;
    let peakActive = 0;
    const processing = forEachBroadcastRecipient(recipients, async (recipient) => {
      started.push(recipient);
      active += 1;
      peakActive = Math.max(peakActive, active);
      if (started.length === 12) firstWaveStarted.open();
      await release.promise;
      active -= 1;
    });

    try {
      await firstWaveStarted.promise;
      expect(started).toHaveLength(12);
      expect(active).toBe(12);
    } finally {
      release.open();
      await processing;
    }
    expect(peakActive).toBe(12);
    expect([...started].sort((left, right) => left - right)).toEqual(recipients);
    expect(active).toBe(0);
  });

  test('a slow recipient leaves other slots available to finish the rest of the page', async () => {
    const releaseSlow = signal();
    const remainingFinished = signal();
    const completed: number[] = [];
    const processing = forEachBroadcastRecipient([0, 1, 2, 3], async (recipient) => {
      if (recipient === 0) await releaseSlow.promise;
      completed.push(recipient);
      if (recipient === 3) remainingFinished.open();
    }, 2);

    try {
      await remainingFinished.promise;
      expect(completed).toEqual([1, 2, 3]);
    } finally {
      releaseSlow.open();
      await processing;
    }
    expect(completed).toEqual([1, 2, 3, 0]);
  });

  test('stops taking recipients on failure and drains in-flight callbacks before rejecting', async () => {
    const failFirst = signal();
    const releaseSecond = signal();
    const bothStarted = signal();
    const error = new Error('rate-store failure');
    const started: number[] = [];
    let secondFinished = false;
    let settled = false;
    const processing = forEachBroadcastRecipient([0, 1, 2, 3], async (recipient) => {
      started.push(recipient);
      if (started.length === 2) bothStarted.open();
      if (recipient === 0) {
        await failFirst.promise;
        throw error;
      }
      await releaseSecond.promise;
      secondFinished = true;
    }, 2).then(
      () => { settled = true; return undefined; },
      (caught: unknown) => { settled = true; return caught; },
    );

    await bothStarted.promise;
    failFirst.open();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    try {
      expect(settled).toBe(false);
      expect(secondFinished).toBe(false);
      expect(started).toEqual([0, 1]);
    } finally {
      releaseSecond.open();
    }
    expect(await processing).toBe(error);
    expect(secondFinished).toBe(true);
    expect(started).toEqual([0, 1]);
  });

  test('an empty page does not invoke the recipient callback', async () => {
    const process = mock(async (_recipient: number) => {});
    await forEachBroadcastRecipient([], process);
    expect(process).not.toHaveBeenCalled();
  });
});

function senderFixture(options: { honorCooldown?: boolean } = {}) {
  let elapsed = 0;
  let blockedUntil = 0;
  const sleeps: number[] = [];
  const clock: BroadcastClock = {
    now: () => elapsed,
    sleep: async (milliseconds) => { sleeps.push(milliseconds); elapsed += milliseconds; },
  };
  const gate = {
    acquire: mock(async (_chatId: string) => {
      const retryAfterMs = Math.max(0, blockedUntil - elapsed);
      return { granted: retryAfterMs === 0, retryAfterMs };
    }),
    defer: mock(async (retryAfterMs: number) => {
      if (options.honorCooldown) blockedUntil = Math.max(blockedUntil, elapsed + retryAfterMs);
    }),
  } satisfies BroadcastRateGate;
  return { clock, gate, sleeps, sender: new TelegramBroadcastSender(gate, clock) };
}

function rateLimit(seconds: number) {
  return { response: { error_code: 429, parameters: { retry_after: seconds } } };
}

function signal() {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => { open = resolve; });
  return { promise, open };
}
