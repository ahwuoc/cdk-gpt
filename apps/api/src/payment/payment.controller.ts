import { Body, Controller, Headers, Param, Post, Req, SetMetadata } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { RequirePermissions } from '../auth/permissions.guard';
import { PUBLIC_ROUTE } from '../auth/auth.guard';
import type { AdminClaims } from '../auth/auth.service';
import { assertSharedSecret } from '../auth/shared-secret';
import { ApprovePaymentRequestDto, CheckBotDepositDto, CreateBotDepositDto, CreatePaymentRequestDto, PaymentWebhookDto } from './payment.dto';
import { PaymentService } from './payment.service';

@Controller()
export class PaymentController {
  constructor(private readonly payments: PaymentService) {}
  @Post('payment-requests') @RequirePermissions('payments.approve')
  create(@Body() body: CreatePaymentRequestDto) { return this.payments.create(body.userId, body.amount, body.provider, body.idempotencyKey); }
  @Post('admin/payment-requests/:id/approve') @RequirePermissions('payments.approve')
  approve(@Param('id') id: string, @Body() body: ApprovePaymentRequestDto, @Req() req: FastifyRequest & { admin: AdminClaims }) {
    return this.payments.approve(id, req.admin.sub, body.idempotencyKey);
  }
  @Post('webhooks/payments') @SetMetadata(PUBLIC_ROUTE, true)
  webhook(@Body() body: PaymentWebhookDto, @Headers('x-webhook-secret') secret?: string) {
    assertSharedSecret(secret, 'PAYMENT_WEBHOOK_SECRET', 'Invalid webhook signature');
    return this.payments.processWebhook(body.provider, body.providerReference, body.userId, body.amount);
  }
  @Post('bot/deposits') @SetMetadata(PUBLIC_ROUTE, true)
  createBotDeposit(@Body() body: CreateBotDepositDto, @Headers('x-bot-secret') secret?: string) {
    assertSharedSecret(secret, 'BOT_API_SECRET', 'Invalid bot credential');
    return this.payments.createBankDeposit(body.userId, body.amount, body.idempotencyKey);
  }
  @Post('bot/deposits/:id/check') @SetMetadata(PUBLIC_ROUTE, true)
  checkBotDeposit(@Param('id') id: string, @Body() body: CheckBotDepositDto, @Headers('x-bot-secret') secret?: string) {
    assertSharedSecret(secret, 'BOT_API_SECRET', 'Invalid bot credential');
    return this.payments.checkBankDeposit(id, body.userId);
  }
}
