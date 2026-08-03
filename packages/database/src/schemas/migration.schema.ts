import { Schema, model, models } from 'mongoose';
import type { Model } from 'mongoose';

export interface MigrationRecord { name: string; appliedAt: Date; checksum: string; executionMs: number; }
export const MigrationRecordSchema = new Schema<MigrationRecord>({
  name: { type: String, required: true }, appliedAt: { type: Date, default: Date.now, required: true },
  checksum: { type: String, required: true }, executionMs: { type: Number, required: true, min: 0 },
}, { versionKey: false });
MigrationRecordSchema.index({ name: 1 }, { unique: true });
export const MigrationRecordModel: Model<MigrationRecord> = (models.MigrationRecord as Model<MigrationRecord> | undefined) ?? model<MigrationRecord>('MigrationRecord', MigrationRecordSchema, 'schema_migrations');
