import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { QStashTaskPublisher } from '../serverless/qstash';

export const DELIVERY_QUEUE = Symbol('DELIVERY_QUEUE');

/** Common surface used by purchases/recovery, independent of the deployment. */
export interface DeliveryQueueClient {
  enqueue(orderId: string): Promise<unknown>;
  requeue(orderId: string): Promise<unknown>;
}

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

/**
 * Durable HTTP delivery queue for Vercel. QStash is at-least-once, while the
 * order state transition remains the authoritative idempotency guard.
 */
export class ServerlessDeliveryQueue implements DeliveryQueueClient {
  constructor(private readonly publisher = new QStashTaskPublisher()) {}

  enqueue(orderId: string) { return this.publish(orderId); }
  requeue(orderId: string) { return this.publish(orderId); }

  private async publish(orderId: string) {
    await this.publisher.publish('/api/internal/tasks/delivery', { orderId }, {
      deduplicationId: `delivery-${orderId}`,
      retries: 5,
    });
    return { id: orderId };
  }
}
