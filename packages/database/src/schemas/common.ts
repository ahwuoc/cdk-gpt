import { Schema } from 'mongoose';
import type { Types } from 'mongoose';

export const objectId = (ref?: string, required = false) => ({
  type: Schema.Types.ObjectId, ...(ref ? { ref } : {}), required,
});

export const softDelete = { type: Date, default: null, index: true };
export const metadata = { type: Schema.Types.Mixed, default: () => ({}) };

export type ObjectIdLike = Types.ObjectId | string;

export const baseSchemaOptions = {
  timestamps: true,
  versionKey: '__v',
  optimisticConcurrency: true,
  minimize: false,
} as const;
