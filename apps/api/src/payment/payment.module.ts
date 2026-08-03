import { Module } from '@nestjs/common';
import { WalletModule } from '../wallet/wallet.module';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';

@Module({ imports: [WalletModule], controllers: [PaymentController], providers: [PaymentService], exports: [PaymentService] })
export class PaymentModule {}
