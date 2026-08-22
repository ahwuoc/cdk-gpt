import { DynamicModule, Global, Module } from '@nestjs/common';
import { MongooseModule, getConnectionToken, getModelToken } from '@nestjs/mongoose';
import type { ModelDefinition } from '@nestjs/mongoose';
import mongoose from 'mongoose';
import type { Connection } from 'mongoose';
import { isServerlessRuntime, loadConfig } from '@store/config';
import * as schemas from './schemas';
import { InventoryRepository, OrderRepository, UserRepository, WalletTransactionRepository } from './repositories';

// Nest's Mongoose integration otherwise pluralizes model names (for example, InventoryItem becomes
// `inventoryitems`). The exported database models use the explicit canonical collection names below,
// so both access paths must share this single mapping.
const models: ModelDefinition[] = [
  { name: 'Admin', schema: schemas.AdminSchema, collection: 'admins' },
  { name: 'AuditLog', schema: schemas.AuditLogSchema, collection: 'audit_logs' },
  { name: 'BotSession', schema: schemas.BotSessionSchema, collection: 'bot_sessions' },
  { name: 'Category', schema: schemas.CategorySchema, collection: 'categories' },
  { name: 'ImportBatch', schema: schemas.ImportBatchSchema, collection: 'import_batches' },
  { name: 'InventoryItem', schema: schemas.InventoryItemSchema, collection: 'inventory_items' },
  { name: 'Notification', schema: schemas.NotificationSchema, collection: 'notifications' },
  { name: 'Order', schema: schemas.OrderSchema, collection: 'orders' },
  { name: 'PaymentRequest', schema: schemas.PaymentRequestSchema, collection: 'payment_requests' },
  { name: 'Product', schema: schemas.ProductSchema, collection: 'products' },
  { name: 'Referral', schema: schemas.ReferralSchema, collection: 'referrals' },
  { name: 'RefreshToken', schema: schemas.RefreshTokenSchema, collection: 'refresh_tokens' },
  { name: 'Role', schema: schemas.RoleSchema, collection: 'roles' },
  { name: 'RuntimeLease', schema: schemas.RuntimeLeaseSchema, collection: 'runtime_leases' },
  { name: 'Setting', schema: schemas.SettingSchema, collection: 'settings' },
  { name: 'SupportTicket', schema: schemas.SupportTicketSchema, collection: 'support_tickets' },
  { name: 'User', schema: schemas.UserSchema, collection: 'users' },
  { name: 'WalletTransaction', schema: schemas.WalletTransactionSchema, collection: 'wallet_transactions' },
  { name: 'WarrantyRequest', schema: schemas.WarrantyRequestSchema, collection: 'warranty_requests' },
];

const repositories = [InventoryRepository, OrderRepository, UserRepository, WalletTransactionRepository];

declare global {
  // A Vercel isolate can evaluate server-only chunks more than once. Keep the
  // Mongo connection promise on globalThis rather than one module instance.
  var __digitalStoreServerlessMongoose: Promise<Connection> | undefined;
}

/**
 * Serverless bot/task code intentionally uses the exported static Mongoose
 * models. Those models are attached to `mongoose.connection`, whereas Nest's
 * normal `MongooseModule.forRoot()` creates a separate connection. Reusing the
 * default connection in this mode keeps injected API models and static bot
 * models on the exact same Atlas pool/database.
 */
async function connectServerlessDefault(uri: string, autoIndex: boolean, maxPoolSize: number): Promise<Connection> {
  if (mongoose.connection.readyState === 1) return mongoose.connection;
  if (mongoose.connection.readyState === 2) return globalThis.__digitalStoreServerlessMongoose ?? mongoose.connection.asPromise();
  if (mongoose.connection.readyState === 3) await mongoose.disconnect();
  // An explicit shutdown leaves a resolved promise behind; never return that
  // disconnected connection to a later warm invocation/test.
  globalThis.__digitalStoreServerlessMongoose = undefined;
  globalThis.__digitalStoreServerlessMongoose = mongoose.connect(uri, {
    autoIndex,
    maxPoolSize,
    minPoolSize: 0,
    serverSelectionTimeoutMS: 10_000,
    maxIdleTimeMS: 60_000,
  }).then((instance) => instance.connection).catch((error) => {
    globalThis.__digitalStoreServerlessMongoose = undefined;
    throw error;
  });
  return globalThis.__digitalStoreServerlessMongoose;
}

@Global()
@Module({})
export class DatabaseModule {
  static forRoot(uri?: string, autoIndex?: boolean): DynamicModule {
    const serverless = isServerlessRuntime();
    if (serverless) {
      const connectionToken = getConnectionToken();
      const connectionProvider = {
        provide: connectionToken,
        // Resolve secrets only when Nest starts handling a request. Next.js
        // imports Route Handlers while collecting build metadata, where
        // runtime-only Vercel secrets do not need to be present yet.
        useFactory: () => {
          const config = loadConfig();
          return connectServerlessDefault(uri ?? config.mongoUri,
            autoIndex ?? config.nodeEnv !== 'production', config.mongoMaxPoolSize);
        },
      };
      // Equivalent to MongooseModule.forFeature(models), but the connection is
      // the global default one used by Telegraf/QStash processors as well.
      const modelProviders = models.map((definition) => ({
        provide: getModelToken(definition.name),
        useFactory: (connection: Connection) => connection.models[definition.name]
          ?? connection.model(definition.name, definition.schema, definition.collection),
        inject: [connectionToken],
      }));
      return {
        module: DatabaseModule,
        providers: [connectionProvider, ...modelProviders, ...repositories],
        exports: [connectionProvider, ...modelProviders, ...repositories],
      };
    }
    return {
      module: DatabaseModule,
      // Docker/VPS keeps Nest's normal dedicated connection and BullMQ worker
      // model. Serverless takes the shared-default branch above.
      imports: [MongooseModule.forRootAsync({ useFactory: () => {
        const config = loadConfig();
        return {
          uri: uri ?? config.mongoUri,
          autoIndex: autoIndex ?? config.nodeEnv !== 'production',
          maxPoolSize: config.mongoMaxPoolSize,
          minPoolSize: 0,
          serverSelectionTimeoutMS: 10_000,
        };
      } }), MongooseModule.forFeature(models)],
      providers: repositories, exports: [MongooseModule, ...repositories],
    };
  }
}
