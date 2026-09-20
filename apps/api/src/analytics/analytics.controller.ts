import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../auth/permissions.guard';
import { AnalyticsService } from './analytics.service';
import { AnalyticsInsightsService } from './insights.service';
import { AnalyticsInsightsQueryDto } from './insights.dto';
import { AuditHistoryQueryDto, DepositHistoryQueryDto, OrderHistoryQueryDto, UserHistoryQueryDto, WalletHistoryQueryDto } from './analytics.dto';

@ApiTags('admin-analytics')
@Controller('admin')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService, private readonly insightsService: AnalyticsInsightsService) {}

  @Get('analytics/insights')
  @RequirePermissions('analytics.read')
  @ApiOperation({ summary: 'Revenue, purchase leaderboard and privacy-limited customer behavior by Vietnam date range' })
  insights(@Query() query: AnalyticsInsightsQueryDto) { return this.insightsService.insights(query); }

  @Get('analytics/summary')
  @RequirePermissions('analytics.read')
  @ApiOperation({ summary: 'Dashboard KPI summary and recent activity' })
  summary() { return this.analytics.summary(); }

  @Get('orders')
  @RequirePermissions('analytics.read')
  @ApiOperation({ summary: 'Paginated order history for administrators' })
  orders(@Query() query: OrderHistoryQueryDto) { return this.analytics.orders(query); }

  @Get('orders/:id')
  @RequirePermissions('analytics.read')
  @ApiOperation({ summary: 'Full safe order detail for administrators' })
  order(@Param('id') id: string) { return this.analytics.orderDetail(id); }

  @Get('deposits')
  @RequirePermissions('analytics.read')
  @ApiOperation({ summary: 'Paginated bank deposit/payment-request history for administrators' })
  deposits(@Query() query: DepositHistoryQueryDto) { return this.analytics.deposits(query); }

  @Get('users')
  @RequirePermissions('users.read')
  @ApiOperation({ summary: 'Paginated Telegram customer directory' })
  users(@Query() query: UserHistoryQueryDto) { return this.analytics.users(query); }

  @Get('wallet-transactions')
  @RequirePermissions('wallet.read')
  @ApiOperation({ summary: 'Paginated wallet accounting ledger' })
  walletTransactions(@Query() query: WalletHistoryQueryDto) { return this.analytics.walletTransactions(query); }

  @Get('audit-logs')
  @RequirePermissions('audit.read')
  @ApiOperation({ summary: 'Paginated operational audit and request trace log' })
  auditLogs(@Query() query: AuditHistoryQueryDto) { return this.analytics.auditLogs(query); }
}
