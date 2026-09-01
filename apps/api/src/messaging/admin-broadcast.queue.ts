import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { QStashTaskPublisher } from '../serverless/qstash';

export interface AdminBroadcastJob { campaignId: string; }
export const ADMIN_BROADCAST_QUEUE = Symbol('ADMIN_BROADCAST_QUEUE');
export interface AdminBroadcastQueueClient { enqueue(job: AdminBroadcastJob): Promise<unknown>; }

@Injectable()
export class AdminBroadcastQueue implements OnModuleDestroy, AdminBroadcastQueueClient {
  constructor(@Inject(ADMIN_BROADCAST_QUEUE) private readonly queue: Queue<AdminBroadcastJob>) {}
  enqueue(job: AdminBroadcastJob) {
    return this.queue.add('admin-broadcast', job, {
      jobId: `admin-broadcast-${job.campaignId}`, attempts: 5,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: { age: 86_400, count: 10_000 }, removeOnFail: { age: 604_800, count: 20_000 },
    });
  }
  async onModuleDestroy() { await this.queue.close(); }
}

export class ServerlessAdminBroadcastQueue implements AdminBroadcastQueueClient {
  constructor(private readonly publisher = new QStashTaskPublisher()) {}
  async enqueue(job: AdminBroadcastJob) {
    await this.publisher.publish('/api/internal/tasks/admin-broadcast', { ...job, limit: 50 }, {
      deduplicationId: `admin-broadcast-${job.campaignId}`, retries: 5,
    });
    return { id: `admin-broadcast-${job.campaignId}` };
  }
}
