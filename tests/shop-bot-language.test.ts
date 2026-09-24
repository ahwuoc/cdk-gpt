import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { Types } from 'mongoose';
import { createShopBot, type ShopBotDataContext } from '../apps/bot/src/shop.bot';

afterEach(() => mock.restore());

test('bot asks for language on start and renders the English main menu after selection', async () => {
  const userId = new Types.ObjectId();
  const updates: Array<Record<string, unknown>> = [];
  const replies: Array<{ text: string; extra?: unknown }> = [];
  const data = {
    botSessions: {
      findOneAndDelete: () => ({ lean: async () => null }),
      findOne: () => ({ lean: async () => null }),
    },
    users: {
      findOneAndUpdate: async () => ({ _id: userId, walletBalance: 0, language: 'vi' }),
      updateOne: async (_filter: unknown, update: Record<string, unknown>) => { updates.push(update); },
    },
    settings: { findOne: () => ({ select: () => ({ lean: async () => null }) }) },
  } as unknown as ShopBotDataContext;
  spyOn(globalThis, 'fetch').mockImplementation(Object.assign(async () => Response.json({ recorded: true }), {
    preconnect: fetch.preconnect,
  }));
  const bot = createShopBot('123456:TEST_TOKEN', 'https://fixture.invalid', 'secret', 'Fixture', data);
  bot.botInfo = { id: 123456, is_bot: true, first_name: 'Test', username: 'test_bot',
    can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false };
  bot.botInfo = { id: 123456, is_bot: true, first_name: 'Test', username: 'test_bot',
    can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false };
  Object.assign(bot.context, {
    answerCbQuery: async () => true,
    reply: async (text: string, extra?: unknown) => { replies.push({ text, extra }); return { message_id: 1, date: 1, chat: { id: 42, type: 'private' }, text }; },
  });

  await bot.handleUpdate({ update_id: 1, message: {
    message_id: 1, date: 1, chat: { id: 42, type: 'private' },
    from: { id: 42, is_bot: false, first_name: 'Buyer' }, text: '/start',
    entities: [{ type: 'bot_command', offset: 0, length: 6 }],
  } } as never);
  expect(replies[0]?.text).toContain('Mặc định: Tiếng Việt');

  await bot.handleUpdate({ update_id: 2, callback_query: {
    id: 'language-1', chat_instance: 'fixture', data: 'language:en',
    from: { id: 42, is_bot: false, first_name: 'Buyer' },
    message: { message_id: 1, date: 1, chat: { id: 42, type: 'private' }, text: 'Menu' },
  } } as never);
  expect(updates).toContainEqual({ $set: { language: 'en' } });
  expect(replies.at(-1)?.text).toContain('Welcome to Fixture');
  expect(JSON.stringify(replies.at(-1)?.extra)).toContain('Products');
});
