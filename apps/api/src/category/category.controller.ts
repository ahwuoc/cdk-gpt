import { Body, Controller, Delete, Get, Headers, Param, Post, Put, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { AdminClaims } from '../auth/auth.service';
import { RequirePermissions } from '../auth/permissions.guard';
import { CategoryQueryDto, SaveCategoryDto } from './category.dto';
import { CategoryService } from './category.service';

@Controller('admin/categories')
@RequirePermissions('products.manage')
export class CategoryController {
  constructor(private readonly categories: CategoryService) {}

  @Get() list(@Query() query: CategoryQueryDto) { return this.categories.list(query); }

  @Post() create(@Body() body: SaveCategoryDto, @Req() request: FastifyRequest & { admin: AdminClaims },
    @Headers('x-request-id') requestId?: string) {
    return this.categories.create(body, request.admin.sub, requestId);
  }

  @Put(':id') update(@Param('id') id: string, @Body() body: SaveCategoryDto,
    @Req() request: FastifyRequest & { admin: AdminClaims }, @Headers('x-request-id') requestId?: string) {
    return this.categories.update(id, body, request.admin.sub, requestId);
  }

  @Delete(':id') archive(@Param('id') id: string, @Req() request: FastifyRequest & { admin: AdminClaims },
    @Headers('x-request-id') requestId?: string) {
    return this.categories.archive(id, request.admin.sub, requestId);
  }
}
