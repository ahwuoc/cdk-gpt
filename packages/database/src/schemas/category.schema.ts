import { Schema, model, models } from 'mongoose';
import type { HydratedDocument, Model, Types } from 'mongoose';
import { baseSchemaOptions, objectId, softDelete } from './common';

export interface Category {
  name: string; slug: string; description?: string; sortOrder: number;
  createdBy: Types.ObjectId; updatedBy: Types.ObjectId; createdAt: Date; updatedAt: Date; deletedAt: Date | null;
}
export type CategoryDocument = HydratedDocument<Category>;

export const CategorySchema = new Schema<Category>({
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 120 },
  slug: { type: String, required: true, lowercase: true, trim: true, match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/ },
  description: { type: String, trim: true, maxlength: 1000 },
  sortOrder: { type: Number, default: 0, validate: Number.isSafeInteger },
  createdBy: objectId('Admin', true), updatedBy: objectId('Admin', true), deletedAt: softDelete,
}, baseSchemaOptions);
CategorySchema.index({ slug: 1 }, { unique: true, partialFilterExpression: { deletedAt: null } });
CategorySchema.index({ sortOrder: 1, createdAt: -1, _id: 1 });
CategorySchema.index({ name: 'text', description: 'text' });

export const CategoryModel: Model<Category> = (models.Category as Model<Category> | undefined) ??
  model<Category>('Category', CategorySchema, 'categories');
