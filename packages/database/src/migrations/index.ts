import type { MongoMigration } from './types';
import { createIndexesMigration } from './001-create-indexes';
import { backfillSafeDefaultsMigration } from './002-backfill-safe-defaults';
import { categoryProductIndexesMigration } from './003-category-product-indexes';
import { repairLegacyCollectionNamesMigration } from './004-repair-legacy-collection-names';
import { serverlessRuntimeIndexesMigration } from './005-serverless-runtime-indexes';
import { orderReportIndexesMigration } from './006-order-report-indexes';
import { quickCheckoutReservationsMigration } from './007-quick-checkout-reservations';

export const migrations: MongoMigration[] = [createIndexesMigration, backfillSafeDefaultsMigration, categoryProductIndexesMigration,
  repairLegacyCollectionNamesMigration, serverlessRuntimeIndexesMigration, orderReportIndexesMigration,
  quickCheckoutReservationsMigration];
export type { MongoMigration } from './types';
