import type { MongoMigration } from './types';
import { createIndexesMigration } from './001-create-indexes';
import { backfillSafeDefaultsMigration } from './002-backfill-safe-defaults';

export const migrations: MongoMigration[] = [createIndexesMigration, backfillSafeDefaultsMigration];
export type { MongoMigration } from './types';
