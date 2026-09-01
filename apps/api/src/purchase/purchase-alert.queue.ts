import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { QStashTaskPublisher } from '../serverless/qstash';

export interface PurchaseAlertJob {
  purchaseGroupId: string;
  productId: string;
  buyerId: string;
  quantity: number;
}

export const PURCHASE_ALERT_QUEUE = Symbol('PURCHASE_ALERT_QUEUE');

export interface PurchaseAlertQueueClient {
  enqueue(job: PurchaseAlertJob): Promise<unknown>;
}

@Injectable()
export class PurchaseAlertQueue implements OnModuleDestroy {
  constructor(@Inject(PURCHASE_ALERT_QUEUE) private readonly queue: Queue<PurchaseAlertJob>) {}

  enqueue(job: PurchaseAlertJob) {
    return this.queue.add('purchase-social-proof', job, {
      jobId: `purchase-proof-${job.purchaseGroupId}`,
      attempts: 5,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: { age: 86_400, count: 10_000 },
      removeOnFail: { age: 604_800, count: 20_000 },
    });
  }

  async onModuleDestroy() { await this.queue.close(); }
}

/** Durable serverless broadcast. Each page is deduplicated independently by QStash. */
export class ServerlessPurchaseAlertQueue implements PurchaseAlertQueueClient {
  constructor(private readonly publisher = new QStashTaskPublisher()) {}

  async enqueue(job: PurchaseAlertJob) {
    await this.publisher.publish('/api/internal/tasks/purchase-alert', { ...job, limit: 50 }, {
      deduplicationId: `purchase-proof-${job.purchaseGroupId}`,
      retries: 5,
    });
    return { id: `purchase-proof-${job.purchaseGroupId}` };
  }
}
