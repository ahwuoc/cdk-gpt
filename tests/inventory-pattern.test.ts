import { expect, test } from 'bun:test';
import { inventoryPatternExample, parseInventoryPatternLine, parseInventoryPatternTemplate } from '@store/shared';

test('custom inventory patterns support free-form keys, labels and separators', () => {
  const definition = parseInventoryPatternTemplate('Email={{email}} | Pass={{password}} / OTP={{Mã 2FA tùy ý}}');
  expect(definition.keys).toEqual(['email', 'password', 'Mã 2FA tùy ý']);
  expect(parseInventoryPatternLine('Email=user@example.com | Pass=secret / OTP=ABC123', definition)).toEqual({
    email: 'user@example.com', password: 'secret', 'Mã 2FA tùy ý': 'ABC123',
  });
  expect(inventoryPatternExample(definition)).toBe('Email=email@gmail.com | Pass=matkhau / OTP=Mã 2FA tùy ý');
});

test('legacy patterns remain compatible and may use different separators', () => {
  const definition = parseInventoryPatternTemplate('email ---- password | 2fa');
  expect(parseInventoryPatternLine('user@example.com ---- secret | ABC123', definition)).toEqual({
    email: 'user@example.com', password: 'secret', '2fa': 'ABC123',
  });
});
