import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import type { AuditLog, InventoryItem, Product } from '@store/database';
import { InventoryStatus, ProductStatus, isMongoDuplicateKey } from '@store/shared';
import type { SaveProductDto } from './product.dto';

@Injectable()
export class ProductService {
  constructor(
    @InjectModel('Product') private readonly products: Model<Product>,
    @InjectModel('InventoryItem') private readonly inventory: Model<InventoryItem>,
    @InjectModel('AuditLog') private readonly audits: Model<AuditLog>,
  ) {}

  async list() {
    const products = await this.products.find({ deletedAt: null }).sort({ sortOrder: 1, createdAt: -1 }).lean();
    const ids = products.map((product) => product._id);
    const stock = ids.length ? await this.inventory.aggregate<{ _id: { productId: Types.ObjectId; status: string }; count: number }>([
      { $match: { productId: { $in: ids }, deletedAt: null } },
      { $group: { _id: { productId: '$productId', status: '$status' }, count: { $sum: 1 } } },
    ]) : [];
    const byProduct = new Map<string, Record<string, number>>();
    for (const row of stock) {
      const key = row._id.productId.toString();
      byProduct.set(key, { ...byProduct.get(key), [row._id.status]: row.count });
    }
    return products.map((product) => ({ ...product,
      availableStock: byProduct.get(product._id.toString())?.[InventoryStatus.AVAILABLE] ?? 0,
      reservedStock: byProduct.get(product._id.toString())?.[InventoryStatus.RESERVED] ?? 0,
      soldStock: byProduct.get(product._id.toString())?.[InventoryStatus.SOLD] ?? 0,
    }));
  }

  async create(input: SaveProductDto, adminId: string, requestId?: string) {
    this.validateTemplate(input);
    const actor = this.objectId(adminId, 'admin');
    try {
      const product = await this.products.create({ ...input, createdBy: actor, updatedBy: actor, deletedAt: null });
      await this.audit(actor, 'PRODUCT_CREATED', product._id, requestId, { slug: product.slug, status: product.status });
      return product;
    } catch (error) {
      if (isMongoDuplicateKey(error)) throw new ConflictException('A product with this slug already exists');
      throw error;
    }
  }

  async update(id: string, input: SaveProductDto, adminId: string, requestId?: string) {
    this.validateTemplate(input);
    const productId = this.objectId(id, 'product');
    const actor = this.objectId(adminId, 'admin');
    const existing = await this.products.findOne({ _id: productId, deletedAt: null });
    if (!existing) throw new NotFoundException('Product not found');
    if (JSON.stringify(existing.fieldDefinitions) !== JSON.stringify(input.fieldDefinitions)) {
      const hasStock = await this.inventory.exists({ productId, deletedAt: null });
      if (hasStock) throw new ConflictException('Inventory fields cannot change after stock has been imported');
    }
    try {
      existing.set({ ...input, updatedBy: actor });
      await existing.save();
      await this.audit(actor, 'PRODUCT_UPDATED', existing._id, requestId, { slug: existing.slug, status: existing.status });
      return existing;
    } catch (error) {
      if (isMongoDuplicateKey(error)) throw new ConflictException('A product with this slug already exists');
      throw error;
    }
  }

  async remove(id: string, adminId: string, requestId?: string) {
    const productId = this.objectId(id, 'product');
    const actor = this.objectId(adminId, 'admin');
    if (await this.inventory.exists({ productId, status: InventoryStatus.RESERVED, deletedAt: null })) {
      throw new ConflictException('Product has reserved inventory and cannot be deleted');
    }
    const product = await this.products.findOneAndUpdate({ _id: productId, deletedAt: null }, { $set: {
      status: ProductStatus.ARCHIVED, deletedAt: new Date(), updatedBy: actor,
    } }, { new: true });
    if (!product) throw new NotFoundException('Product not found');
    await this.audit(actor, 'PRODUCT_DELETED', product._id, requestId, { slug: product.slug });
    return { deleted: true, id: product._id };
  }

  private validateTemplate(input: SaveProductDto) {
    const keys = new Set(input.fieldDefinitions.map((field) => field.key));
    const placeholders = [...input.deliveryTemplate.matchAll(/{{\s*([a-zA-Z0-9_]+)\s*}}/g)].map((match) => match[1]);
    const unknown = placeholders.filter((key) => key !== 'payload' && !keys.has(key));
    if (unknown.length) throw new BadRequestException(`Delivery template contains unknown field: ${unknown[0]}`);
  }

  private objectId(value: string, label: string) {
    if (!Types.ObjectId.isValid(value)) throw new BadRequestException(`Invalid ${label} identifier`);
    return new Types.ObjectId(value);
  }

  private audit(actorId: Types.ObjectId, action: string, resourceId: Types.ObjectId, requestId: string | undefined,
    metadata: Record<string, unknown>) {
    return this.audits.create({ actorType: 'ADMIN', actorId, action, resourceType: 'Product', resourceId, requestId, metadata });
  }
}
