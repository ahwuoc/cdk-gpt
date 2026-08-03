import { Schema, model, models } from 'mongoose';
import type { HydratedDocument, Types, Model } from 'mongoose';
import { baseSchemaOptions, objectId } from './common';

export const ImportBatchStatus = { PREVIEWED: 'PREVIEWED', PROCESSING: 'PROCESSING', COMPLETED: 'COMPLETED', PARTIAL: 'PARTIAL', FAILED: 'FAILED' } as const;
export interface ImportBatch {
  productId: Types.ObjectId; createdBy: Types.ObjectId; status: typeof ImportBatchStatus[keyof typeof ImportBatchStatus];
  totalRows: number; validRows: number; invalidRows: number; duplicateRows: number; importedRows: number;
  sourceName?: string; rowErrors: Array<{ line: number; reason: string }>; createdAt: Date; updatedAt: Date;
}
const integerCount = { type: Number, min: 0, default: 0, validate: Number.isSafeInteger };
export const ImportBatchSchema = new Schema<ImportBatch>({
  productId: objectId('Product', true), createdBy: objectId('Admin', true),
  status: { type: String, enum: Object.values(ImportBatchStatus), default: ImportBatchStatus.PREVIEWED },
  totalRows: integerCount, validRows: integerCount, invalidRows: integerCount,
  duplicateRows: integerCount, importedRows: integerCount, sourceName: { type: String, maxlength: 255 },
  rowErrors: [{ _id: false, line: { type: Number, min: 1, required: true }, reason: { type: String, maxlength: 1000, required: true } }],
}, baseSchemaOptions);
ImportBatchSchema.index({ productId: 1, createdAt: -1 });
ImportBatchSchema.index({ createdBy: 1, createdAt: -1 });
ImportBatchSchema.index({ status: 1, createdAt: 1 });
export const ImportBatchModel: Model<ImportBatch> = (models.ImportBatch as Model<ImportBatch> | undefined) ?? model<ImportBatch>('ImportBatch', ImportBatchSchema, 'import_batches');
