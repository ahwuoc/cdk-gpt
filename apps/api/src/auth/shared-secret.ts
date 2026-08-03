import { UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';

export function assertSharedSecret(actual: string | undefined, environmentName: string, message: string) {
  const expected = process.env[environmentName] ?? '';
  const left = Buffer.from(actual ?? ''); const right = Buffer.from(expected);
  if (!expected || left.length !== right.length || !timingSafeEqual(left, right)) throw new UnauthorizedException(message);
}
