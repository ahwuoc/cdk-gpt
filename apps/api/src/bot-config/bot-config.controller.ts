import { Body, Controller, Get, Headers, Put, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { AdminClaims } from '../auth/auth.service';
import { RequirePermissions } from '../auth/permissions.guard';
import { UpdateBotTokenDto } from './bot-config.dto';
import { BotConfigService } from './bot-config.service';

@Controller('admin/bot-config')
@RequirePermissions('bot.manage')
export class BotConfigController {
  constructor(private readonly config: BotConfigService) {}
  @Get()
  getConfig() { return this.config.getPublicConfig(); }
  @Put('token')
  updateToken(@Body() body: UpdateBotTokenDto, @Req() request: FastifyRequest & { admin: AdminClaims },
    @Headers('x-request-id') requestId?: string) {
    return this.config.updateToken(body.token, request.admin.sub, requestId);
  }
}
