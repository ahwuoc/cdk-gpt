import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { ClientSession, Connection, Model } from 'mongoose';
import type { AuditLog, InventoryItem, Product, ProductDocument, ProductFieldDefinition } from '@store/database';
import { InventoryStatus, ProductStatus, isMongoDuplicateKey } from '@store/shared';
import type { SaveProductDto } from './product.dto';

@Injectable()
export class ProductService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
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
    const session = await this.connection.startSession(); let product: ProductDocument | undefined;
    try {
      await session.withTransaction(async () => {
        [product] = await this.products.create([{ ...input, createdBy: actor, updatedBy: actor, deletedAt: null }], { session });
        await this.audit(actor, 'PRODUCT_CREATED', product._id, requestId,
          { slug: product.slug, status: product.status }, session);
      });
      if (!product) throw new Error('Product transaction did not create a product');
      return product;
    } catch (error) {
      if (isMongoDuplicateKey(error)) throw new ConflictException('A product with this slug already exists');
      throw error;
    } finally { await session.endSession(); }
  }

  async update(id: string, input: SaveProductDto, adminId: string, requestId?: string) {
    this.validateTemplate(input);
    const productId = this.objectId(id, 'product');
    const actor = this.objectId(adminId, 'admin');
    const session = await this.connection.startSession(); let product: ProductDocument | null | undefined;
    try {
      await session.withTransaction(async () => {
        const existing = await this.products.findOne({ _id: productId, deletedAt: null }).session(session);
        if (!existing) throw new NotFoundException('Product not found');
        if (await this.inventory.exists({ productId, deletedAt: null }).session(session)) {
          this.assertCompatibleFields(existing.fieldDefinitions, input.fieldDefinitions);
        }
        existing.set({ ...input, updatedBy: actor }); await existing.save({ session }); product = existing;
        await this.audit(actor, 'PRODUCT_UPDATED', existing._id, requestId,
          { slug: existing.slug, status: existing.status }, session);
      });
      if (!product) throw new Error('Product transaction did not update a product');
      return product;
    } catch (error) {
      if (isMongoDuplicateKey(error)) throw new ConflictException('A product with this slug already exists');
      throw error;
    } finally { await session.endSession(); }
  }

  async archive(id: string, adminId: string, requestId?: string) {
    const productId = this.objectId(id, 'product');
    const actor = this.objectId(adminId, 'admin');
    const session = await this.connection.startSession(); let product: ProductDocument | null | undefined;
    try {
      await session.withTransaction(async () => {
        if (await this.inventory.exists({ productId, status: InventoryStatus.RESERVED, deletedAt: null }).session(session)) {
          throw new ConflictException('Product has reserved inventory and cannot be archived');
        }
        product = await this.products.findOneAndUpdate({ _id: productId, deletedAt: null }, { $set: {
          status: ProductStatus.ARCHIVED, deletedAt: new Date(), updatedBy: actor,
        } }, { new: true, session });
        if (!product) throw new NotFoundException('Product not found');
        await this.audit(actor, 'PRODUCT_ARCHIVED', product._id, requestId, { slug: product.slug }, session);
      });
      if (!product) throw new Error('Product transaction did not archive a product');
      return { archived: true, id: product._id };
    } finally { await session.endSession(); }
  }

  private validateTemplate(input: SaveProductDto) {
    const keys = new Set(input.fieldDefinitions.map((field) => field.key));
    const placeholders = [...input.deliveryTemplate.matchAll(/{{\s*([a-zA-Z0-9_]+)\s*}}/g)].map((match) => match[1]);
    const unknown = placeholders.filter((key) => key !== 'payload' && !keys.has(key));
    if (unknown.length) throw new BadRequestException(`Delivery template contains unknown field: ${unknown[0]}`);
  }

  private assertCompatibleFields(existing: ProductFieldDefinition[], next: ProductFieldDefinition[]) {
    const byKey = new Map(next.map((field) => [field.key, field]));
    for (const field of existing) {
      const updated = byKey.get(field.key);
      if (!updated || updated.type !== field.type) {
        throw new ConflictException(`Inventory field ${field.key} cannot be removed or change type after stock exists`);
      }
      if (!field.required && updated.required) {
        throw new ConflictException(`Inventory field ${field.key} cannot become required after stock exists`);
      }
    }
    const previousKeys = new Set(existing.map((field) => field.key));
    const unsafeAddition = next.find((field) => !previousKeys.has(field.key) && field.required);
    if (unsafeAddition) throw new ConflictException(`New inventory field ${unsafeAddition.key} must be optional`);
  }

  private objectId(value: string, label: string) {
    if (!Types.ObjectId.isValid(value)) throw new BadRequestException(`Invalid ${label} identifier`);
    return new Types.ObjectId(value);
  }

  private audit(actorId: Types.ObjectId, action: string, resourceId: Types.ObjectId, requestId: string | undefined,
    metadata: Record<string, unknown>, session: ClientSession) {
    return this.audits.create([{ actorType: 'ADMIN', actorId, action, resourceType: 'Product', resourceId, requestId, metadata }], { session });
  }
}
