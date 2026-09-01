import { Module } from '@nestjs/common';
import { WarrantyController } from './warranty.controller';
import { WarrantyService } from './warranty.service';
import { WarrantyNotifier } from './warranty.notifier';
import { BotConfigModule } from '../bot-config/bot-config.module';
import { MessagingModule } from '../messaging/messaging.module';

@Module({ imports: [BotConfigModule, MessagingModule], controllers: [WarrantyController], providers: [WarrantyService, WarrantyNotifier] })
export class WarrantyModule {}
