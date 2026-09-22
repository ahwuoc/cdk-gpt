import type { MongoMigration } from './types';
import { createIndexesMigration } from './001-create-indexes';
import { backfillSafeDefaultsMigration } from './002-backfill-safe-defaults';
import { categoryProductIndexesMigration } from './003-category-product-indexes';
import { repairLegacyCollectionNamesMigration } from './004-repair-legacy-collection-names';
import { serverlessRuntimeIndexesMigration } from './005-serverless-runtime-indexes';
import { orderReportIndexesMigration } from './006-order-report-indexes';
import { quickCheckoutReservationsMigration } from './007-quick-checkout-reservations';
import { customerMessageIndexesMigration } from './008-customer-message-indexes';
import { couponIndexesMigration } from './009-coupon-indexes';
import { customerAnalyticsIndexesMigration } from './010-customer-analytics-indexes';
import { adminHistoryIndexesMigration } from './011-admin-history-indexes';
import { operationalQueryIndexesMigration } from './012-operational-query-indexes';
import { messageQueryIndexesMigration } from './014-message-query-indexes';
import { inventorySearchMigration } from './013-inventory-search';

export const migrations: MongoMigration[] = [createIndexesMigration, backfillSafeDefaultsMigration, categoryProductIndexesMigration,
  repairLegacyCollectionNamesMigration, serverlessRuntimeIndexesMigration, orderReportIndexesMigration,
  quickCheckoutReservationsMigration, customerMessageIndexesMigration, couponIndexesMigration, customerAnalyticsIndexesMigration,
  adminHistoryIndexesMigration, operationalQueryIndexesMigration, inventorySearchMigration, messageQueryIndexesMigration];
export type { MongoMigration } from './types';
