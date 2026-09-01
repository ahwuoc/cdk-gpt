import { Module } from '@nestjs/common';
import { Queue } from 'bullmq';
import { loadConfig, redisConnectionOptions } from '@store/config';
import { BotConfigModule } from '../bot-config/bot-config.module';
import { BotConfigService } from '../bot-config/bot-config.service';
import { DeliveryModule } from '../delivery/delivery.module';
import { InventoryModule } from '../inventory/inventory.module';
import { QStashTaskPublisher } from '../serverless/qstash';
import { PURCHASE_ALERT_QUEUE, PurchaseAlertQueue, ServerlessPurchaseAlertQueue } from './purchase-alert.queue';
import { PurchaseController } from './purchase.controller';
import { PurchaseService } from './purchase.service';

@Module({ imports: [BotConfigModule, DeliveryModule, InventoryModule], controllers: [PurchaseController], providers: [
  { provide: PURCHASE_ALERT_QUEUE, useFactory: (runtimeConfig: BotConfigService) => {
    const config = loadConfig();
    if (config.appRuntime === 'serverless') {
      return new ServerlessPurchaseAlertQueue(new QStashTaskPublisher(() => runtimeConfig.getQStashRuntimeConfig()));
    }
    return new PurchaseAlertQueue(new Queue('purchase-social-proofs', { connection: redisConnectionOptions(config.redisUrl) }));
  }, inject: [BotConfigService] },
  PurchaseService,
], exports: [PurchaseService] })
export class PurchaseModule {}
