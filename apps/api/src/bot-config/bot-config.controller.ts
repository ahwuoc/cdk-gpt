import { Body, Controller, Get, Headers, Put, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { AdminClaims } from '../auth/auth.service';
import { RequirePermissions } from '../auth/permissions.guard';
import { UpdateBankConfigDto, UpdateBotTokenDto, UpdateRuntimeConfigDto, UpdateWelcomeMessageDto } from './bot-config.dto';
import { BotConfigService } from './bot-config.service';

@Controller('admin/bot-config')
@RequirePermissions('bot.manage')
export class BotConfigController {
  constructor(private readonly config: BotConfigService) {}
  @Get()
  getConfig() { return this.config.getPublicConfig(); }
  @Get('banks')
  listBanks() { return this.config.listBanks(); }
  @Put('token')
  updateToken(@Body() body: UpdateBotTokenDto, @Req() request: FastifyRequest & { admin: AdminClaims },
    @Headers('x-request-id') requestId?: string) {
    return this.config.updateToken(body.token, request.admin.sub, requestId);
  }
  @Put('welcome')
  updateWelcome(@Body() body: UpdateWelcomeMessageDto, @Req() request: FastifyRequest & { admin: AdminClaims },
    @Headers('x-request-id') requestId?: string) {
    return this.config.updateWelcomeMessage(body.message, request.admin.sub, requestId);
  }
  @Put('bank')
  updateBank(@Body() body: UpdateBankConfigDto, @Req() request: FastifyRequest & { admin: AdminClaims },
    @Headers('x-request-id') requestId?: string) {
    return this.config.updateBankConfig(body, request.admin.sub, requestId);
  }
  @Put('runtime')
  updateRuntime(@Body() body: UpdateRuntimeConfigDto, @Req() request: FastifyRequest & { admin: AdminClaims },
    @Headers('x-request-id') requestId?: string) {
    return this.config.updateRuntimeConfig(body, request.admin.sub, requestId);
  }
}
