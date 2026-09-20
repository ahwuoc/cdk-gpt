import { Body, Controller, Get, Headers, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { AdminClaims } from '../auth/auth.service';
import { RequirePermissions } from '../auth/permissions.guard';
import { CouponQueryDto, CreateCouponDto, UpdateCouponDto } from './coupons.dto';
import { CouponsService } from './coupons.service';

@Controller('admin/coupons')
@RequirePermissions('products.manage')
export class CouponsController {
  constructor(private readonly coupons: CouponsService) {}
  @Get() list(@Query() query: CouponQueryDto) { return this.coupons.list(query); }
  @Post() create(@Body() input: CreateCouponDto, @Req() request: FastifyRequest & { admin: AdminClaims },
    @Headers('x-request-id') requestId?: string) { return this.coupons.create(input, request.admin.sub, requestId); }
  @Patch(':id') update(@Param('id') id: string, @Body() input: UpdateCouponDto,
    @Req() request: FastifyRequest & { admin: AdminClaims }, @Headers('x-request-id') requestId?: string) {
    return this.coupons.update(id, input, request.admin.sub, requestId);
  }
}
