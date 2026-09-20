import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { AnalyticsInsightsService } from './insights.service';
import { CustomerEventsController } from './customer-events.controller';

@Module({ controllers: [AnalyticsController, CustomerEventsController], providers: [AnalyticsService, AnalyticsInsightsService] })
export class AnalyticsModule {}
