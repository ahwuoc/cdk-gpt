import { Module } from '@nestjs/common';
import { Queue } from 'bullmq';
import { loadConfig, redisConnectionOptions } from '@store/config';
import { BotConfigModule } from '../bot-config/bot-config.module';
import { BotConfigService } from '../bot-config/bot-config.service';
import { QStashTaskPublisher } from '../serverless/qstash';
import { ADMIN_BROADCAST_QUEUE, AdminBroadcastQueue, ServerlessAdminBroadcastQueue } from './admin-broadcast.queue';
import { MessagingController } from './messaging.controller';
import { MessagingService } from './messaging.service';
import { TelegramMessenger } from './telegram-messenger';

@Module({ imports: [BotConfigModule], controllers: [MessagingController], providers: [
  { provide: ADMIN_BROADCAST_QUEUE, useFactory: (runtimeConfig: BotConfigService) => {
    const config = loadConfig();
    if (config.appRuntime === 'serverless') {
      return new ServerlessAdminBroadcastQueue(new QStashTaskPublisher(() => runtimeConfig.getQStashRuntimeConfig()));
    }
    return new AdminBroadcastQueue(new Queue('admin-broadcasts', { connection: redisConnectionOptions(config.redisUrl) }));
  }, inject: [BotConfigService] },
  TelegramMessenger, MessagingService,
], exports: [TelegramMessenger, MessagingService] })
export class MessagingModule {}
