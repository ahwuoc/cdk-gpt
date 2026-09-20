import { describe, expect, test } from 'bun:test';
import { analyticsPresetRange } from '../apps/admin-web/app/admin/analytics-date-range';

describe('analytics report presets in Vietnam calendar dates', () => {
  test('month-to-date follows Vietnam midnight rather than the UTC date', () => {
    expect(analyticsPresetRange('month', new Date('2026-09-30T16:59:59.999Z'))).toEqual({
      from: '2026-09-01', to: '2026-09-30',
    });
    expect(analyticsPresetRange('month', new Date('2026-09-30T17:00:00.000Z'))).toEqual({
      from: '2026-10-01', to: '2026-10-01',
    });
  });

  test('last month includes the entire previous calendar month across the year boundary', () => {
    expect(analyticsPresetRange('lastMonth', new Date('2025-12-31T17:00:00.000Z'))).toEqual({
      from: '2025-12-01', to: '2025-12-31',
    });
  });

  test('last month respects February length in leap and ordinary years', () => {
    expect(analyticsPresetRange('lastMonth', new Date('2024-02-29T17:00:00.000Z'))).toEqual({
      from: '2024-02-01', to: '2024-02-29',
    });
    expect(analyticsPresetRange('lastMonth', new Date('2026-02-28T17:00:00.000Z'))).toEqual({
      from: '2026-02-01', to: '2026-02-28',
    });
  });

  test('rolling periods include the current Vietnam day exactly once', () => {
    const now = new Date('2025-12-31T18:00:00.000Z');
    for (const [preset, from] of [
      ['7', '2025-12-26'], ['30', '2025-12-03'], ['90', '2025-10-04'],
    ]) {
      const range = analyticsPresetRange(preset, now);
      expect(range).toEqual({ from, to: '2026-01-01' });
      expect((Date.parse(range.to) - Date.parse(range.from)) / 86_400_000 + 1).toBe(Number(preset));
    }
  });
});
