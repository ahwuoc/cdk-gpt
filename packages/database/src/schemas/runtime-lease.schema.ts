import { Schema, model, models } from 'mongoose';
import type { HydratedDocument, Model } from 'mongoose';

/** Cross-instance lease used only for short serverless scheduled work. */
export interface RuntimeLease {
  _id: string;
  token: string;
  expiresAt: Date;
  updatedAt: Date;
}

export type RuntimeLeaseDocument = HydratedDocument<RuntimeLease>;

export const RuntimeLeaseSchema = new Schema<RuntimeLease>({
  // A string _id gives MongoDB an always-present atomic uniqueness constraint
  // without relying on autoIndex during a production Vercel deployment.
  _id: { type: String, required: true, maxlength: 100 },
  token: { type: String, required: true, maxlength: 100 },
  expiresAt: { type: Date, required: true },
}, { timestamps: { createdAt: false, updatedAt: true }, versionKey: false });

export const RuntimeLeaseModel: Model<RuntimeLease> = (models.RuntimeLease as Model<RuntimeLease> | undefined)
  ?? model<RuntimeLease>('RuntimeLease', RuntimeLeaseSchema, 'runtime_leases');
