import { Body, Controller, Headers, Post, SetMetadata } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PUBLIC_ROUTE } from '../auth/auth.guard';
import { assertSharedSecret } from '../auth/shared-secret';
import { PurchaseDto } from './purchase.dto';
import { PurchaseService } from './purchase.service';

@ApiTags('purchases')
@Controller('purchases')
@SetMetadata(PUBLIC_ROUTE, true)
export class PurchaseController {
  constructor(private readonly purchases: PurchaseService) {}
  @Post()
  @ApiOperation({ summary: 'Atomically reserve inventory, create an order, and debit the wallet' })
  purchase(@Body() body: PurchaseDto, @Headers('x-bot-secret') secret?: string) {
    assertSharedSecret(secret, 'BOT_API_SECRET', 'Invalid bot credential');
    return this.purchases.purchase(body);
  }
}
