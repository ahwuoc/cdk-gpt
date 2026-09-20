import { Body, Controller, Headers, Post, SetMetadata } from '@nestjs/common';
import { PUBLIC_ROUTE } from '../auth/auth.guard';
import { assertSharedSecret } from '../auth/shared-secret';
import { RecordCustomerEventDto } from './insights.dto';
import { AnalyticsInsightsService } from './insights.service';

@Controller('bot/analytics')
export class CustomerEventsController {
  constructor(private readonly insights: AnalyticsInsightsService) {}

  @Post('events') @SetMetadata(PUBLIC_ROUTE, true)
  record(@Body() body: RecordCustomerEventDto, @Headers('x-bot-secret') secret?: string) {
    assertSharedSecret(secret, 'BOT_API_SECRET', 'Invalid bot credential');
    return this.insights.recordEvent(body);
  }
}
