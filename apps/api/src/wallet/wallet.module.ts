import { Module } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { WalletAdminController } from './wallet-admin.controller';

@Module({ controllers: [WalletAdminController], providers: [WalletService], exports: [WalletService] })
export class WalletModule {}
