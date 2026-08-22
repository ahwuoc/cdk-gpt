import type { MongoMigration } from './types';
import { createIndexesMigration } from './001-create-indexes';
import { backfillSafeDefaultsMigration } from './002-backfill-safe-defaults';
import { categoryProductIndexesMigration } from './003-category-product-indexes';
import { repairLegacyCollectionNamesMigration } from './004-repair-legacy-collection-names';
import { serverlessRuntimeIndexesMigration } from './005-serverless-runtime-indexes';

export const migrations: MongoMigration[] = [createIndexesMigration, backfillSafeDefaultsMigration, categoryProductIndexesMigration,
  repairLegacyCollectionNamesMigration, serverlessRuntimeIndexesMigration];
export type { MongoMigration } from './types';
