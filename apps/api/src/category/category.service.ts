import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { ClientSession, Connection, Model } from 'mongoose';
import type { AuditLog, Category, CategoryDocument, Product } from '@store/database';
import { isMongoDuplicateKey } from '@store/shared';
import type { CategoryQueryDto, SaveCategoryDto } from './category.dto';

@Injectable()
export class CategoryService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel('Category') private readonly categories: Model<Category>,
    @InjectModel('Product') private readonly products: Model<Product>,
    @InjectModel('AuditLog') private readonly audits: Model<AuditLog>,
  ) {}

  async list(query?: CategoryQueryDto) {
    const page = query?.page ?? 1;
    const limit = query?.limit ?? 50;
    const filter: Record<string, unknown> = { deletedAt: null };
    const search = query?.search?.trim();
    if (search) filter.$text = { $search: search };
    const [items, total] = await Promise.all([
      this.categories.find(filter).sort({ sortOrder: 1, createdAt: -1, _id: 1 }).skip((page - 1) * limit).limit(limit).lean(),
      this.categories.countDocuments(filter),
    ]);
    return { items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  async create(input: SaveCategoryDto, adminId: string, requestId?: string) {
    const actor = this.objectId(adminId);
    const session = await this.connection.startSession(); let category: CategoryDocument | undefined;
    try {
      await session.withTransaction(async () => {
        [category] = await this.categories.create([{ ...input, createdBy: actor, updatedBy: actor, deletedAt: null }], { session });
        await this.audit(actor, 'CATEGORY_CREATED', category._id, requestId, { slug: category.slug }, session);
      });
      if (!category) throw new Error('Category transaction did not create a category');
      return category;
    } catch (error) {
      if (isMongoDuplicateKey(error)) throw new ConflictException('A category with this slug already exists');
      throw error;
    } finally { await session.endSession(); }
  }

  async update(id: string, input: SaveCategoryDto, adminId: string, requestId?: string) {
    const categoryId = this.objectId(id);
    const actor = this.objectId(adminId);
    const session = await this.connection.startSession();
    try {
      let category: Category | null | undefined;
      await session.withTransaction(async () => {
        category = await this.categories.findOneAndUpdate({ _id: categoryId, deletedAt: null },
          { $set: { ...input, updatedBy: actor } }, { new: true, runValidators: true, session }).lean();
        if (!category) throw new NotFoundException('Category not found');
        await this.audit(actor, 'CATEGORY_UPDATED', categoryId, requestId, { slug: category.slug }, session);
      });
      if (!category) throw new Error('Category transaction did not update a category');
      return category;
    } catch (error) {
      if (isMongoDuplicateKey(error)) throw new ConflictException('A category with this slug already exists');
      throw error;
    } finally { await session.endSession(); }
  }

  async archive(id: string, adminId: string, requestId?: string) {
    const categoryId = this.objectId(id);
    const actor = this.objectId(adminId);
    const session = await this.connection.startSession();
    try {
      let category: Category | null | undefined;
      await session.withTransaction(async () => {
        if (await this.products.exists({ categoryId, deletedAt: null }).session(session)) {
          throw new ConflictException('Move products out of this category before archiving it');
        }
        category = await this.categories.findOneAndUpdate({ _id: categoryId, deletedAt: null },
          { $set: { deletedAt: new Date(), updatedBy: actor } }, { new: true, session }).lean();
        if (!category) throw new NotFoundException('Category not found');
        await this.audit(actor, 'CATEGORY_ARCHIVED', categoryId, requestId, { slug: category.slug }, session);
      });
      return { archived: true, id: categoryId };
    } finally { await session.endSession(); }
  }

  private objectId(value: string) {
    if (!Types.ObjectId.isValid(value)) throw new BadRequestException('Invalid category identifier');
    return new Types.ObjectId(value);
  }

  private audit(actorId: Types.ObjectId, action: string, resourceId: Types.ObjectId, requestId: string | undefined,
    metadata: Record<string, unknown>, session: ClientSession) {
    return this.audits.create([{ actorType: 'ADMIN', actorId, action, resourceType: 'Category', resourceId, requestId, metadata }], { session });
  }
}
