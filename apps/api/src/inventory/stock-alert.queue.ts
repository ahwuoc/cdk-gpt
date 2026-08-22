import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { QStashTaskPublisher } from '../serverless/qstash';

export interface StockAlertJob {
  productId: string;
  importBatchId: string;
  importedRows: number;
}

export const STOCK_ALERT_QUEUE = Symbol('STOCK_ALERT_QUEUE');

export interface StockAlertQueueClient {
  enqueue(job: StockAlertJob): Promise<unknown>;
}

@Injectable()
export class StockAlertQueue implements OnModuleDestroy {
  constructor(@Inject(STOCK_ALERT_QUEUE) private readonly queue: Queue<StockAlertJob>) {}

  enqueue(job: StockAlertJob) {
    return this.queue.add('product-restocked', job, {
      // One import batch may only create one announcement job, even if the HTTP request is retried.
      // BullMQ reserves ':' in custom IDs; keep this stable ID retry-safe without it.
      jobId: `product-restocked-${job.importBatchId}`,
      attempts: 5,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: { age: 86_400, count: 10_000 },
      removeOnFail: { age: 604_800, count: 20_000 },
    });
  }

  async onModuleDestroy() { await this.queue.close(); }
}

/** Serverless counterpart of BullMQ; one restock task is durable per import batch. */
export class ServerlessStockAlertQueue implements StockAlertQueueClient {
  constructor(private readonly publisher = new QStashTaskPublisher()) {}

  async enqueue(job: StockAlertJob) {
    await this.publisher.publish('/api/internal/tasks/restock', { ...job, limit: 50 }, {
      deduplicationId: `product-restocked-${job.importBatchId}`,
      retries: 5,
    });
    return { id: `product-restocked-${job.importBatchId}` };
  }
}
