import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { DatabaseModule } from '@store/database';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { InventoryModule } from './inventory/inventory.module';
import { PaymentModule } from './payment/payment.module';
import { PurchaseModule } from './purchase/purchase.module';
import { WalletModule } from './wallet/wallet.module';
import { BotConfigModule } from './bot-config/bot-config.module';
import { ProductModule } from './product/product.module';
import { CategoryModule } from './category/category.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { RequestTraceInterceptor } from './request-trace.interceptor';
import { WarrantyModule } from './warranty/warranty.module';

@Module({ imports: [DatabaseModule.forRoot(), AuthModule,
  WalletModule, InventoryModule, PaymentModule, PurchaseModule, BotConfigModule, ProductModule, CategoryModule, AnalyticsModule,
  WarrantyModule],
controllers: [AppController], providers: [{ provide: APP_INTERCEPTOR, useClass: RequestTraceInterceptor }] })
export class AppModule {}
