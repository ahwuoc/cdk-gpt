import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { loadConfig } from '@store/config';
import { EncryptionService, createMaskedPreview } from '@store/encryption';
import { InventoryStatus, ProductStatus, UserStatus, inventorySearchValues } from '@store/shared';
import { AdminModel, InventoryItemModel, ProductModel, RoleModel, SettingModel, UserModel, WalletTransactionModel } from './schemas';

const config = loadConfig();
const encryption = EncryptionService.fromEnvironment();
await mongoose.connect(config.mongoUri, { autoIndex: config.nodeEnv !== 'production' });
try {
  const role = await RoleModel.findOneAndUpdate({ name: 'super-admin' }, {
    $setOnInsert: { name: 'super-admin', description: 'Full administrative access', permissions: ['*'], isSystem: true, deletedAt: null },
  }, { upsert: true, new: true, setDefaultsOnInsert: true });
  const password = process.env.SEED_ADMIN_PASSWORD ?? randomBytes(18).toString('base64url');
  const admin = await AdminModel.findOneAndUpdate({ email: process.env.SEED_ADMIN_EMAIL ?? 'admin@example.com' }, {
    $setOnInsert: {
      username: process.env.SEED_ADMIN_USERNAME ?? 'admin', email: process.env.SEED_ADMIN_EMAIL ?? 'admin@example.com',
      passwordHash: await bcrypt.hash(password, 12), roleIds: [role._id], status: 'ACTIVE', deletedAt: null,
    },
  }, { upsert: true, new: true, setDefaultsOnInsert: true }).select('+passwordHash');
  const user = await UserModel.findOneAndUpdate({ telegramId: process.env.SEED_USER_TELEGRAM_ID ?? '100000001' }, {
    $setOnInsert: { telegramId: process.env.SEED_USER_TELEGRAM_ID ?? '100000001', displayName: 'Demo User', status: UserStatus.ACTIVE, walletBalance: 0, referralCode: 'DEMOUSER', deletedAt: null },
  }, { upsert: true, new: true, setDefaultsOnInsert: true });
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      if (await WalletTransactionModel.exists({ idempotencyKey: 'seed:demo-wallet:v1' }).session(session)) return;
      const before = await UserModel.findById(user._id).session(session);
      if (!before) throw new Error('Seed user disappeared');
      if (before.walletBalance !== 0) throw new Error('Refusing seed credit: demo wallet is non-zero but has no seed ledger entry');
      const amount = 100_000;
      const after = await UserModel.findByIdAndUpdate(user._id, { $inc: { walletBalance: amount } }, { new: true, session });
      if (!after) throw new Error('Seed wallet credit failed');
      await WalletTransactionModel.create([{ userId: user._id, balanceBefore: before.walletBalance,
        balanceAfter: after.walletBalance, amount, type: 'ADMIN_CREDIT', reason: 'Initial development seed credit',
        referenceType: 'USER', referenceId: user._id, idempotencyKey: 'seed:demo-wallet:v1',
        actorType: 'ADMIN', actorId: admin._id, metadata: { seedVersion: 1 } }], { session });
    });
  } finally { await session.endSession(); }
  const fields = [
    { name: 'Login', key: 'login', type: 'EMAIL', sensitive: false, visibleToCustomer: true, required: true, sortOrder: 1 },
    { name: 'Password', key: 'password', type: 'STRING', sensitive: true, visibleToCustomer: true, required: true, sortOrder: 2 },
  ] as const;
  const product = await ProductModel.findOneAndUpdate({ slug: 'demo-digital-product' }, { $setOnInsert: {
    name: 'Demo Digital Product', slug: 'demo-digital-product', description: 'Development-only transferable test inventory',
    price: 10_000, status: ProductStatus.ACTIVE, imageUrls: [], instructions: 'Use only in development.', warrantyDays: 7,
    deliveryTemplate: 'Login: {{login}}\nPassword: {{password}}', fieldDefinitions: fields, purchaseLimitPerUser: 0,
    lowStockThreshold: 2, sortOrder: 1, createdBy: admin._id, updatedBy: admin._id, deletedAt: null,
  } }, { upsert: true, new: true, setDefaultsOnInsert: true });
  for (let index = 1; index <= 3; index++) {
    const payload = { login: `demo${index}@example.invalid`, password: `development-${index}` };
    const maskedPreview = createMaskedPreview(payload, fields);
    await InventoryItemModel.updateOne({ productId: product._id, payloadHash: encryption.normalizedHash(payload) }, {
      $setOnInsert: { productId: product._id, encryptedPayload: encryption.encrypt(payload), maskedPreview,
        searchValues: inventorySearchValues(maskedPreview),
        payloadHash: encryption.normalizedHash(payload), status: InventoryStatus.AVAILABLE, createdBy: admin._id, deletedAt: null },
    }, { upsert: true });
  }
  await SettingModel.findOneAndUpdate({ key: 'shop.name' }, { $set: { value: config.shopName, public: true, updatedBy: admin._id } }, { upsert: true });
  console.log(`Seed complete. Demo user ${user.telegramId}. Admin ${admin.email}.`);
  if (!process.env.SEED_ADMIN_PASSWORD) console.log(`Generated one-time development admin password: ${password}`);
} finally { await mongoose.disconnect(); }
