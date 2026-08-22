import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { ClientSession, Connection, Model } from 'mongoose';
import type { AuditLog, Category, InventoryItem, Product, ProductDocument, ProductFieldDefinition } from '@store/database';
import { EncryptionService, createMaskedPreview } from '@store/encryption';
import { InventoryStatus, ProductStatus, isMongoDuplicateKey } from '@store/shared';
import type { SaveProductDto } from './product.dto';
import type { ProductQueryDto } from './product-query.dto';

type ProductListItem = Product & { availableStock: number; reservedStock: number; soldStock: number };
type ProductPage = { items: ProductListItem[]; pagination: { page: number; limit: number; total: number; totalPages: number } };
type FieldRename = { from: string; to: string };

@Injectable()
export class ProductService {
  private readonly encryption = EncryptionService.fromEnvironment();

  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel('Product') private readonly products: Model<Product>,
    @InjectModel('InventoryItem') private readonly inventory: Model<InventoryItem>,
    @InjectModel('AuditLog') private readonly audits: Model<AuditLog>,
    @InjectModel('Category') private readonly categories?: Model<Category>,
  ) {}

  async list(): Promise<ProductListItem[]>;
  async list(query: ProductQueryDto): Promise<ProductPage>;
  async list(query?: ProductQueryDto): Promise<ProductListItem[] | ProductPage> {
    // Keep the service-level no-argument call backwards compatible for workers/tests;
    // HTTP callers receive a paginated result because Nest supplies the query DTO.
    const legacyArray = !query;
    const page = query?.page ?? 1;
    const limit = query?.limit ?? 20;
    const filter: Record<string, unknown> = { deletedAt: null };
    if (query?.categoryId) filter.categoryId = new Types.ObjectId(query.categoryId);
    if (query?.status) filter.status = query.status;
    const search = query?.search?.trim();
    if (search) filter.$text = { $search: search };
    const [products, total] = await Promise.all([
      this.products.find(filter).sort({ sortOrder: 1, createdAt: -1, _id: 1 }).skip((page - 1) * limit).limit(limit).lean(),
      this.products.countDocuments(filter),
    ]);
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
    const items = products.map((product) => ({ ...product,
      availableStock: byProduct.get(product._id.toString())?.[InventoryStatus.AVAILABLE] ?? 0,
      reservedStock: byProduct.get(product._id.toString())?.[InventoryStatus.RESERVED] ?? 0,
      soldStock: byProduct.get(product._id.toString())?.[InventoryStatus.SOLD] ?? 0,
    }));
    if (legacyArray) return items;
    return { items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  async create(input: SaveProductDto, adminId: string, requestId?: string) {
    const normalizedInput = this.normalizeInput(input);
    this.validateTemplate(normalizedInput);
    await this.assertCategory(normalizedInput.categoryId);
    const actor = this.objectId(adminId, 'admin');
    const session = await this.connection.startSession(); let product: ProductDocument | undefined;
    try {
      await session.withTransaction(async () => {
        [product] = await this.products.create([{ ...normalizedInput, createdBy: actor, updatedBy: actor, deletedAt: null }], { session });
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
    const normalizedInput = this.normalizeInput(input);
    await this.assertCategory(normalizedInput.categoryId);
    const productId = this.objectId(id, 'product');
    const actor = this.objectId(adminId, 'admin');
    const session = await this.connection.startSession(); let product: ProductDocument | null | undefined;
    try {
      await session.withTransaction(async () => {
        const existing = await this.products.findOne({ _id: productId, deletedAt: null }).session(session);
        if (!existing) throw new NotFoundException('Product not found');
        let renamedFields: FieldRename[] = [];
        let effectiveInput = normalizedInput;
        if (await this.inventory.exists({ productId, deletedAt: null }).session(session)) {
          renamedFields = this.assertCompatibleFields(existing.fieldDefinitions, normalizedInput.fieldDefinitions);
          effectiveInput = renameProductReferences(normalizedInput, renamedFields);
          this.validateTemplate(effectiveInput);
          if (renamedFields.length) {
            await this.renameInventoryFieldKeys(productId, renamedFields, effectiveInput.fieldDefinitions, actor, session);
          }
        } else {
          this.validateTemplate(effectiveInput);
        }
        existing.set({ ...effectiveInput, updatedBy: actor }); await existing.save({ session }); product = existing;
        await this.audit(actor, 'PRODUCT_UPDATED', existing._id, requestId,
          { slug: existing.slug, status: existing.status, renamedFields }, session);
      });
      if (!product) throw new Error('Product transaction did not update a product');
      return product;
    } catch (error) {
      if (isMongoDuplicateKey(error)) {
        if (error.keyPattern?.payloadHash) throw new ConflictException('Key mới làm trùng dữ liệu tồn kho; không thể đổi key này');
        throw new ConflictException('A product with this slug already exists');
      }
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
    const patternKeys = parseInventoryPattern(input.inventoryPattern ?? '');
    const duplicates = patternKeys.find((key, index) => patternKeys.indexOf(key) !== index);
    if (duplicates) throw new BadRequestException(`Inventory pattern repeats field: ${duplicates}`);
    const missing = input.fieldDefinitions.find((field) => field.required && !patternKeys.includes(field.key));
    if (missing) throw new BadRequestException(`Inventory pattern must include required field: ${missing.key}`);
    const unknownPatternKey = patternKeys.find((key) => !keys.has(key));
    if (unknownPatternKey) throw new BadRequestException(`Inventory pattern contains unknown field: ${unknownPatternKey}`);
  }

  private normalizeInput(input: SaveProductDto): SaveProductDto {
    const inventoryPattern = input.inventoryPattern?.trim() || [...input.fieldDefinitions]
      .sort((left, right) => left.sortOrder - right.sortOrder).map((field) => field.key).join('----');
    return { ...input, inventoryPattern };
  }

  private async assertCategory(categoryId?: string) {
    if (!categoryId || !this.categories) return;
    if (!Types.ObjectId.isValid(categoryId)) throw new BadRequestException('Invalid category identifier');
    const category = await this.categories.exists({ _id: categoryId, deletedAt: null });
    if (!category) throw new BadRequestException('Category not found or archived');
  }

  private assertCompatibleFields(existing: ProductFieldDefinition[], next: ProductFieldDefinition[]): FieldRename[] {
    if (next.length < existing.length) {
      throw new ConflictException('Existing inventory fields cannot be removed after stock exists');
    }
    const renames: FieldRename[] = [];
    for (const [index, field] of existing.entries()) {
      // Fields are ordered by sortOrder in the admin form. Matching the original position lets a
      // key rename be explicit while rejecting removal/re-ordering that would map values ambiguously.
      const updated = next[index];
      if (!updated || updated.type !== field.type || updated.sortOrder !== field.sortOrder) {
        throw new ConflictException(`Inventory field ${field.key} cannot be removed, reordered, or change type after stock exists`);
      }
      if (!field.required && updated.required) {
        throw new ConflictException(`Inventory field ${field.key} cannot become required after stock exists`);
      }
      if (field.sensitive !== updated.sensitive || field.visibleToCustomer !== updated.visibleToCustomer) {
        throw new ConflictException(`Inventory field ${field.key} visibility cannot change after stock exists`);
      }
      if (field.key !== updated.key) {
        if (field.required !== updated.required || field.sortOrder !== updated.sortOrder) {
          throw new ConflictException(`Inventory field ${field.key} key rename must keep its required setting and sort order`);
        }
        renames.push({ from: field.key, to: updated.key });
      }
    }
    const sourceKeys = new Set(renames.map((rename) => rename.from));
    if (renames.some((rename) => sourceKeys.has(rename.to))) {
      throw new ConflictException('A field key cannot be renamed to another existing field key in the same update');
    }
    const unsafeAddition = next.slice(existing.length).find((field) => field.required);
    if (unsafeAddition) throw new ConflictException(`New inventory field ${unsafeAddition.key} must be optional`);
    return renames;
  }

  private async renameInventoryFieldKeys(productId: Types.ObjectId, renames: FieldRename[], nextFields: ProductFieldDefinition[], actor: Types.ObjectId, session: ClientSession) {
    const items = await this.inventory.find({ productId, deletedAt: null }).select('+encryptedPayload +payloadHash').session(session).lean();
    const requiredSourceKeys = new Set(renames
      .filter((rename) => nextFields.find((field) => field.key === rename.to)?.required)
      .map((rename) => rename.from));
    const migrated = items.map((item) => {
      const payload = this.encryption.decrypt<Record<string, unknown>>(item.encryptedPayload);
      const missingRequiredKey = [...requiredSourceKeys].find((key) => !Object.hasOwn(payload, key));
      if (missingRequiredKey) throw new ConflictException(`Inventory payload is missing required field ${missingRequiredKey}; key rename is unsafe`);
      const renamedPayload = renamePayloadKeys(payload, renames);
      return { item, encryptedPayload: this.encryption.encrypt(renamedPayload), payloadHash: this.encryption.normalizedHash(renamedPayload),
        maskedPreview: createMaskedPreview(renamedPayload, nextFields) };
    });
    if (new Set(migrated.map((item) => item.payloadHash)).size !== migrated.length) {
      throw new ConflictException('Key mới làm trùng dữ liệu tồn kho; không thể đổi key này');
    }
    // payloadHash has a unique index. Assign transaction-local temporary hashes first so a new
    // hash can never collide with another row's old hash during the bulk rewrite.
    const migrationId = new Types.ObjectId().toString();
    const temporary = migrated.map(({ item }) => ({ id: item._id, hash: this.encryption.normalizedHash({ migrationId, id: item._id.toString() }) }));
    if (new Set(temporary.map((item) => item.hash)).size !== temporary.length) throw new ConflictException('Unable to prepare inventory key migration');
    for (let offset = 0; offset < temporary.length; offset += 500) {
      await this.inventory.bulkWrite(temporary.slice(offset, offset + 500).map(({ id, hash }) => ({ updateOne: {
        filter: { _id: id }, update: { $set: { payloadHash: hash } },
      } })), { ordered: true, session });
    }
    const operations = migrated.map(({ item, encryptedPayload, payloadHash, maskedPreview }) => {
      return { updateOne: { filter: { _id: item._id }, update: { $set: {
        encryptedPayload,
        payloadHash,
        maskedPreview,
        updatedBy: actor,
      } } } };
    });
    for (let offset = 0; offset < operations.length; offset += 500) {
      await this.inventory.bulkWrite(operations.slice(offset, offset + 500), { ordered: true, session });
    }
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

function parseInventoryPattern(pattern: string) {
  const parts = pattern.trim().split(/([^A-Za-z0-9_]+)/);
  const keys = parts.filter((_, index) => index % 2 === 0);
  const separators = parts.filter((_, index) => index % 2 === 1);
  if (!keys.length || keys.some((key) => !/^[a-z][a-zA-Z0-9_]{1,63}$/.test(key))) {
    throw new BadRequestException('Inventory pattern must use field keys, for example email----password');
  }
  if (separators.length && (separators.some((separator) => /\s/.test(separator)) || !separators.every((separator) => separator === separators[0]))) {
    throw new BadRequestException('Inventory pattern must use one non-space separator, for example email----password');
  }
  return keys;
}

function renameProductReferences(input: SaveProductDto, renames: FieldRename[]): SaveProductDto {
  if (!renames.length) return input;
  const byKey = new Map(renames.map((rename) => [rename.from, rename.to]));
  return {
    ...input,
    inventoryPattern: (input.inventoryPattern ?? '').replace(/[a-zA-Z][a-zA-Z0-9_]*/g, (key) => byKey.get(key) ?? key),
    deliveryTemplate: input.deliveryTemplate.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (whole, key: string) => {
      const replacement = byKey.get(key);
      return replacement ? `{{${replacement}}}` : whole;
    }),
  };
}

function renamePayloadKeys(payload: Record<string, unknown>, renames: FieldRename[]) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new ConflictException('Inventory payload cannot be migrated because it is not an object');
  }
  const original = { ...payload };
  const sourceKeys = new Set(renames.map((rename) => rename.from));
  for (const { from, to } of renames) {
    if (Object.hasOwn(original, to) && to !== from && !sourceKeys.has(to)) {
      throw new ConflictException(`Inventory payload already contains target field ${to}; key rename is unsafe`);
    }
  }
  const renamed = { ...original };
  for (const { from, to } of renames) if (from !== to && Object.hasOwn(original, from)) delete renamed[from];
  for (const { from, to } of renames) if (from !== to && Object.hasOwn(original, from)) renamed[to] = original[from];
  return renamed;
}
