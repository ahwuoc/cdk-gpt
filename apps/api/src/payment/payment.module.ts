import { Module } from '@nestjs/common';
import { WalletModule } from '../wallet/wallet.module';
import { BotConfigModule } from '../bot-config/bot-config.module';
import { PurchaseModule } from '../purchase/purchase.module';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { BankReconciliationService } from './bank-reconciliation.service';

@Module({ imports: [WalletModule, BotConfigModule, PurchaseModule], controllers: [PaymentController],
  providers: [PaymentService, BankReconciliationService], exports: [PaymentService, BankReconciliationService] })
export class PaymentModule {}
