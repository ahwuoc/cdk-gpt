import { BadRequestException, Body, Controller, Headers, Param, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { Types } from 'mongoose';
import { randomUUID } from 'node:crypto';
import type { AdminClaims } from '../auth/auth.service';
import { RequirePermissions } from '../auth/permissions.guard';
import { AdminWalletAdjustmentDto } from './wallet-admin.dto';
import { WalletService } from './wallet.service';

@ApiTags('admin-wallet')
@Controller('admin/users')
export class WalletAdminController {
  constructor(private readonly wallets: WalletService) {}

  @Post(':id/wallet-adjustments')
  @RequirePermissions('wallet.manage')
  @ApiOperation({ summary: 'Credit or debit a customer wallet with an immutable ledger entry' })
  async adjust(@Param('id') id: string, @Body() body: AdminWalletAdjustmentDto,
    @Req() request: FastifyRequest & { admin: AdminClaims }, @Headers('x-request-id') requestId?: string) {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Invalid customer id');
    if (!Types.ObjectId.isValid(request.admin.sub)) throw new BadRequestException('Invalid admin identity');
    const transaction = await this.wallets.adminAdjust(
      new Types.ObjectId(id), body.amount, body.direction, body.reason, new Types.ObjectId(request.admin.sub),
      `admin-wallet:${requestId?.trim().slice(0, 128) || randomUUID()}`,
    );
    return {
      id: transaction._id.toString(),
      userId: transaction.userId.toString(),
      direction: body.direction,
      amount: transaction.amount,
      balanceBefore: transaction.balanceBefore,
      balanceAfter: transaction.balanceAfter,
      type: transaction.type,
      reason: transaction.reason,
      createdAt: transaction.createdAt,
    };
  }
}
