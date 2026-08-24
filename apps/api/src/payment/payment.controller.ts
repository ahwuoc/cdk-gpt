import { Body, Controller, Headers, Param, Post, Req, SetMetadata, UnauthorizedException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { RequirePermissions } from '../auth/permissions.guard';
import { PUBLIC_ROUTE } from '../auth/auth.guard';
import type { AdminClaims } from '../auth/auth.service';
import { assertSharedSecret, sharedSecretMatches } from '../auth/shared-secret';
import { BotConfigService } from '../bot-config/bot-config.service';
import { ApprovePaymentRequestDto, CakeCallbackDto, CheckBotDepositDto, CreateBotCheckoutDto,
  CreateBotDepositDto, CreatePaymentRequestDto, PaymentWebhookDto } from './payment.dto';
import { PaymentService } from './payment.service';

@Controller()
export class PaymentController {
  constructor(private readonly payments: PaymentService, private readonly bankConfig: BotConfigService) {}
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
  @Post('webhooks/bank/cake') @SetMetadata(PUBLIC_ROUTE, true)
  async cakeCallback(@Body() body: CakeCallbackDto, @Headers('signature') signature?: string) {
    const expected = await this.bankConfig.getBankApiTokenForRuntime();
    if (!sharedSecretMatches(signature?.trim(), expected)) throw new UnauthorizedException('Invalid Cake callback signature');
    return this.payments.processCakeCallback(body.transactions);
  }
  @Post('bot/deposits') @SetMetadata(PUBLIC_ROUTE, true)
  createBotDeposit(@Body() body: CreateBotDepositDto, @Headers('x-bot-secret') secret?: string) {
    assertSharedSecret(secret, 'BOT_API_SECRET', 'Invalid bot credential');
    return this.payments.createBankDeposit(body.userId, body.amount, body.idempotencyKey);
  }
  @Post('bot/checkouts') @SetMetadata(PUBLIC_ROUTE, true)
  createBotCheckout(@Body() body: CreateBotCheckoutDto, @Headers('x-bot-secret') secret?: string) {
    assertSharedSecret(secret, 'BOT_API_SECRET', 'Invalid bot credential');
    return this.payments.createBankCheckout(body.userId, body.productId, body.quantity,
      body.expectedUnitPrice, body.idempotencyKey);
  }
  @Post('bot/deposits/:id/check') @SetMetadata(PUBLIC_ROUTE, true)
  checkBotDeposit(@Param('id') id: string, @Body() body: CheckBotDepositDto, @Headers('x-bot-secret') secret?: string) {
    assertSharedSecret(secret, 'BOT_API_SECRET', 'Invalid bot credential');
    return this.payments.checkBankDeposit(id, body.userId);
  }
}
