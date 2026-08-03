import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';

export const DELIVERY_QUEUE = Symbol('DELIVERY_QUEUE');

@Injectable()
export class DeliveryQueue implements OnModuleDestroy {
  constructor(@Inject(DELIVERY_QUEUE) private readonly queue: Queue) {}

  async enqueue(orderId: string) {
    return this.queue.add('deliver-order', { orderId }, {
      jobId: orderId,
      removeOnComplete: { age: 86_400, count: 10_000 },
      removeOnFail: { age: 604_800, count: 20_000 },
    });
  }

  async requeue(orderId: string) {
    const existing = await this.queue.getJob(orderId);
    if (existing) {
      const state = await existing.getState();
      if (state === 'failed') { await existing.retry('failed'); return existing; }
      if (state === 'completed') await existing.remove();
      else return existing;
    }
    return this.enqueue(orderId);
  }

  async onModuleDestroy() { await this.queue.close(); }
}
