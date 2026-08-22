import { Module } from '@nestjs/common';
import { Queue } from 'bullmq';
import { loadConfig, redisConnectionOptions } from '@store/config';
import { BotConfigModule } from '../bot-config/bot-config.module';
import { BotConfigService } from '../bot-config/bot-config.service';
import { QStashTaskPublisher } from '../serverless/qstash';
import { InventoryAdminService } from './inventory-admin.service';
import { InventoryController } from './inventory.controller';
import { InventoryImportService } from './inventory-import.service';
import { InventoryReservationService } from './inventory-reservation.service';
import { STOCK_ALERT_QUEUE, ServerlessStockAlertQueue, StockAlertQueue } from './stock-alert.queue';

@Module({ imports: [BotConfigModule], controllers: [InventoryController], providers: [
  { provide: STOCK_ALERT_QUEUE, useFactory: (runtimeConfig: BotConfigService) => {
    const config = loadConfig();
    if (config.appRuntime === 'serverless') {
      return new ServerlessStockAlertQueue(new QStashTaskPublisher(() => runtimeConfig.getQStashRuntimeConfig()));
    }
    return new StockAlertQueue(new Queue('product-restock-alerts', { connection: redisConnectionOptions(config.redisUrl) }));
  }, inject: [BotConfigService] },
  InventoryAdminService, InventoryImportService, InventoryReservationService,
], exports: [InventoryImportService, InventoryReservationService] })
export class InventoryModule {}
