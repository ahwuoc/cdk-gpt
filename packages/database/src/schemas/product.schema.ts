import { Schema, model, models } from 'mongoose';
import type { HydratedDocument, Types, Model } from 'mongoose';
import { ProductStatus } from '@store/shared';
import { baseSchemaOptions, objectId, softDelete } from './common';

export const ProductFieldType = { STRING: 'STRING', NUMBER: 'NUMBER', BOOLEAN: 'BOOLEAN', EMAIL: 'EMAIL', URL: 'URL' } as const;
export interface ProductFieldDefinition {
  name: string; key: string; type: typeof ProductFieldType[keyof typeof ProductFieldType]; sensitive: boolean;
  visibleToCustomer: boolean; required: boolean; sortOrder: number;
}
export interface Product {
  name: string; slug: string; description: string; price: number;
  categoryId?: Types.ObjectId;
  status: typeof ProductStatus[keyof typeof ProductStatus]; imageUrls: string[]; instructions?: string;
  warrantyPolicy?: string; warrantyDays: number; deliveryTemplate: string; fieldDefinitions: ProductFieldDefinition[];
  /** Column keys and separator used by the one-line inventory importer, e.g. email----password. */
  inventoryPattern?: string;
  purchaseLimitPerUser: number; lowStockThreshold: number; sortOrder: number;
  createdBy: Types.ObjectId; updatedBy: Types.ObjectId; createdAt: Date; updatedAt: Date; deletedAt: Date | null;
}
export type ProductDocument = HydratedDocument<Product>;
const ProductFieldDefinitionSchema = new Schema<ProductFieldDefinition>({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  key: { type: String, required: true, trim: true, match: /^[a-z][a-zA-Z0-9_]{1,63}$/ },
  type: { type: String, enum: Object.values(ProductFieldType), required: true },
  sensitive: { type: Boolean, default: true }, visibleToCustomer: { type: Boolean, default: true },
  required: { type: Boolean, default: true }, sortOrder: { type: Number, default: 0, validate: Number.isSafeInteger },
}, { _id: false });
export const ProductSchema = new Schema<Product>({
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 200 },
  slug: { type: String, required: true, lowercase: true, trim: true, match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/ },
  description: { type: String, required: true, maxlength: 10_000 },
  price: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  status: { type: String, enum: Object.values(ProductStatus), default: ProductStatus.DRAFT, required: true },
  categoryId: objectId('Category'),
  imageUrls: [{ type: String, trim: true, maxlength: 2048 }], instructions: { type: String, maxlength: 20_000 },
  warrantyPolicy: { type: String, maxlength: 20_000 },
  warrantyDays: { type: Number, min: 0, max: 3650, default: 0, validate: Number.isSafeInteger },
  deliveryTemplate: { type: String, required: true, maxlength: 20_000, default: '{{payload}}' },
  fieldDefinitions: { type: [ProductFieldDefinitionSchema], default: [] },
  inventoryPattern: { type: String, trim: true, maxlength: 500 },
  purchaseLimitPerUser: { type: Number, min: 0, default: 0, validate: Number.isSafeInteger },
  lowStockThreshold: { type: Number, min: 0, default: 5, validate: Number.isSafeInteger },
  sortOrder: { type: Number, default: 0, validate: Number.isSafeInteger },
  createdBy: objectId('Admin', true), updatedBy: objectId('Admin', true), deletedAt: softDelete,
}, baseSchemaOptions);
ProductSchema.path('fieldDefinitions').validate((fields: ProductFieldDefinition[]) => new Set(fields.map((f) => f.key)).size === fields.length, 'field keys must be unique');
ProductSchema.index({ slug: 1 }, { unique: true, partialFilterExpression: { deletedAt: null } });
ProductSchema.index({ status: 1, sortOrder: 1, createdAt: -1 });
ProductSchema.index({ categoryId: 1, status: 1, sortOrder: 1, createdAt: -1 });
ProductSchema.index({ name: 'text', description: 'text' });
export const ProductModel: Model<Product> = (models.Product as Model<Product> | undefined) ?? model<Product>('Product', ProductSchema, 'products');
