import { DynamicModule, Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import * as schemas from './schemas';
import { InventoryRepository, OrderRepository, UserRepository, WalletTransactionRepository } from './repositories';

const models = [
  ['Admin', schemas.AdminSchema], ['AuditLog', schemas.AuditLogSchema], ['ImportBatch', schemas.ImportBatchSchema],
  ['InventoryItem', schemas.InventoryItemSchema], ['Notification', schemas.NotificationSchema], ['Order', schemas.OrderSchema],
  ['PaymentRequest', schemas.PaymentRequestSchema], ['Product', schemas.ProductSchema], ['Referral', schemas.ReferralSchema],
  ['RefreshToken', schemas.RefreshTokenSchema], ['Role', schemas.RoleSchema], ['Setting', schemas.SettingSchema],
  ['SupportTicket', schemas.SupportTicketSchema], ['User', schemas.UserSchema], ['WalletTransaction', schemas.WalletTransactionSchema],
  ['WarrantyRequest', schemas.WarrantyRequestSchema],
].map(([name, schema]) => ({ name: name as string, schema: schema as never }));

const repositories = [InventoryRepository, OrderRepository, UserRepository, WalletTransactionRepository];

@Global()
@Module({})
export class DatabaseModule {
  static forRoot(uri: string, autoIndex = process.env.NODE_ENV !== 'production'): DynamicModule {
    return {
      module: DatabaseModule,
      imports: [MongooseModule.forRoot(uri, { autoIndex }), MongooseModule.forFeature(models)],
      providers: repositories, exports: [MongooseModule, ...repositories],
    };
  }
}
