import { Body, Controller, Delete, Get, Headers, Param, Post, Put, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { AdminClaims } from '../auth/auth.service';
import { RequirePermissions } from '../auth/permissions.guard';
import { SaveProductDto } from './product.dto';
import { ProductService } from './product.service';

@Controller('admin/products')
@RequirePermissions('products.manage')
export class ProductController {
  constructor(private readonly products: ProductService) {}

  @Get() @RequirePermissions()
  list() { return this.products.list(); }

  @Post()
  create(@Body() body: SaveProductDto, @Req() request: FastifyRequest & { admin: AdminClaims },
    @Headers('x-request-id') requestId?: string) {
    return this.products.create(body, request.admin.sub, requestId);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() body: SaveProductDto, @Req() request: FastifyRequest & { admin: AdminClaims },
    @Headers('x-request-id') requestId?: string) {
    return this.products.update(id, body, request.admin.sub, requestId);
  }

  @Delete(':id')
  archive(@Param('id') id: string, @Req() request: FastifyRequest & { admin: AdminClaims },
    @Headers('x-request-id') requestId?: string) {
    return this.products.archive(id, request.admin.sub, requestId);
  }
}
