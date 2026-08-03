import { Module } from '@nestjs/common';
import { BotConfigController } from './bot-config.controller';
import { BotConfigService, botTokenVerifierProvider } from './bot-config.service';

@Module({ controllers: [BotConfigController], providers: [BotConfigService, botTokenVerifierProvider], exports: [BotConfigService] })
export class BotConfigModule {}
