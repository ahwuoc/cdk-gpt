import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { Types } from 'mongoose';
import { BotSessionKind } from '@store/database';
import { createShopBot, type ShopBotDataContext } from '../apps/bot/src/shop.bot';

afterEach(() => mock.restore());

test('quantity selection quotes without charging and offers coupon entry', async () => {
  const f = setup();
  await f.callback('qty:' + f.productId + ':2');
  expect(f.requests('/purchases/quote')).toHaveLength(1);
  expect(f.requests('/purchases/batch')).toHaveLength(0);
  expect(f.replies.at(-1)?.text).toContain('20.000');
  expect(f.replies.at(-1)?.extra).toContain('Nhập mã giảm giá');
  expect(f.requests('/bot/analytics/events')[0]?.body).toMatchObject({
    telegramId: '42', type: 'CHECKOUT_START', productId: f.productId,
  });
});

test('voucher menu shows currently available codes and product scope', async () => {
  const f = setup();
  await f.callback('menu:coupons');
  const reply = f.replies.at(-1);
  expect(reply?.text).toContain('SAVE20');
  expect(reply?.text).toContain('MÃ VOUCHER');
  expect(reply?.text).toContain('`SAVE20`');
  expect(reply?.text).not.toContain('\\_');
  expect(reply?.text).toContain('Demo');
  expect(reply?.text).toContain('Giảm 20%');
  expect(reply?.extra).toContain('menu:products');
});

test('coupon preview updates total and repeated confirmations reuse one wallet purchase', async () => {
  const f = setup();
  await f.callback('qty:' + f.productId + ':2');
  await f.callback('cart:coupon:' + f.nonce());
  await f.text(' save20 ');
  const cart = f.session()!.data;
  expect(cart).toMatchObject({ couponCode: 'SAVE20', subtotal: 20_000, discountAmount: 4_000, totalAmount: 16_000 });
  await f.callback('cart:pay:' + cart.nonce);
  f.setBalance(0);
  await f.callback('cart:pay:' + cart.nonce);
  const purchases = f.requests('/purchases/batch');
  expect(purchases).toHaveLength(2);
  expect(purchases[0]?.body).toMatchObject({ couponCode: 'SAVE20', expectedTotalAmount: 16_000, quantity: 2 });
  expect(purchases[1]?.body.idempotencyPrefix).toBe(purchases[0]?.body.idempotencyPrefix);
  expect(f.requests('/bot/checkouts')).toHaveLength(0);
});

test('discounted QR uses the confirmed total and stable cart idempotency key', async () => {
  const f = setup(0);
  await f.callback('qty:' + f.productId + ':2');
  await f.callback('cart:coupon:' + f.nonce());
  await f.text('SAVE20');
  const nonce = f.nonce();
  await f.callback('cart:pay:' + nonce);
  f.setBalance(99_999);
  await f.callback('cart:pay:' + nonce);
  const requests = f.requests('/bot/checkouts');
  expect(requests).toHaveLength(2);
  expect(requests[0]?.body).toMatchObject({ couponCode: 'SAVE20', expectedTotalAmount: 16_000 });
  expect(requests[1]?.body.idempotencyKey).toBe(requests[0]?.body.idempotencyKey);
  expect(f.requests('/purchases/batch')).toHaveLength(0);
  expect(f.replies.some((reply) => reply.text.includes('CẦN CHUYỂN: 16.000'))).toBe(true);
});

test('reconfirming an already paid QR never asks the customer to transfer again', async () => {
  const f = setup(0);
  await f.callback('qty:' + f.productId + ':1');
  const nonce = f.nonce();
  await f.callback('cart:pay:' + nonce);
  f.setCheckoutState('APPROVED', 'FULFILLED');
  const previousReplies = f.replies.length;
  await f.callback('cart:pay:' + nonce);
  const followUp = f.replies.slice(previousReplies);
  expect(followUp.length).toBeGreaterThan(0);
  expect(followUp.map((reply) => reply.text).join('\n')).not.toContain('CẦN CHUYỂN');
  expect(followUp.map((reply) => reply.extra).join('\n')).toMatch(/checkout:check:|menu:orders/);
});

test('reconfirming a cancelled QR does not reopen its transfer instructions', async () => {
  const f = setup(0);
  await f.callback('qty:' + f.productId + ':1');
  const nonce = f.nonce();
  await f.callback('cart:pay:' + nonce);
  // The POST /bot/checkouts replay response represents cancellation with
  // EXPIRED + FAILED; it does not expose the cancelled flag from /check.
  f.setCheckoutState('EXPIRED', 'FAILED');
  const previousReplies = f.replies.length;
  await f.callback('cart:pay:' + nonce);
  const followUp = f.replies.slice(previousReplies);
  expect(followUp.length).toBeGreaterThan(0);
  expect(followUp.map((reply) => reply.text).join('\n')).not.toContain('CẦN CHUYỂN');
  expect(followUp.map((reply) => reply.extra).join('\n')).toMatch(/menu:products|menu:home/);
});

test('coupon removal requotes and superseded or foreign cart buttons cannot charge', async () => {
  const f = setup();
  await f.callback('qty:' + f.productId + ':2');
  const original = f.nonce();
  await f.callback('cart:coupon:' + original);
  await f.text('SAVE20');
  await f.callback('cart:clear:' + f.nonce());
  expect(f.session()!.data).toMatchObject({ totalAmount: 20_000, discountAmount: 0 });
  expect(f.session()!.data.couponCode).toBeUndefined();
  await f.callback('cart:pay:' + original);
  await f.callback('cart:pay:' + f.nonce(), 43);
  expect(f.requests('/purchases/batch')).toHaveLength(0);
});

test('invalid coupon does not silently buy full price and can be corrected', async () => {
  const f = setup();
  await f.callback('qty:' + f.productId + ':1');
  await f.callback('cart:coupon:' + f.nonce());
  await f.text('EXPIRED');
  expect(f.replies.at(-1)?.text).toContain('Mã đã hết hạn');
  expect(f.requests('/purchases/batch')).toHaveLength(0);
  expect(f.session()?.kind).toBe(BotSessionKind.COUPON_CODE);
  await f.text('SAVE20');
  expect(f.session()!.data.couponCode).toBe('SAVE20');
});

test('submitted carts cannot be modified and unrelated text preserves confirmation state', async () => {
  const f = setup();
  await f.callback('qty:' + f.productId + ':1');
  const nonce = f.nonce();
  await f.text('hello');
  expect(f.nonce()).toBe(nonce);
  await f.callback('cart:pay:' + nonce);
  await f.callback('cart:coupon:' + nonce);
  expect(f.session()!.data.submitted).toBe(true);
  expect(f.session()!.kind).toBe(BotSessionKind.CHECKOUT_CONFIRMATION);
  expect(f.replies.at(-1)?.text).toContain('không thể đổi mã');
});

test('ambiguous purchase failure retries the same cart without switching payment route', async () => {
  const f = setup();
  await f.callback('qty:' + f.productId + ':1');
  f.failNextPurchase();
  const nonce = f.nonce();
  await f.callback('cart:pay:' + nonce);
  expect(f.replies.at(-1)?.text).toContain('cùng đơn');
  f.setBalance(0);
  await f.callback('cart:pay:' + nonce);
  const purchases = f.requests('/purchases/batch');
  expect(purchases).toHaveLength(2);
  expect(purchases[0]!.body.idempotencyPrefix).toBe(purchases[1]!.body.idempotencyPrefix);
  expect(f.requests('/bot/checkouts')).toHaveLength(0);
});

test('overlapping confirmations keep the same purchase key and payment route', async () => {
  const f = setup();
  await f.callback('qty:' + f.productId + ':2');
  const nonce = f.nonce();
  const held = f.holdNextRequest('/purchases/batch');
  const firstConfirmation = f.callback('cart:pay:' + nonce);
  try {
    await withinDeadline(held.entered);
    // First purchase remains in flight while its debit becomes visible to a
    // second callback. A repeated confirmation must not switch to a QR charge.
    f.setBalance(0);
    await withinDeadline(f.callback('cart:pay:' + nonce));
    const purchases = f.requests('/purchases/batch');
    expect(purchases).toHaveLength(2);
    expect(purchases.map((request) => request.body.idempotencyPrefix)).toEqual([
      `cart:42:${nonce}`, `cart:42:${nonce}`,
    ]);
    expect(purchases.map((request) => request.body.expectedTotalAmount)).toEqual([20_000, 20_000]);
    expect(f.requests('/bot/checkouts')).toHaveLength(0);
  } finally {
    held.release();
    await firstConfirmation;
  }
});

test('a delayed coupon quote cannot replace a cart already confirmed for purchase', async () => {
  const f = setup();
  await f.callback('qty:' + f.productId + ':2');
  const nonce = f.nonce();
  await f.callback('cart:coupon:' + nonce);
  const held = f.holdNextRequest('/purchases/quote');
  const applyingCoupon = f.text('SAVE20');
  try {
    await withinDeadline(held.entered);
    await f.callback('cart:pay:' + nonce);
  } finally {
    held.release();
    await applyingCoupon;
  }
  expect(f.replies.at(-1)?.text).toContain('Báo giá đã thay đổi hoặc đơn đang xử lý');
  const previousReplies = f.replies.length;
  await f.callback('cart:pay:' + nonce);
  const purchases = f.requests('/purchases/batch');
  expect(purchases).toHaveLength(2);
  expect(purchases.map((request) => request.body.idempotencyPrefix)).toEqual([
    `cart:42:${nonce}`, `cart:42:${nonce}`,
  ]);
  expect(purchases.map((request) => request.body.expectedTotalAmount)).toEqual([20_000, 20_000]);
  expect(purchases.every((request) => request.body.couponCode === undefined)).toBe(true);
  expect(f.replies.slice(previousReplies).some((reply) => reply.text.includes('Đã đặt 2 sản phẩm'))).toBe(true);
});

test('expired cart buttons are rejected before quoting or charging a customer', async () => {
  const f = setup();
  await f.callback('qty:' + f.productId + ':1');
  const nonce = f.nonce();
  f.expireSession();
  for (const action of ['pay', 'coupon', 'clear', 'refresh']) {
    await f.callback(`cart:${action}:${nonce}`);
    expect(f.replies.at(-1)?.text).toContain('Báo giá này đã hết hạn hoặc được thay thế');
  }
  expect(f.requests('/purchases/quote')).toHaveLength(1);
  expect(f.requests('/purchases/batch')).toHaveLength(0);
  expect(f.requests('/bot/checkouts')).toHaveLength(0);
});

test('custom quantity records checkout activity without collecting the typed message', async () => {
  const f = setup();
  await f.callback('qty:custom:' + f.productId + ':uncategorized');
  await f.text('3');
  const events = f.requests('/bot/analytics/events');
  expect(events).toHaveLength(1);
  expect(Object.keys(events[0]!.body).sort()).toEqual(['productId', 'telegramId', 'type', 'updateId']);
});

type Session = { _id: Types.ObjectId; chatId: string; telegramUserId: string; kind: string; data: Record<string, unknown>; expiresAt: Date };
function setup(balance = 100_000) {
  const productId = new Types.ObjectId().toString();
  const userId = new Types.ObjectId();
  const checkoutId = new Types.ObjectId().toString();
  let checkoutStatus: 'PENDING' | 'APPROVED' | 'EXPIRED' = 'PENDING';
  let checkoutFulfillmentStatus: 'PENDING_PAYMENT' | 'PROCESSING' | 'FULFILLED' | 'FAILED' = 'PENDING_PAYMENT';
  let current: Session | undefined;
  let updateId = 100;
  let failPurchase = false;
  let heldRequest: { suffix: string; entered: ReturnType<typeof deferred>; completion: ReturnType<typeof deferred> } | undefined;
  const replies: { text: string; extra: string }[] = [];
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  const matches = (filter: Record<string, unknown>) => current && Object.entries(filter).every(([key, value]) => {
    const actual = key.startsWith('data.') ? current!.data[key.slice(5)] : current![key as keyof Session];
    if (typeof value === 'object' && value !== null && !(value instanceof Types.ObjectId)) {
      const operator = value as { $in?: unknown[]; $nin?: unknown[]; $gt?: Date };
      if (operator.$in) return operator.$in.includes(actual);
      if (operator.$nin) return !operator.$nin.includes(actual);
      if (operator.$gt) return (actual as Date).getTime() > operator.$gt.getTime();
    }
    return String(actual) === String(value);
  });
  const copy = () => current ? { ...current, data: { ...current.data } } : null;
  const data = {
    users: { findOneAndUpdate: async () => ({ _id: userId, walletBalance: balance }) },
    products: { findOne: () => ({ select: () => ({ lean: async () => ({ _id: new Types.ObjectId(productId), name: 'Demo', price: 10_000 }) }) }) },
    botSessions: {
      findOne: (filter: Record<string, unknown>) => ({ lean: async () => matches(filter) ? copy() : null }),
      findOneAndDelete: (filter: Record<string, unknown>) => ({ lean: async () => {
        if (!matches(filter)) return null;
        const value = copy(); current = undefined; return value;
      } }),
      findOneAndUpdate: async (filter: Record<string, unknown>, update: { $set: Record<string, unknown> }, options?: { upsert?: boolean }) => {
        if (!matches(filter)) {
          if (!options?.upsert) return null;
          current = { _id: new Types.ObjectId(), chatId: String(filter.chatId), telegramUserId: String(filter.telegramUserId),
            kind: '', data: {}, expiresAt: new Date() };
        }
        for (const [key, value] of Object.entries(update.$set)) {
          if (key.startsWith('data.')) current!.data[key.slice(5)] = value;
          else Object.assign(current!, { [key]: value });
        }
        return copy();
      },
    },
  } as unknown as ShopBotDataContext;
  spyOn(globalThis, 'fetch').mockImplementation(Object.assign(async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    calls.push({ path, body });
    if (heldRequest && path.endsWith(heldRequest.suffix)) {
      const held = heldRequest;
      heldRequest = undefined;
      held.entered.resolve();
      await held.completion.promise;
    }
    if (path.endsWith('/purchases/quote')) {
      if (body.couponCode === 'EXPIRED') return Response.json({ message: 'Mã đã hết hạn' }, { status: 400 });
      const subtotal = 10_000 * Number(body.quantity);
      const discountAmount = body.couponCode ? Math.floor(subtotal / 5) : 0;
      return Response.json({ productId, productName: 'Demo', quantity: body.quantity, unitPrice: 10_000,
        subtotal, discountAmount, totalAmount: subtotal - discountAmount, couponCode: body.couponCode, available: 10 });
    }
    if (path.endsWith('/bot/coupons')) return Response.json({ items: [{ code: 'SAVE20', type: 'PERCENT', value: 20,
      minSubtotal: 0, maxDiscount: null, endsAt: null, remainingUses: null, remainingUserUses: 2,
      productIds: [productId],
      products: [{ id: productId, name: 'Demo' }] }], page: 1, limit: 5, total: 1, totalPages: 1 });
    if (path.endsWith('/purchases/batch')) {
      if (failPurchase) { failPurchase = false; throw new Error('connection lost'); }
      return Response.json([{ orderCode: 'ORD-FIXTURE' }]);
    }
    if (path.endsWith('/bot/checkouts')) return Response.json({ id: checkoutId,
      status: checkoutStatus, checkoutStatus: checkoutFulfillmentStatus, expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      amount: body.expectedTotalAmount, transferContent: 'TEST', qrUrl: 'https://fixture.invalid/qr',
      bank: { accountNo: 'fixture-only' }, couponCode: body.couponCode, discountAmount: 4_000 });
    if (path.includes('/prompt') || path.endsWith('/bot/analytics/events')) return Response.json({ recorded: true });
    throw new Error('Unexpected request ' + path);
  }, { preconnect: fetch.preconnect }));
  const bot = createShopBot('123456:TEST_TOKEN', 'https://fixture.invalid', 'fixture-secret', 'Fixture', data);
  bot.botInfo = { id: 123456, is_bot: true, first_name: 'Test', username: 'test_bot',
    can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false };
  const reply = async (text: string, extra: unknown) => {
    replies.push({ text, extra: JSON.stringify(extra) });
    return { message_id: 10, date: 1, chat: { id: 42, type: 'private' }, text };
  };
  Object.assign(bot.context, { answerCbQuery: async () => true, reply,
    replyWithPhoto: async (_url: string, extra: { caption: string }) => reply(extra.caption, extra) });
  return {
    productId, replies, session: () => current, nonce: () => String(current!.data.nonce),
    setCheckoutState: (status: typeof checkoutStatus, fulfillment: typeof checkoutFulfillmentStatus) => {
      checkoutStatus = status; checkoutFulfillmentStatus = fulfillment;
    },
    setBalance: (value: number) => { balance = value; }, failNextPurchase: () => { failPurchase = true; },
    expireSession: () => { if (current) current.expiresAt = new Date(Date.now() - 1_000); },
    holdNextRequest: (suffix: string) => {
      if (heldRequest) throw new Error('Only one fixture request may be held at a time');
      const held = { suffix, entered: deferred(), completion: deferred() };
      heldRequest = held;
      return { entered: held.entered.promise, release: () => held.completion.resolve() };
    },
    requests: (suffix: string) => calls.filter((call) => call.path.endsWith(suffix)),
    callback: (callback: string, fromId = 42) => bot.handleUpdate({ update_id: updateId++, callback_query: {
      id: String(updateId), chat_instance: 'fixture', data: callback,
      from: { id: fromId, is_bot: false, first_name: 'Buyer' },
      message: { message_id: 1, date: 1, chat: { id: 42, type: 'private' }, text: 'Menu' },
    } } as never),
    text: (text: string) => bot.handleUpdate({ update_id: updateId++, message: { message_id: updateId, date: 1,
      chat: { id: 42, type: 'private' }, from: { id: 42, is_bot: false, first_name: 'Buyer' }, text } } as never),
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function withinDeadline<T>(promise: Promise<T>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Expected concurrent request did not arrive within 1 second')), 1_000);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}
