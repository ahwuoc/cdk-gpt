import { Module } from '@nestjs/common';
import { BotCouponsController, CouponsController } from './coupons.controller';
import { CouponsService } from './coupons.service';

@Module({ controllers: [CouponsController, BotCouponsController], providers: [CouponsService], exports: [CouponsService] })
export class CouponsModule {}
