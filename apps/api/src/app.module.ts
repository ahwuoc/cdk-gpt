import { Module } from '@nestjs/common';
import { DatabaseModule } from '@store/database';
import { loadConfig } from '@store/config';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { InventoryModule } from './inventory/inventory.module';
import { PaymentModule } from './payment/payment.module';
import { PurchaseModule } from './purchase/purchase.module';
import { WalletModule } from './wallet/wallet.module';

const config = loadConfig();
@Module({ imports: [DatabaseModule.forRoot(config.mongoUri, config.nodeEnv !== 'production'), AuthModule,
  WalletModule, InventoryModule, PaymentModule, PurchaseModule], controllers: [AppController] })
export class AppModule {}
