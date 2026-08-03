import { Controller, Param, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { AdminClaims } from '../auth/auth.service';
import { RequirePermissions } from '../auth/permissions.guard';
import { DeliveryRecoveryService } from './delivery-recovery.service';

@Controller('admin/orders/:id/delivery')
@RequirePermissions('orders.delivery_recover')
export class DeliveryRecoveryController {
  constructor(private readonly recovery: DeliveryRecoveryService) {}
  @Post('resend') resend(@Param('id') id: string, @Req() request: FastifyRequest & { admin: AdminClaims }) {
    return this.recovery.resend(id, request.admin.sub);
  }
  @Post('replace') replace(@Param('id') id: string, @Req() request: FastifyRequest & { admin: AdminClaims }) {
    return this.recovery.replace(id, request.admin.sub);
  }
  @Post('refund') refund(@Param('id') id: string, @Req() request: FastifyRequest & { admin: AdminClaims }) {
    return this.recovery.refund(id, request.admin.sub);
  }
}
