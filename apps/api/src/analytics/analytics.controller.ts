import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../auth/permissions.guard';
import { AnalyticsService } from './analytics.service';
import { DepositHistoryQueryDto, OrderHistoryQueryDto } from './analytics.dto';

@ApiTags('admin-analytics')
@Controller('admin')
@RequirePermissions('analytics.read')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('analytics/summary')
  @ApiOperation({ summary: 'Dashboard KPI summary and recent activity' })
  summary() { return this.analytics.summary(); }

  @Get('orders')
  @ApiOperation({ summary: 'Paginated order history for administrators' })
  orders(@Query() query: OrderHistoryQueryDto) { return this.analytics.orders(query); }

  @Get('deposits')
  @ApiOperation({ summary: 'Paginated bank deposit/payment-request history for administrators' })
  deposits(@Query() query: DepositHistoryQueryDto) { return this.analytics.deposits(query); }
}
