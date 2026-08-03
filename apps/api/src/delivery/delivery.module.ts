import { Module } from '@nestjs/common';
import { Queue } from 'bullmq';
import { loadConfig, redisConnectionOptions } from '@store/config';
import { WalletModule } from '../wallet/wallet.module';
import { DeliveryRecoveryController } from './delivery-recovery.controller';
import { DeliveryRecoveryService } from './delivery-recovery.service';
import { DELIVERY_QUEUE, DeliveryQueue } from './delivery.queue';

@Module({
  imports: [WalletModule],
  controllers: [DeliveryRecoveryController],
  providers: [
    { provide: DELIVERY_QUEUE, useFactory: () => {
      const config = loadConfig();
      return new Queue('delivery', { connection: redisConnectionOptions(config.redisUrl), defaultJobOptions: {
        attempts: config.deliveryAttempts, backoff: { type: 'exponential', delay: config.deliveryBackoffMs },
      } });
    } },
    DeliveryQueue, DeliveryRecoveryService,
  ], exports: [DeliveryQueue, DeliveryRecoveryService],
})
export class DeliveryModule {}
