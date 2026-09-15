import { expect, test } from 'bun:test';
import { Types } from 'mongoose';
import { createShopBot, type ShopBotDataContext } from '../apps/bot/src/shop.bot';

test('opening complaints shows choices without automatically listing recent orders', async () => {
  let orderQueries = 0;
  const data = {
    users: { findOneAndUpdate: async () => ({ _id: new Types.ObjectId() }) },
    orders: { find: () => {
      orderQueries += 1;
      const query = { sort: () => query, limit: () => query, lean: async () => [] };
      return query;
    } },
  } as unknown as ShopBotDataContext;
  const bot = createShopBot('123456:TEST_TOKEN', 'https://example.test', 'secret', 'Shop', data);
  bot.botInfo = {
    id: 123456, is_bot: true, first_name: 'Test', username: 'test_bot',
    can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false,
  };
  const replies: Array<{ text: string; extra: Record<string, unknown> }> = [];
  Object.assign(bot.context, {
    answerCbQuery: async () => true,
    reply: async (text: string, extra: Record<string, unknown>) => {
      replies.push({ text, extra });
      return { message_id: 2, date: 1, chat: { id: 42, type: 'private' }, text };
    },
  });

  await bot.handleUpdate({
    update_id: 1,
    callback_query: {
      id: 'callback-1', chat_instance: 'instance', data: 'menu:reports',
      from: { id: 42, is_bot: false, first_name: 'Buyer' },
      message: { message_id: 1, date: 1, chat: { id: 42, type: 'private' }, text: 'Menu' },
    },
  } as never);

  expect(orderQueries).toBe(0);
  expect(replies[0]?.text).toContain('Chọn cách tìm đơn hàng');
  const keyboard = JSON.stringify(replies[0]?.extra.reply_markup);
  expect(keyboard).toContain('report:recent');
  expect(keyboard).toContain('report:lookup');
});
