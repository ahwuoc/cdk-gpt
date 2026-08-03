import { Schema, model, models } from 'mongoose';
import type { HydratedDocument, Model } from 'mongoose';
import { baseSchemaOptions, softDelete } from './common';

export interface Role {
  name: string; description?: string; permissions: string[]; isSystem: boolean;
  createdAt: Date; updatedAt: Date; deletedAt: Date | null;
}
export type RoleDocument = HydratedDocument<Role>;
export const RoleSchema = new Schema<Role>({
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 64 },
  description: { type: String, trim: true, maxlength: 500 },
  permissions: [{ type: String, required: true, trim: true, maxlength: 100 }],
  isSystem: { type: Boolean, default: false }, deletedAt: softDelete,
}, baseSchemaOptions);
RoleSchema.index({ name: 1 }, { unique: true, partialFilterExpression: { deletedAt: null } });
export const RoleModel: Model<Role> = (models.Role as Model<Role> | undefined) ?? model<Role>('Role', RoleSchema, 'roles');
