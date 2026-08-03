import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { EncryptionService } from '@store/encryption';
import { AuditLog, InventoryItem } from '@store/database';

@Injectable()
export class InventoryAdminService {
  private readonly encryption = EncryptionService.fromEnvironment();
  constructor(
    @InjectModel('InventoryItem') private readonly items: Model<InventoryItem>,
    @InjectModel('AuditLog') private readonly audits: Model<AuditLog>,
  ) {}
  async readFullPayload(itemId: string, adminId: string, permissions: string[], requestId?: string) {
    if (!permissions.includes('*') && !permissions.includes('inventory.read_sensitive')) throw new ForbiddenException('Sensitive inventory permission required');
    const item = await this.items.findOne({ _id: itemId, deletedAt: null }).select('+encryptedPayload');
    if (!item) throw new NotFoundException('Inventory item not found');
    const payload = this.encryption.decrypt<Record<string, unknown>>(item.encryptedPayload);
    await this.audits.create({ actorType: 'ADMIN', actorId: new Types.ObjectId(adminId), action: 'INVENTORY_PAYLOAD_READ',
      resourceType: 'InventoryItem', resourceId: item._id, requestId, metadata: { keyVersion: this.encryption.currentVersion } });
    return payload;
  }
}
