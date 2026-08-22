import { expect, test } from 'bun:test';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateBotTokenDto } from '../apps/api/src/bot-config/bot-config.dto';

test('normalizes a Telegram token copied from an environment file', async () => {
  const token = '123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const input = plainToInstance(UpdateBotTokenDto, { token: ` BOT_TOKEN="${token}" ` });

  expect(await validate(input)).toHaveLength(0);
  expect(input.token).toBe(token);
});
