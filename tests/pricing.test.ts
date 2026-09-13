import { describe, expect, test } from 'bun:test';
import { productDiscountPercent, productOriginalPriceAfterChange } from '@store/shared';

describe('sale pricing', () => {
  test('calculates a rounded discount only for a real lower sale price', () => {
    expect(productDiscountPercent(85_000, 100_000)).toBe(15);
    expect(productDiscountPercent(90_000, 100_000)).toBe(10);
    expect(productDiscountPercent(100_000, 100_000)).toBe(0);
    expect(productDiscountPercent(120_000, 100_000)).toBe(0);
    expect(productDiscountPercent(85_000)).toBe(0);
    expect(productDiscountPercent(0, 100_000)).toBe(100);
  });

  test('keeps the first original price until the sale has ended', () => {
    expect(productOriginalPriceAfterChange(100_000, undefined, 85_000)).toBe(100_000);
    expect(productOriginalPriceAfterChange(85_000, 100_000, 80_000)).toBe(100_000);
    expect(productOriginalPriceAfterChange(80_000, 100_000, 90_000)).toBe(100_000);
    expect(productOriginalPriceAfterChange(90_000, 100_000, 100_000)).toBeUndefined();
    expect(productOriginalPriceAfterChange(100_000, undefined, 120_000)).toBeUndefined();
  });
});
