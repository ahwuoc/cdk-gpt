import { UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';

export function assertSharedSecret(actual: string | undefined, environmentName: string, message: string) {
  const expected = process.env[environmentName] ?? '';
  if (!sharedSecretMatches(actual, expected)) throw new UnauthorizedException(message);
}

/** Reusable constant-time comparison for non-Nest webhook Route Handlers. */
export function sharedSecretMatches(actual: string | undefined, expected: string | undefined) {
  const left = Buffer.from(actual ?? ''); const right = Buffer.from(expected ?? '');
  return Boolean(expected) && left.length === right.length && timingSafeEqual(left, right);
}
