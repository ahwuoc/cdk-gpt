import { Body, Controller, Get, Headers, Post, Query, Req, SetMetadata } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { PUBLIC_ROUTE } from '../auth/auth.guard';
import type { AdminClaims } from '../auth/auth.service';
import { RequirePermissions } from '../auth/permissions.guard';
import { assertSharedSecret } from '../auth/shared-secret';
import { AdminConversationQueryDto, AdminMessageQueryDto, BroadcastQueryDto, ReceiveSupportMessageDto,
  SendBroadcastMessageDto, SendDirectMessageDto } from './messaging.dto';
import { MessagingService } from './messaging.service';

@Controller()
export class MessagingController {
  constructor(private readonly messaging: MessagingService) {}

  @Get('admin/messages') @RequirePermissions('bot.manage')
  list(@Query() query: AdminMessageQueryDto) { return this.messaging.list(query); }

  @Get('admin/messages/conversations') @RequirePermissions('bot.manage')
  conversations(@Query() query: AdminConversationQueryDto) { return this.messaging.listConversations(query); }

  @Post('admin/messages/direct') @RequirePermissions('bot.manage')
  direct(@Body() body: SendDirectMessageDto, @Req() request: FastifyRequest & { admin: AdminClaims },
    @Headers('x-request-id') requestId?: string) {
    return this.messaging.sendDirect(request.admin.sub, body.telegramId, body.body, requestId);
  }

  @Post('admin/messages/broadcast') @RequirePermissions('bot.manage')
  broadcast(@Body() body: SendBroadcastMessageDto, @Req() request: FastifyRequest & { admin: AdminClaims },
    @Headers('x-request-id') requestId?: string) {
    return this.messaging.sendBroadcast(request.admin.sub, body.body, requestId);
  }

  @Get('admin/messages/broadcasts') @RequirePermissions('bot.manage')
  broadcasts(@Query() query: BroadcastQueryDto) { return this.messaging.listBroadcasts(query); }

  @Post('bot/support/messages') @SetMetadata(PUBLIC_ROUTE, true)
  receive(@Body() body: ReceiveSupportMessageDto, @Headers('x-bot-secret') secret?: string) {
    assertSharedSecret(secret, 'BOT_API_SECRET', 'Invalid bot credential');
    return this.messaging.receiveUser(body);
  }
}
