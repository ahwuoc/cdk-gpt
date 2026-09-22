import { Body, Controller, Headers, Param, Post, Req, SetMetadata, UnauthorizedException, Optional } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { RequirePermissions } from '../auth/permissions.guard';
import { PUBLIC_ROUTE } from '../auth/auth.guard';
import type { AdminClaims } from '../auth/auth.service';
import { assertSharedSecret, sharedSecretMatches } from '../auth/shared-secret';
import { BotConfigService } from '../bot-config/bot-config.service';
import { ApprovePaymentRequestDto, CakeCallbackDto, CheckBotDepositDto, CreateBotCheckoutDto,
  CreateBotDepositDto, CreatePaymentRequestDto, PaymentWebhookDto, SaveBotCheckoutPromptDto } from './payment.dto';
import { TestBankHistoryDto } from '../bot-config/bot-config.dto';
import { PaymentService } from './payment.service';
import { BankReconciliationDto } from './bank-reconciliation.dto';
import { BankReconciliationService } from './bank-reconciliation.service';

@Controller()
export class PaymentController {
  constructor(private readonly payments: PaymentService, private readonly bankConfig: BotConfigService,
    @Optional() private readonly reconciliation?: BankReconciliationService) {}
  @Post('payment-requests') @RequirePermissions('payments.approve')
  create(@Body() body: CreatePaymentRequestDto) { return this.payments.create(body.userId, body.amount, body.provider, body.idempotencyKey); }
  @Post('admin/payment-requests/:id/approve') @RequirePermissions('payments.approve')
  approve(@Param('id') id: string, @Body() body: ApprovePaymentRequestDto, @Req() req: FastifyRequest & { admin: AdminClaims }) {
    return this.payments.approve(id, req.admin.sub, body.idempotencyKey);
  }
  @Post('admin/payments/bank/test') @RequirePermissions('payments.approve')
  testCakeHistory(@Body() body?: TestBankHistoryDto) { return this.payments.testCakeHistoryConnection(body?.bankConfigId); }
  @Post('admin/payments/bank/reconcile') @RequirePermissions('payments.approve')
  reconcileBank(@Body() body: BankReconciliationDto) {
    if (!this.reconciliation) throw new UnauthorizedException('Bank reconciliation is unavailable');
    return this.reconciliation.reconcile(body.bankConfigId);
  }

  @Post('webhooks/payments') @SetMetadata(PUBLIC_ROUTE, true)
  webhook(@Body() body: PaymentWebhookDto, @Headers('x-webhook-secret') secret?: string) {
    assertSharedSecret(secret, 'PAYMENT_WEBHOOK_SECRET', 'Invalid webhook signature');
    return this.payments.processWebhook(body.provider, body.providerReference, body.userId, body.amount);
  }
  @Post('webhooks/bank/cake') @SetMetadata(PUBLIC_ROUTE, true)
  async cakeCallback(@Body() body: CakeCallbackDto, @Headers('signature') signature?: string) {
    const matched = this.bankConfig.findBankConfigByToken
      ? await this.bankConfig.findBankConfigByToken(signature) : undefined;
    const expected = matched?.token ?? await this.bankConfig.getBankApiTokenForRuntime();
    if (!sharedSecretMatches(signature?.trim(), expected)) throw new UnauthorizedException('Invalid Cake callback signature');
    return matched?.id ? this.payments.processCakeCallback(body.transactions, matched.id)
      : this.payments.processCakeCallback(body.transactions);
  }
  @Post('webhooks/bank/:bankConfigId') @SetMetadata(PUBLIC_ROUTE, true)
  async bankCallback(@Param('bankConfigId') bankConfigId: string, @Body() body: CakeCallbackDto,
    @Headers('signature') signature?: string) {
    const bank = await this.bankConfig.getBankConfigForRuntime(bankConfigId);
    if (!sharedSecretMatches(signature?.trim(), bank?.token)) throw new UnauthorizedException('Invalid bank callback signature');
    return this.payments.processCakeCallback(body.transactions, bankConfigId);
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
      body.expectedUnitPrice, body.idempotencyKey, body.couponCode, body.expectedTotalAmount);
  }
  @Post('bot/checkouts/:id/cancel') @SetMetadata(PUBLIC_ROUTE, true)
  cancelBotCheckout(@Param('id') id: string, @Body() body: CheckBotDepositDto, @Headers('x-bot-secret') secret?: string) {
    assertSharedSecret(secret, 'BOT_API_SECRET', 'Invalid bot credential');
    return this.payments.cancelBankCheckout(id, body.userId);
  }
  @Post('bot/checkouts/:id/prompt') @SetMetadata(PUBLIC_ROUTE, true)
  saveBotCheckoutPrompt(@Param('id') id: string, @Body() body: SaveBotCheckoutPromptDto,
    @Headers('x-bot-secret') secret?: string) {
    assertSharedSecret(secret, 'BOT_API_SECRET', 'Invalid bot credential');
    return this.payments.saveBankCheckoutPrompt(id, body.userId, body.chatId, body.messageId);
  }
  @Post('bot/deposits/:id/check') @SetMetadata(PUBLIC_ROUTE, true)
  checkBotDeposit(@Param('id') id: string, @Body() body: CheckBotDepositDto, @Headers('x-bot-secret') secret?: string) {
    assertSharedSecret(secret, 'BOT_API_SECRET', 'Invalid bot credential');
    return this.payments.checkBankDeposit(id, body.userId);
  }
}
