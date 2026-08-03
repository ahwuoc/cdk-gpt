import { Schema, model, models } from 'mongoose';
import type { HydratedDocument, Types, Model } from 'mongoose';
import { baseSchemaOptions, metadata, objectId } from './common';

export interface Setting {
  key: string; value: unknown; description?: string; public: boolean; updatedBy: Types.ObjectId;
  createdAt: Date; updatedAt: Date;
}
export const SettingSchema = new Schema<Setting>({
  key: { type: String, required: true, trim: true, lowercase: true, match: /^[a-z][a-z0-9_.-]{1,99}$/ },
  value: metadata, description: { type: String, maxlength: 1000 }, public: { type: Boolean, default: false },
  updatedBy: objectId('Admin', true),
}, baseSchemaOptions);
SettingSchema.index({ key: 1 }, { unique: true });
SettingSchema.index({ public: 1, key: 1 });
export const SettingModel: Model<Setting> = (models.Setting as Model<Setting> | undefined) ?? model<Setting>('Setting', SettingSchema, 'settings');
