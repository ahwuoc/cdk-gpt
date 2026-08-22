import { Module } from '@nestjs/common';
import { Queue } from 'bullmq';
import { loadConfig, redisConnectionOptions } from '@store/config';
import { WalletModule } from '../wallet/wallet.module';
import { BotConfigModule } from '../bot-config/bot-config.module';
import { BotConfigService } from '../bot-config/bot-config.service';
import { QStashTaskPublisher } from '../serverless/qstash';
import { DeliveryRecoveryController } from './delivery-recovery.controller';
import { DeliveryRecoveryService } from './delivery-recovery.service';
import { DELIVERY_QUEUE, DeliveryQueue, ServerlessDeliveryQueue } from './delivery.queue';

@Module({
  imports: [WalletModule, BotConfigModule],
  controllers: [DeliveryRecoveryController],
  providers: [
    { provide: DELIVERY_QUEUE, useFactory: (runtimeConfig: BotConfigService) => {
      const config = loadConfig();
      if (config.appRuntime === 'serverless') {
        return new ServerlessDeliveryQueue(new QStashTaskPublisher(() => runtimeConfig.getQStashRuntimeConfig()));
      }
      const queue = new Queue('delivery', { connection: redisConnectionOptions(config.redisUrl), defaultJobOptions: {
        attempts: config.deliveryAttempts, backoff: { type: 'exponential', delay: config.deliveryBackoffMs },
      } });
      return new DeliveryQueue(queue);
    }, inject: [BotConfigService] },
    DeliveryRecoveryService,
  ], exports: [DELIVERY_QUEUE, DeliveryRecoveryService],
})
export class DeliveryModule {}
