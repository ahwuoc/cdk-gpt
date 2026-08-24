import { Module } from '@nestjs/common';
import { WarrantyController } from './warranty.controller';
import { WarrantyService } from './warranty.service';
import { WarrantyNotifier } from './warranty.notifier';
import { BotConfigModule } from '../bot-config/bot-config.module';

@Module({ imports: [BotConfigModule], controllers: [WarrantyController], providers: [WarrantyService, WarrantyNotifier] })
export class WarrantyModule {}
