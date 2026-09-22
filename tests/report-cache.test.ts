import { describe, expect, spyOn, test } from 'bun:test';
import { ReportCache } from '../apps/api/src/analytics/report-cache';

describe('short report cache', () => {
  test('shares in-flight reads, expires after fifteen seconds, and never retains failures', async () => {
    let now = 1_000;
    const clock = spyOn(Date, 'now').mockImplementation(() => now);
    try {
      const cache = new ReportCache<number>();
      let calls = 0;
      const load = async () => ++calls;
      const first = cache.get('report', load);
      expect(cache.get('report', load)).toBe(first);
      expect(await first).toBe(1);
      now += 14_999;
      expect(await cache.get('report', load)).toBe(1);
      now++;
      expect(await cache.get('report', load)).toBe(2);
      await expect(cache.get('failed', async () => { throw new Error('temporary failure'); })).rejects.toThrow('temporary failure');
      expect(await cache.get('failed', load)).toBe(3);
    } finally { clock.mockRestore(); }
  });

  test('forced refresh cannot be overwritten by an older in-flight result', async () => {
    const cache = new ReportCache<number>();
    let finishOld!: (value: number) => void;
    const old = cache.get('report', () => new Promise((resolve) => { finishOld = resolve; }));
    await Promise.resolve();
    expect(await cache.get('report', async () => 2, true)).toBe(2);
    finishOld(1);
    expect(await old).toBe(1);
    expect(await cache.get('report', async () => 3)).toBe(2);
    expect(await cache.get('report', async () => 3, true)).toBe(3);
  });

  test('caps retained report filters at 32 entries', async () => {
    const cache = new ReportCache<number>();
    for (let index = 0; index < 33; index++) await cache.get(String(index), async () => index);
    expect(await cache.get('32', async () => -1)).toBe(32);
    expect(await cache.get('0', async () => 100)).toBe(100);
  });
});
