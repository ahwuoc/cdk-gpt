import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { AnalyticsInsightsService } from './insights.service';
import { CustomerEventsController } from './customer-events.controller';
import { ProductRepeatPurchasesService } from './product-repeat-purchases.service';

@Module({ controllers: [AnalyticsController, CustomerEventsController],
  providers: [AnalyticsService, AnalyticsInsightsService, ProductRepeatPurchasesService] })
export class AnalyticsModule {}
