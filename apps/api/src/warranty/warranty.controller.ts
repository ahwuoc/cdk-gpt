import { Body, Controller, Get, Headers, Param, Patch, Post, Query, Req, SetMetadata } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { PUBLIC_ROUTE } from '../auth/auth.guard';
import type { AdminClaims } from '../auth/auth.service';
import { RequirePermissions } from '../auth/permissions.guard';
import { assertSharedSecret } from '../auth/shared-secret';
import { CreateOrderReportDto, OrderReportQueryDto, SendBotOrderReportMessageDto,
  SendOrderReportMessageDto, UpdateOrderReportDto } from './warranty.dto';
import { WarrantyService } from './warranty.service';

@ApiTags('order-reports')
@Controller()
export class WarrantyController {
  constructor(private readonly warranty: WarrantyService) {}

  @Post('bot/order-reports')
  @SetMetadata(PUBLIC_ROUTE, true)
  @ApiOperation({ summary: 'Create one active complaint/warranty report for an owned order' })
  create(@Body() body: CreateOrderReportDto, @Headers('x-bot-secret') secret?: string) {
    assertSharedSecret(secret, 'BOT_API_SECRET', 'Invalid bot credential');
    return this.warranty.create(body);
  }

  @Get('admin/order-reports')
  @RequirePermissions('warranty.manage')
  @ApiOperation({ summary: 'List and filter customer order reports' })
  list(@Query() query: OrderReportQueryDto) { return this.warranty.list(query); }

  @Get('admin/order-reports/:id/messages')
  @RequirePermissions('warranty.manage')
  messages(@Param('id') id: string) { return this.warranty.messages(id); }

  @Post('admin/order-reports/:id/messages')
  @RequirePermissions('warranty.manage')
  reply(@Param('id') id: string, @Body() body: SendOrderReportMessageDto,
    @Req() request: FastifyRequest & { admin: AdminClaims }, @Headers('x-request-id') requestId?: string) {
    return this.warranty.reply(id, request.admin.sub, body.body, requestId);
  }

  @Post('bot/order-reports/:id/messages')
  @SetMetadata(PUBLIC_ROUTE, true)
  userReply(@Param('id') id: string, @Body() body: SendBotOrderReportMessageDto,
    @Headers('x-bot-secret') secret?: string) {
    assertSharedSecret(secret, 'BOT_API_SECRET', 'Invalid bot credential');
    return this.warranty.userReply(id, body.userId, body.body, body.idempotencyKey);
  }

  @Patch('admin/order-reports/:id')
  @RequirePermissions('warranty.manage')
  @ApiOperation({ summary: 'Review or resolve a customer order report' })
  update(@Param('id') id: string, @Body() body: UpdateOrderReportDto,
    @Req() request: FastifyRequest & { admin: AdminClaims }, @Headers('x-request-id') requestId?: string) {
    return this.warranty.update(id, request.admin.sub, body, requestId);
  }
}
