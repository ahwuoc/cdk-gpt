import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { UnauthorizedException } from '@nestjs/common';
import { MessagingController } from '../apps/api/src/messaging/messaging.controller';
import type { MessagingService } from '../apps/api/src/messaging/messaging.service';

const originalSecret = process.env.BOT_API_SECRET;
const payload = {
  userId: '64b64c0f1de2360012345678', body: 'Tôi cần shop hỗ trợ.',
  idempotencyKey: 'telegram-support-100-200',
};

beforeEach(() => { process.env.BOT_API_SECRET = 'bot-message-secret'; });
afterEach(() => {
  if (originalSecret === undefined) delete process.env.BOT_API_SECRET;
  else process.env.BOT_API_SECRET = originalSecret;
});

test('support message endpoint rejects an invalid bot credential before storing chat', () => {
  const receiveUser = mock(async () => ({ id: 'message-id', status: 'RECEIVED' }));
  const controller = new MessagingController({ receiveUser } as unknown as MessagingService);
  expect(() => controller.receive(payload)).toThrow(UnauthorizedException);
  expect(() => controller.receive(payload, 'wrong-secret')).toThrow(UnauthorizedException);
  expect(receiveUser).toHaveBeenCalledTimes(0);
});

test('support message endpoint forwards a verified Telegram reply once', async () => {
  const result = { id: 'message-id', status: 'RECEIVED' as const };
  const receiveUser = mock(async () => result);
  const controller = new MessagingController({ receiveUser } as unknown as MessagingService);
  await expect(controller.receive(payload, 'bot-message-secret')).resolves.toEqual(result);
  expect(receiveUser).toHaveBeenCalledTimes(1);
  expect(receiveUser).toHaveBeenCalledWith(payload);
});
