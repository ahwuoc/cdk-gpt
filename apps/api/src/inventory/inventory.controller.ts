import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { RequireAnyPermission, RequirePermissions } from '../auth/permissions.guard';
import type { AdminClaims } from '../auth/auth.service';
import { ImportInventoryDto, InventoryListQueryDto } from './inventory.dto';
import { InventoryImportService } from './inventory-import.service';
import { InventoryAdminService } from './inventory-admin.service';
import { InventoryReservationService } from './inventory-reservation.service';

@Controller('admin/inventory')
export class InventoryController {
  constructor(private readonly importer: InventoryImportService, private readonly admin: InventoryAdminService,
    private readonly reservations: InventoryReservationService) {}

  @Get() @RequireAnyPermission('inventory.manage', 'inventory.import')
  list(@Query() query: InventoryListQueryDto) { return this.admin.list(query); }

  // Bulk searches travel in the body so long account lists do not exceed URL limits.
  @Post('search') @HttpCode(200) @RequireAnyPermission('inventory.manage', 'inventory.import')
  search(@Body() query: InventoryListQueryDto) { return this.admin.list(query); }

  @Post('import/preview') @RequirePermissions('inventory.import')
  preview(@Body() body: ImportInventoryDto) { return this.importer.preview(body.productId, body.rows); }
  @Post('import') @RequirePermissions('inventory.import')
  commit(@Body() body: ImportInventoryDto, @Req() req: FastifyRequest & { admin: AdminClaims }) {
    return this.importer.commit(body.productId, body.rows, req.admin.sub, body.sourceName, body.overwriteDuplicates);
  }
  @Get(':id/payload') @RequirePermissions('inventory.read_sensitive')
  payload(@Param('id') id: string, @Req() req: FastifyRequest & { admin: AdminClaims }, @Headers('x-request-id') requestId?: string) {
    return this.admin.readFullPayload(id, req.admin.sub, req.admin.permissions ?? [], requestId);
  }

  // Define the literal batch route before :id so DELETE requests never treat "batches" as an item id.
  @Delete('batches/:batchId') @RequirePermissions('inventory.manage')
  removeBatch(@Param('batchId') batchId: string, @Req() req: FastifyRequest & { admin: AdminClaims },
    @Headers('x-request-id') requestId?: string) {
    return this.admin.removeBatch(batchId, req.admin.sub, requestId);
  }

  @Delete(':id') @RequirePermissions('inventory.manage')
  removeItem(@Param('id') id: string, @Req() req: FastifyRequest & { admin: AdminClaims },
    @Headers('x-request-id') requestId?: string) {
    return this.admin.removeItem(id, req.admin.sub, requestId);
  }

  @Post('reservations/release-expired') @RequirePermissions('inventory.manage')
  releaseExpired() { return this.reservations.releaseExpired(); }
}
