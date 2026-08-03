import { Body, Controller, Get, Headers, Param, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { RequirePermissions } from '../auth/permissions.guard';
import type { AdminClaims } from '../auth/auth.service';
import { ImportInventoryDto } from './inventory.dto';
import { InventoryImportService } from './inventory-import.service';
import { InventoryAdminService } from './inventory-admin.service';
import { InventoryReservationService } from './inventory-reservation.service';

@Controller('admin/inventory')
export class InventoryController {
  constructor(private readonly importer: InventoryImportService, private readonly admin: InventoryAdminService,
    private readonly reservations: InventoryReservationService) {}
  @Post('import/preview') @RequirePermissions('inventory.import')
  preview(@Body() body: ImportInventoryDto) { return this.importer.preview(body.productId, body.rows); }
  @Post('import') @RequirePermissions('inventory.import')
  commit(@Body() body: ImportInventoryDto, @Req() req: FastifyRequest & { admin: AdminClaims }) {
    return this.importer.commit(body.productId, body.rows, req.admin.sub, body.sourceName);
  }
  @Get(':id/payload') @RequirePermissions('inventory.read_sensitive')
  payload(@Param('id') id: string, @Req() req: FastifyRequest & { admin: AdminClaims }, @Headers('x-request-id') requestId?: string) {
    return this.admin.readFullPayload(id, req.admin.sub, req.admin.permissions ?? [], requestId);
  }
  @Post('reservations/release-expired') @RequirePermissions('inventory.manage')
  releaseExpired() { return this.reservations.releaseExpired(); }
}
