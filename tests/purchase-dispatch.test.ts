import 'reflect-metadata';
import { expect, mock, spyOn, test } from 'bun:test';
import { Types } from 'mongoose';
import { PurchaseService } from '../apps/api/src/purchase/purchase.service';

test('wallet delivery publishing is bounded and drains failures before announcing the purchase', async () => {
  const orders = storedOrders(9);
  const gates = orders.map(() => deferred());
  const attempted: string[] = [];
  let active = 0; let peak = 0; let settled = false;
  const enqueue = mock(async (id: string) => {
    attempted.push(id); active++; peak = Math.max(peak, active);
    try { await gates[orders.findIndex((order) => order._id.toString() === id)]!.promise; }
    finally { active--; }
  });
  const announce = mock(async (_job: unknown) => undefined);
  const service = purchaseService(orders, enqueue, announce);
  const errors = spyOn(console, 'error').mockImplementation(() => undefined);
  const dispatch = service.dispatchBatch(orders).then(() => { settled = true; });
  try {
    await nextTurn();
    expect(attempted).toHaveLength(4);
    expect(active).toBe(4);

    gates[0]!.reject(new Error('queue temporarily unavailable'));
    gates[1]!.resolve(); gates[2]!.resolve();
    await nextTurn();
    expect(attempted).toHaveLength(4);
    expect(settled).toBe(false);
    expect(announce).not.toHaveBeenCalled();

    gates[3]!.resolve();
    await nextTurn();
    expect(attempted).toHaveLength(8);
    expect(active).toBe(4);
    gates.slice(4, 8).forEach((gate) => gate.resolve());
    await nextTurn();
    expect(attempted).toHaveLength(9);
    expect(settled).toBe(false);
    expect(announce).not.toHaveBeenCalled();

    gates[8]!.resolve();
    await dispatch;
    expect(peak).toBe(4);
    expect(active).toBe(0);
    expect(attempted).toEqual(orders.map((order) => order._id.toString()));
    expect(errors).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce.mock.calls[0]![0]).toMatchObject({ quantity: 9 });
  } finally {
    gates.forEach((gate) => gate.resolve());
    await dispatch;
    errors.mockRestore();
  }
});

test('a grouped bank checkout still publishes one deterministic delivery job', async () => {
  const paymentRequestId = new Types.ObjectId().toString();
  const orders = storedOrders(9, paymentRequestId);
  const enqueue = mock(async (_id: string) => undefined);
  const announce = mock(async (_job: unknown) => undefined);
  const service = purchaseService(orders, enqueue, announce);
  await service.dispatchBatch(orders);
  expect(enqueue.mock.calls).toEqual([[orders[0]!._id.toString()]]);
  expect(announce.mock.calls[0]![0]).toMatchObject({ purchaseGroupId: paymentRequestId, quantity: 9 });
});

function storedOrders(count: number, paymentRequestId?: string) {
  const userId = new Types.ObjectId(); const productId = new Types.ObjectId();
  return Array.from({ length: count }, () => ({ _id: new Types.ObjectId(), userId, productId,
    metadata: paymentRequestId ? { paymentRequestId } : {} }));
}

function purchaseService(orders: ReturnType<typeof storedOrders>, enqueue: (id: string) => Promise<unknown>,
  announce: (job: unknown) => Promise<unknown>) {
  const query = { select: () => query, sort: () => query, lean: async () => orders };
  return new PurchaseService({} as never, {} as never, { find: () => query } as never,
    {} as never, {} as never, {} as never, {} as never, { enqueue, requeue: enqueue }, { enqueue: announce });
}

function deferred() {
  let resolve!: () => void; let reject!: (error: Error) => void;
  const promise = new Promise<void>((success, failure) => { resolve = success; reject = failure; });
  return { promise, resolve, reject };
}

function nextTurn() { return new Promise<void>((resolve) => setImmediate(resolve)); }
