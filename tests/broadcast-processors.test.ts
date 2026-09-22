import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { Types } from 'mongoose';
import { CustomerMessageModel, CustomerMessageStatus, InventoryItemModel, NotificationModel, NotificationStatus, ProductModel, UserModel,
  customerMessageId } from '@store/database';
import { AdminBroadcastProcessor } from '../apps/bot/src/admin-broadcast.processor';
import { BroadcastRetryError, type BroadcastSender } from '../apps/bot/src/broadcast-sender';
import type { TelegramBotClient } from '../apps/bot/src/delivery.processor';
import { PurchaseAlertProcessor } from '../apps/bot/src/purchase-alert.processor';
import { StockAlertProcessor } from '../apps/bot/src/stock-alert.processor';

const immediateSender: BroadcastSender = { send: async (_chatId, deliver) => deliver() };

afterEach(() => mock.restore());

if (process.env.BROADCAST_BENCHMARK === '1') test('broadcast benchmark: 20 recipients at 50 ms Telegram latency', async () => {
  const fixture = mockCampaign(20);
  const sendMessage = mock(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
    return { message_id: 123 };
  });
  const started = performance.now();
  const result = await new AdminBroadcastProcessor({ telegram: { sendMessage } }, pacedBenchmarkSender())
    .processBatch({ campaignId: fixture.campaignId.toString(), limit: 20 });
  console.log(`20 recipients, 50 ms send latency: ${(performance.now() - started).toFixed(0)} ms`);
  expect(result.sent).toBe(20);
});

describe('admin broadcast delivery', () => {
  test('a slow Telegram request does not block the next recipient', async () => {
    const fixture = mockCampaign(2);
    const firstCanFinish = gate();
    const secondStarted = gate();
    const sendMessage = mock(async (chatId: string | number) => {
      if (chatId === fixture.users[0]!.telegramId) await firstCanFinish.promise;
      else secondStarted.open();
      return { message_id: Number(chatId) };
    });
    const processor = new AdminBroadcastProcessor({ telegram: { sendMessage } }, immediateSender);
    const processing = processor.processBatch({ campaignId: fixture.campaignId.toString(), limit: 2 });
    try {
      expect(await startsWithin(secondStarted.promise, 500)).toBe(true);
      expect(sendMessage).toHaveBeenCalledTimes(2);
    } finally {
      firstCanFinish.open();
      await processing;
    }
  });

  test('publishes the pagination cursor only after the entire page finishes', async () => {
    const fixture = mockCampaign(3);
    const lastCanFinish = gate();
    const lastStarted = gate();
    const sendMessage = mock(async (chatId: string | number) => {
      if (chatId === fixture.users[1]!.telegramId) {
        lastStarted.open();
        await lastCanFinish.promise;
      }
      return { message_id: Number(chatId) };
    });
    let completed = false;
    const processing = new AdminBroadcastProcessor({ telegram: { sendMessage } }, immediateSender)
      .processBatch({ campaignId: fixture.campaignId.toString(), limit: 2 })
      .then((result) => { completed = true; return result; });
    try {
      expect(await startsWithin(lastStarted.promise, 500)).toBe(true);
      expect(completed).toBe(false);
      expect(fixture.aggregate).not.toHaveBeenCalled();
      expect(fixture.updateCampaign).not.toHaveBeenCalled();
      expect(sendMessage.mock.calls.map(([chatId]) => chatId)).not.toContain(fixture.users[2]!.telegramId);
    } finally {
      lastCanFinish.open();
      await processing;
    }
    expect(await processing).toMatchObject({ status: 'page-complete', sent: 2, failed: 0, skipped: 0,
      nextCursor: fixture.users[1]!._id.toString() });
    expect(fixture.updateCampaign.mock.calls[0]![1]).toEqual({ $set: {
      'metadata.sent': 2, 'metadata.failed': 0, 'metadata.recipientsProcessed': 2,
    } });
  });

  test('skips an already sent delivery without sending it again', async () => {
    const fixture = mockCampaign(2);
    fixture.setSent(0);
    const sendMessage = mock(async (chatId: string | number) => ({ message_id: Number(chatId) }));
    const result = await new AdminBroadcastProcessor({ telegram: { sendMessage } }, immediateSender)
      .processBatch({ campaignId: fixture.campaignId.toString(), limit: 2 });

    expect(result).toMatchObject({ status: 'complete', sent: 1, failed: 0, skipped: 1 });
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0]![0]).toBe(fixture.users[1]!.telegramId);
    expect(fixture.updateCampaign.mock.calls[0]![1].$set).toMatchObject({
      status: NotificationStatus.SENT, 'metadata.sent': 2, 'metadata.failed': 0,
    });
  });

  test('a failed recipient stays terminal when the campaign page is retried', async () => {
    const fixture = mockCampaign(2);
    fixture.setStatus(0, CustomerMessageStatus.FAILED);
    const sendMessage = mock(async (chatId: string | number) => ({ message_id: Number(chatId) }));

    const result = await new AdminBroadcastProcessor({ telegram: { sendMessage } }, immediateSender)
      .processBatch({ campaignId: fixture.campaignId.toString(), limit: 2 });

    expect(result).toMatchObject({ status: 'complete', sent: 1, failed: 1, skipped: 0 });
    expect(sendMessage.mock.calls.map(([chatId]) => chatId)).toEqual([fixture.users[1]!.telegramId]);
    expect(fixture.deliveryFor(0)).toMatchObject({ status: CustomerMessageStatus.FAILED });
    expect(fixture.updateCampaign.mock.calls[0]![1].$set).toMatchObject({
      status: NotificationStatus.SENT, 'metadata.sent': 1, 'metadata.failed': 1,
    });
  });

  test('does not claim a recipient another worker failed after the initial pending read', async () => {
    const fixture = mockCampaign(1);
    fixture.failBeforeClaim(0);
    const sendMessage = mock(async () => ({ message_id: 123 }));

    await new AdminBroadcastProcessor({ telegram: { sendMessage } }, immediateSender)
      .processBatch({ campaignId: fixture.campaignId.toString(), limit: 1 }).catch((error) => {
        expect(error).toBeInstanceOf(BroadcastRetryError);
      });

    expect(sendMessage).not.toHaveBeenCalled();
    expect(fixture.deliveryFor(0)).toMatchObject({ status: CustomerMessageStatus.FAILED });
  });

  test('a DB failure after successful sending leaves delivery in-flight and rejects the page', async () => {
    const fixture = mockCampaign(1);
    const databaseFailure = new Error('database disconnected during sent update');
    fixture.failSentWrite(databaseFailure);
    const sendMessage = mock(async () => ({ message_id: 123 }));

    await expect(new AdminBroadcastProcessor({ telegram: { sendMessage } }, immediateSender)
      .processBatch({ campaignId: fixture.campaignId.toString(), limit: 1 })).rejects.toBe(databaseFailure);

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(fixture.deliveryFor(0)).toMatchObject({ status: CustomerMessageStatus.SENDING });
    expect(fixture.deliveryUpdates.map((update) => update.$set?.status)).not.toContain(CustomerMessageStatus.FAILED);
    expect(fixture.updateCampaign).not.toHaveBeenCalled();
  });

  test('a permanent Telegram error records failure and still delivers to other recipients', async () => {
    const fixture = mockCampaign(3);
    const sendMessage: TelegramBotClient['telegram']['sendMessage'] = mock(async (chatId) => {
      if (chatId === fixture.users[0]!.telegramId) throw { response: { error_code: 403 } };
      return { message_id: Number(chatId) };
    });
    const result = await new AdminBroadcastProcessor({ telegram: { sendMessage } }, immediateSender)
      .processBatch({ campaignId: fixture.campaignId.toString(), limit: 3 });

    expect(result).toMatchObject({ status: 'complete', sent: 2, failed: 1, skipped: 0 });
    expect(sendMessage).toHaveBeenCalledTimes(3);
    expect(fixture.deliveryFor(0)).toMatchObject({ status: CustomerMessageStatus.FAILED, errorCode: 'TELEGRAM_403' });
    expect(fixture.deliveryFor(1)).toMatchObject({ status: CustomerMessageStatus.SENT });
    expect(fixture.deliveryFor(2)).toMatchObject({ status: CustomerMessageStatus.SENT });
    expect(fixture.updateCampaign.mock.calls[0]![1].$set).toMatchObject({
      'metadata.sent': 2, 'metadata.failed': 1, 'metadata.recipientsProcessed': 3,
    });
  });

  test('retryable sender failures keep the campaign open and delivery pending', async () => {
    const fixture = mockCampaign(1);
    const sendMessage = mock(async () => ({ message_id: 123 }));
    const sender: BroadcastSender = { send: async () => { throw new BroadcastRetryError('retry later'); } };

    await expect(new AdminBroadcastProcessor({ telegram: { sendMessage } }, sender)
      .processBatch({ campaignId: fixture.campaignId.toString(), limit: 1 })).rejects.toBeInstanceOf(BroadcastRetryError);

    expect(sendMessage).not.toHaveBeenCalled();
    expect(fixture.deliveryFor(0)).toMatchObject({ status: CustomerMessageStatus.PENDING, errorCode: 'BROADCAST_RETRY' });
    expect(fixture.updateCampaign).not.toHaveBeenCalled();
  });

  test('an in-flight claim prevents the campaign from completing or advancing', async () => {
    const fixture = mockCampaign(1);
    const claimedAt = new Date(Date.now() - 60_000);
    fixture.setStatus(0, CustomerMessageStatus.SENDING, claimedAt);
    const sendMessage = mock(async () => ({ message_id: 123 }));

    const failure = await new AdminBroadcastProcessor({ telegram: { sendMessage } }, immediateSender)
      .processBatch({ campaignId: fixture.campaignId.toString(), limit: 1 }).catch((error) => error);

    expect(failure).toBeInstanceOf(BroadcastRetryError);
    expect(failure.retryAfterMs).toBeGreaterThan(238_000);
    expect(failure.retryAfterMs).toBeLessThanOrEqual(240_000);
    expect(sendMessage).not.toHaveBeenCalled();
    expect(fixture.updateCampaign).not.toHaveBeenCalled();
    expect(fixture.deliveryFor(0)).toMatchObject({ status: CustomerMessageStatus.SENDING, updatedAt: claimedAt });
  });
});

for (const kind of ['stock', 'purchase'] as const) describe(`${kind} broadcast delivery`, () => {
  test('overlaps slow deliveries while withholding the cursor until the page finishes', async () => {
    const fixture = mockProductCampaign(kind);
    const firstCanFinish = gate();
    const secondStarted = gate();
    const sendMessage = mock(async (chatId: string | number) => {
      if (chatId === fixture.recipients[0]!.telegramId) await firstCanFinish.promise;
      else secondStarted.open();
      return { message_id: Number(chatId) };
    });
    let completed = false;
    const processing = fixture.run({ telegram: { sendMessage } })
      .then((result) => { completed = true; return result; });
    try {
      expect(await startsWithin(secondStarted.promise, 500)).toBe(true);
      expect(completed).toBe(false);
      expect(sendMessage.mock.calls.map(([chatId]) => chatId)).toEqual(fixture.recipients.slice(0, 2).map((user) => user.telegramId));
      if (kind === 'purchase') expect(fixture.findUsers.mock.calls[0]![0]._id?.$ne).toEqual(fixture.buyerId);
    } finally {
      firstCanFinish.open();
      await processing;
    }
    expect(await processing).toMatchObject({ sent: 2, failed: 0, skipped: 0,
      nextCursor: fixture.recipients[1]!._id.toString() });
    expect(fixture.recordFor(0)).toMatchObject({ status: NotificationStatus.SENT });
    expect(fixture.recordFor(1)).toMatchObject({ status: NotificationStatus.SENT });
    expect(fixture.recordFor(2)).toBeUndefined();
  });

  test('skips previously sent recipients when retrying a page', async () => {
    const fixture = mockProductCampaign(kind);
    fixture.setStatus(0, NotificationStatus.SENT);
    const sendMessage = mock(async (chatId: string | number) => ({ message_id: Number(chatId) }));

    expect(await fixture.run({ telegram: { sendMessage } })).toMatchObject({ sent: 1, failed: 0, skipped: 1 });
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0]![0]).toBe(fixture.recipients[1]!.telegramId);
  });

  test('does not resend failed recipients when retrying a page', async () => {
    const fixture = mockProductCampaign(kind);
    fixture.setStatus(0, NotificationStatus.FAILED);
    const sendMessage = mock(async (chatId: string | number) => ({ message_id: Number(chatId) }));

    expect(await fixture.run({ telegram: { sendMessage } })).toMatchObject({ sent: 1, failed: 1, skipped: 0 });

    expect(sendMessage.mock.calls.map(([chatId]) => chatId)).toEqual([fixture.recipients[1]!.telegramId]);
    expect(fixture.recordFor(0)).toMatchObject({ status: NotificationStatus.FAILED });
  });

  test('does not claim a recipient another worker failed after the initial pending read', async () => {
    const fixture = mockProductCampaign(kind);
    fixture.failBeforeClaim(0);
    const sendMessage = mock(async (chatId: string | number) => ({ message_id: Number(chatId) }));

    await fixture.run({ telegram: { sendMessage } }).catch((error) => {
      expect(error).toBeInstanceOf(BroadcastRetryError);
    });

    expect(sendMessage.mock.calls.map(([chatId]) => chatId)).not.toContain(fixture.recipients[0]!.telegramId);
    expect(fixture.recordFor(0)).toMatchObject({ status: NotificationStatus.FAILED });
  });

  test('DB persistence failure after sending leaves delivery in-flight and rejects the page', async () => {
    const fixture = mockProductCampaign(kind);
    const databaseFailure = new Error('database disconnected during sent update');
    fixture.failSentWrite(databaseFailure);
    const sendMessage = mock(async () => ({ message_id: 123 }));

    await expect(fixture.run({ telegram: { sendMessage } })).rejects.toBe(databaseFailure);

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(fixture.recordFor(0)).toMatchObject({ status: 'SENDING' });
    expect(fixture.recordFor(1)).toMatchObject({ status: 'SENDING' });
    expect(fixture.deliveryUpdates.map((update) => update.$set?.status)).not.toContain(NotificationStatus.FAILED);
  });

  test('retryable sender failures reset the delivery instead of advancing the page', async () => {
    const fixture = mockProductCampaign(kind);
    const sendMessage = mock(async () => ({ message_id: 123 }));
    const sender: BroadcastSender = { send: async () => { throw new BroadcastRetryError('retry later'); } };

    await expect(fixture.run({ telegram: { sendMessage } }, sender)).rejects.toBeInstanceOf(BroadcastRetryError);

    expect(sendMessage).not.toHaveBeenCalled();
    expect(fixture.recordFor(0)).toMatchObject({ status: NotificationStatus.PENDING, errorCode: 'BROADCAST_RETRY' });
  });

  test('a delivery claimed by another worker does not advance the page', async () => {
    const fixture = mockProductCampaign(kind);
    const claimedAt = new Date(Date.now() - 60_000);
    fixture.setStatus(0, 'SENDING', claimedAt);
    const sendMessage = mock(async (chatId: string | number) => ({ message_id: Number(chatId) }));

    const failure = await fixture.run({ telegram: { sendMessage } }).catch((error) => error);

    expect(failure).toBeInstanceOf(BroadcastRetryError);
    expect(failure.retryAfterMs).toBeGreaterThan(238_000);
    expect(failure.retryAfterMs).toBeLessThanOrEqual(240_000);
    expect(sendMessage.mock.calls.map(([chatId]) => chatId)).not.toContain(fixture.recipients[0]!.telegramId);
    expect(fixture.recordFor(0)).toMatchObject({ status: 'SENDING', updatedAt: claimedAt });
  });
});

type DeliveryRecord = {
  _id: Types.ObjectId; userId?: Types.ObjectId; status: string; telegramMessageId?: number; errorCode?: string;
  createdAt?: Date; updatedAt?: Date;
};
type DeliveryUpdate = {
  $setOnInsert?: Omit<DeliveryRecord, '_id'> & { _id?: Types.ObjectId };
  $set?: Partial<DeliveryRecord>; $unset?: Record<string, number>;
};

function mockCampaign(recipientCount: number) {
  const campaignId = new Types.ObjectId();
  const users = Array.from({ length: recipientCount }, (_, index) => ({
    _id: new Types.ObjectId((index + 1).toString(16).padStart(24, '0')), telegramId: String(index + 1),
  }));
  const records = new Map<string, DeliveryRecord>();
  const failedBeforeClaim = new Set<string>();
  const deliveryUpdates: DeliveryUpdate[] = [];
  let sentWriteFailure: Error | undefined;
  spyOn(NotificationModel, 'findOne').mockReturnValue({ lean: async () => ({
    _id: campaignId, status: NotificationStatus.PENDING, body: 'Shop update',
  }) } as never);
  spyOn(UserModel, 'find').mockReturnValue({ select: () => ({ sort: () => ({ limit: (limit: number) => ({
    lean: async () => limit ? users.slice(0, limit) : users,
  }) }) }) } as never);
  spyOn(CustomerMessageModel, 'findOneAndUpdate').mockImplementation((async (
    filter: { _id: Types.ObjectId; status?: { $ne?: string } }, update: DeliveryUpdate, options?: { timestamps?: boolean },
  ) => {
    const key = filter._id.toString();
    const current = records.get(key);
    if (update.$setOnInsert) {
      if (current) {
        // Mongoose timestamp updates on an upsert would refresh an existing delivery lease.
        if (options?.timestamps !== false) current.updatedAt = new Date();
        return current;
      }
      records.set(key, { _id: filter._id, ...update.$setOnInsert });
      return records.get(key)!;
    }
    if (current && failedBeforeClaim.has(key)) current.status = CustomerMessageStatus.FAILED;
    if (current && filter.status?.$ne === current.status) return null;
    if (!current || (current.status !== CustomerMessageStatus.PENDING && current.status !== CustomerMessageStatus.FAILED)) return null;
    Object.assign(current, update.$set);
    return current;
  }) as never);
  spyOn(CustomerMessageModel, 'updateOne').mockImplementation((async (
    filter: { _id: Types.ObjectId }, update: DeliveryUpdate,
  ) => {
    deliveryUpdates.push(update);
    if (sentWriteFailure && update.$set?.status === CustomerMessageStatus.SENT) throw sentWriteFailure;
    const record = records.get(filter._id.toString())!;
    Object.assign(record, update.$set);
    if (update.$unset?.errorCode) delete record.errorCode;
    return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
  }) as never);
  const aggregate = spyOn(CustomerMessageModel, 'aggregate').mockImplementation((async () => {
    const counts = new Map<string, number>();
    for (const record of records.values()) counts.set(record.status, (counts.get(record.status) ?? 0) + 1);
    return Array.from(counts, ([_id, count]) => ({ _id, count }));
  }) as never);
  const updateCampaign = mock(async (_filter: { _id: Types.ObjectId }, _update: { $set: Record<string, unknown> }) => ({
    acknowledged: true, matchedCount: 1, modifiedCount: 1, upsertedCount: 0, upsertedId: null,
  }));
  spyOn(NotificationModel, 'updateOne').mockImplementation(updateCampaign as never);
  const deliveryId = (index: number) => customerMessageId(`admin-broadcast:${campaignId}:${users[index]!._id}`);
  return { campaignId, users, aggregate, updateCampaign, deliveryUpdates,
    failBeforeClaim(index: number) { failedBeforeClaim.add(deliveryId(index).toString()); },
    failSentWrite(error: Error) { sentWriteFailure = error; },
    setSent(index: number) { const _id = deliveryId(index); records.set(_id.toString(), { _id, status: CustomerMessageStatus.SENT }); },
    setStatus(index: number, status: string, updatedAt = new Date()) {
      const _id = deliveryId(index); records.set(_id.toString(), { _id, status, updatedAt });
    },
    deliveryFor(index: number) { return records.get(deliveryId(index).toString()); },
  };
}

function mockProductCampaign(kind: 'stock' | 'purchase') {
  const productId = new Types.ObjectId();
  const eventId = new Types.ObjectId();
  const users = Array.from({ length: 4 }, (_, index) => ({
    _id: new Types.ObjectId((index + 1).toString(16).padStart(24, '0')), telegramId: String(index + 1),
  }));
  const buyerId = users[0]!._id;
  const recipients = kind === 'purchase' ? users.slice(1) : users;
  const records = new Map<string, DeliveryRecord>();
  const failedBeforeClaim = new Set<string>();
  const deliveryUpdates: DeliveryUpdate[] = [];
  let sentWriteFailure: Error | undefined;
  const findUsers = mock((filter: { _id?: { $ne?: Types.ObjectId; $gt?: Types.ObjectId } }) => ({
    select: () => ({ sort: () => ({ limit: (limit: number) => ({ lean: async () => {
      const selected = users.filter((user) => !user._id.equals(filter._id?.$ne)
        && (!filter._id?.$gt || user._id.toString() > filter._id.$gt.toString()));
      return limit ? selected.slice(0, limit) : selected;
    } }) }) }),
  }));
  spyOn(UserModel, 'find').mockImplementation(findUsers as never);
  spyOn(ProductModel, 'findOne').mockReturnValue({ select: () => ({ lean: async () => ({
    _id: productId, name: 'Product', price: 100_000,
  }) }) } as never);
  spyOn(InventoryItemModel, 'countDocuments').mockResolvedValue(12 as never);
  spyOn(NotificationModel, 'findOneAndUpdate').mockImplementation((async (
    filter: { _id?: Types.ObjectId; deduplicationKey?: string; status?: { $ne?: string } },
    update: DeliveryUpdate, options?: { timestamps?: boolean; includeResultMetadata?: boolean },
  ) => {
    if (update.$setOnInsert) {
      const key = filter.deduplicationKey!;
      const existing = records.get(key);
      if (!existing) records.set(key, { _id: new Types.ObjectId(), ...update.$setOnInsert });
      else if (options?.timestamps !== false) existing.updatedAt = new Date();
      const record = records.get(key)!;
      return options?.includeResultMetadata
        ? { value: { ...record }, lastErrorObject: { updatedExisting: Boolean(existing), ...(!existing ? { upserted: record._id } : {}) } }
        : record;
    }
    const record = Array.from(records.values()).find((value) => value._id.equals(filter._id));
    if (record && Array.from(failedBeforeClaim).some((key) => records.get(key) === record)) record.status = NotificationStatus.FAILED;
    if (record && filter.status?.$ne === record.status) return null;
    if (!record || (record.status !== NotificationStatus.PENDING && record.status !== NotificationStatus.FAILED)) return null;
    Object.assign(record, update.$set);
    return record;
  }) as never);
  spyOn(NotificationModel, 'updateOne').mockImplementation((async (
    filter: { _id: Types.ObjectId }, update: DeliveryUpdate,
  ) => {
    deliveryUpdates.push(update);
    if (sentWriteFailure && update.$set?.status === NotificationStatus.SENT) throw sentWriteFailure;
    const record = Array.from(records.values()).find((value) => value._id.equals(filter._id))!;
    Object.assign(record, update.$set);
    if (update.$unset?.errorCode) delete record.errorCode;
    return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
  }) as never);
  const recordKey = (index: number) => `${kind === 'purchase' ? 'purchase-proof' : 'restock'}:${eventId}:${recipients[index]!._id}`;
  return { recipients, buyerId, findUsers, deliveryUpdates,
    failBeforeClaim(index: number) {
      const key = recordKey(index);
      records.set(key, { _id: customerMessageId(key), status: NotificationStatus.PENDING, updatedAt: new Date() });
      failedBeforeClaim.add(key);
    },
    failSentWrite(error: Error) { sentWriteFailure = error; },
    run(bot: TelegramBotClient, sender = immediateSender) {
      return kind === 'purchase'
        ? new PurchaseAlertProcessor(bot, sender).processBatch({
          productId: productId.toString(), purchaseGroupId: eventId.toString(), buyerId: buyerId.toString(), quantity: 1, limit: 2,
        })
        : new StockAlertProcessor(bot, sender).processBatch({
          productId: productId.toString(), importBatchId: eventId.toString(), importedRows: 12, limit: 2,
        });
    },
    setStatus(index: number, status: string, updatedAt = new Date()) {
      records.set(recordKey(index), { _id: new Types.ObjectId(), status, updatedAt });
    },
    recordFor(index: number) { return records.get(recordKey(index)); },
  };
}

function pacedBenchmarkSender(): BroadcastSender {
  let nextStart = 0;
  let queue = Promise.resolve();
  return { async send(_chatId, deliver) {
    queue = queue.then(async () => {
      const delay = nextStart - performance.now();
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      nextStart = performance.now() + 40;
    });
    await queue;
    return deliver();
  } };
}

function gate() {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => { open = resolve; });
  return { open, promise };
}

async function startsWithin(signal: Promise<void>, milliseconds: number) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      signal.then(() => true),
      new Promise<boolean>((resolve) => { timeout = setTimeout(() => resolve(false), milliseconds); }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}
