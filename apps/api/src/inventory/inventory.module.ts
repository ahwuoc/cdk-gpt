import { Module } from '@nestjs/common';
import { InventoryAdminService } from './inventory-admin.service';
import { InventoryController } from './inventory.controller';
import { InventoryImportService } from './inventory-import.service';
import { InventoryReservationService } from './inventory-reservation.service';

@Module({ controllers: [InventoryController], providers: [InventoryAdminService, InventoryImportService, InventoryReservationService],
  exports: [InventoryImportService, InventoryReservationService] })
export class InventoryModule {}
