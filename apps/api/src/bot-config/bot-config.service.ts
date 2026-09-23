import { BadRequestException, ConflictException, Inject, Injectable, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { Telegram } from 'telegraf';
import { EncryptionService } from '@store/encryption';
import { isServerlessRuntime } from '@store/config';
import { type AuditLog, type RuntimeLease, type Setting } from '@store/database';
import { isMongoDuplicateKey } from '@store/shared';
import type { UpdateBankConfigDto, UpdateRuntimeConfigDto } from './bot-config.dto';
import { deriveTelegramWebhookSecret, isTelegramWebhookSecretSeed } from './telegram-webhook-secret';

export interface VerifiedTelegramBot { id: number; username?: string; first_name: string; }
export interface RuntimeBankConfig {
  id: string;
  label: string;
  provider: BankHistoryProvider;
  token: string;
  bankId: string;
  accountNo: string;
  template: string;
  accountName: string;
}
export type BankHistoryProvider = 'CAKE_V2' | 'BIDV_V4';
export type BotTokenVerifier = (token: string) => Promise<VerifiedTelegramBot>;
export const BOT_TOKEN_VERIFIER = Symbol('BOT_TOKEN_VERIFIER');

interface StoredBotToken {
  encryptedToken: string;
  encryptionKeyVersion: number;
  lastFour: string;
  botId: number;
  botUsername?: string;
}

interface ServerlessWebhookConfig {
  webhookUrl: string;
  secretSeed: string;
}

interface StoredBankConfig {
  encryptedToken?: string;
  encryptionKeyVersion?: number;
  lastFour?: string;
  bankId: string;
  accountNo: string;
  template: string;
  accountName: string;
  amount: number;
  description: string;
}

interface StoredBankAccount extends StoredBankConfig {
  id: string;
  label: string;
  provider: BankHistoryProvider | 'BIDV_V2';
  archivedAt?: string;
}

interface StoredBankCollection {
  version: 2;
  activeBankId: string;
  banks: StoredBankAccount[];
}

interface StoredOperationalConfig {
  shopName: string;
  adminTelegramIds: string[];
  apiUrl: string;
  telegramWebhookUrl: string;
  qstashUrl: string;
  taskBaseUrl: string;
  encryptedQstashToken?: string;
  qstashTokenLastFour?: string;
  encryptionKeyVersion?: number;
}

export interface RuntimeOperationalConfig {
  shopName: string;
  adminTelegramIds: string[];
  apiUrl: string;
  telegramWebhookUrl: string;
  qstashUrl: string;
  taskBaseUrl: string;
  qstashToken: string;
  source: 'database' | 'environment' | 'none';
  qstashTokenLastFour?: string;
}

export interface RuntimeBotToken {
  token: string;
  source: 'database' | 'environment';
}

const BOT_TOKEN_UPDATE_LEASE_MS = 75_000;
const BANK_CONFIG_UPDATE_LEASE_MS = 15_000;
const LEGACY_BANK_CONFIG_ID = 'legacy';
const ENVIRONMENT_BANK_CONFIG_ID = 'environment';

@Injectable()
export class BotConfigService {
  private readonly encryption = EncryptionService.fromEnvironment();
  constructor(
    @InjectModel('Setting') private readonly settings: Model<Setting>,
    @InjectModel('AuditLog') private readonly audits: Model<AuditLog>,
    @Inject(BOT_TOKEN_VERIFIER) private readonly verifyToken: BotTokenVerifier,
    @Optional() @InjectModel('RuntimeLease') private readonly leases?: Model<RuntimeLease>,
  ) {}

  async getPublicConfig() {
    const [setting, welcomeSetting, bankSetting, runtimeSetting] = await Promise.all([
      this.settings.findOne({ key: 'telegram.bot_token' }).select('value updatedAt').lean(),
      this.settings.findOne({ key: 'shop.welcome_message' }).select('value updatedAt').lean(),
      this.settings.findOne({ key: 'bank.api_config' }).select('value updatedAt').lean(),
      this.settings.findOne({ key: 'runtime.operational_config' }).select('value updatedAt').lean(),
    ]);
    const welcomeMessage = typeof welcomeSetting?.value === 'string' ? welcomeSetting.value : defaultWelcomeMessage();
    const runtime = publicOperationalConfig(runtimeSetting?.value, runtimeSetting?.updatedAt);
    const bankState = publicBankConfigState(bankSetting?.value, bankSetting?.updatedAt);
    if (!setting) {
      const environmentToken = process.env.BOT_TOKEN;
      return { configured: Boolean(environmentToken), source: environmentToken ? 'environment' : 'none',
        maskedToken: environmentToken ? `••••••••${environmentToken.slice(-4)}` : undefined,
        welcomeMessage, bank: bankState.bank, banks: bankState.banks, activeBankId: bankState.activeBankId, runtime,
        reloadWithinSeconds: botConfigPollSeconds() };
    }
    const value = setting.value as StoredBotToken;
    return { configured: true, source: 'database', botId: value.botId, botUsername: value.botUsername,
      maskedToken: `••••••••${value.lastFour}`, encryptionKeyVersion: value.encryptionKeyVersion,
      updatedAt: setting.updatedAt, welcomeMessage, bank: bankState.bank, banks: bankState.banks,
      activeBankId: bankState.activeBankId, runtime,
      reloadWithinSeconds: botConfigPollSeconds() };
  }

  async listBanks() {
    const response = await fetch('https://api.vietqr.io/v2/banks');
    if (!response.ok) throw new BadRequestException('Không thể tải danh sách ngân hàng VietQR');
    const body = await response.json() as { code?: string; data?: Array<{ name?: string; code?: string; bin?: string; shortName?: string }> };
    if (!Array.isArray(body.data)) throw new BadRequestException('Danh sách ngân hàng VietQR không hợp lệ');
    return body.data.filter((bank) => bank.code && bank.bin).map((bank) => ({
      name: bank.name ?? bank.shortName ?? bank.code, code: bank.code, bin: bank.bin, shortName: bank.shortName ?? bank.code,
    }));
  }

  /** Shared secret used by a bank callback. With no id this resolves the one active account. */
  async getBankApiTokenForRuntime(id?: string): Promise<string | undefined> {
    return (await this.getBankConfigForRuntime(id))?.token;
  }

  /** Resolve the active account, or the exact account pinned to an older pending payment. */
  async getBankConfigForRuntime(id?: string): Promise<RuntimeBankConfig | undefined> {
    const setting = await this.settings.findOne({ key: 'bank.api_config' }).select('value').lean();
    const collection = storedBankCollection(setting?.value);
    if (collection) {
      const selectedId = id || collection.activeBankId;
      const selected = collection.banks.find((bank) => bank.id === selectedId);
      return selected ? this.runtimeBankConfig(selected) : undefined;
    }
    const environment = environmentBankConfig();
    if (!environment || (id && id !== ENVIRONMENT_BANK_CONFIG_ID)) return undefined;
    return environment;
  }

  /** Retained/archived accounts are included so callbacks and polls for old QR codes keep working. */
  async getBankConfigsForRuntime(): Promise<RuntimeBankConfig[]> {
    const setting = await this.settings.findOne({ key: 'bank.api_config' }).select('value').lean();
    const collection = storedBankCollection(setting?.value);
    if (!collection) return environmentBankConfig() ? [environmentBankConfig()!] : [];
    const configs = await Promise.all(collection.banks.map((bank) => this.runtimeBankConfig(bank)));
    return configs.filter((bank): bank is RuntimeBankConfig => Boolean(bank));
  }

  /** Legacy callback URL has no config id, so safely identify its account by the signature. */
  async findBankConfigByToken(candidate?: string): Promise<RuntimeBankConfig | undefined> {
    if (!candidate?.trim()) return undefined;
    for (const bank of await this.getBankConfigsForRuntime()) {
      if (secretsEqual(candidate.trim(), bank.token)) return bank;
    }
    return undefined;
  }

  private runtimeBankConfig(stored: StoredBankAccount): RuntimeBankConfig | undefined {
    const legacyEnvironmentToken = stored.id === LEGACY_BANK_CONFIG_ID ? process.env.TOKEN_API_BANK?.trim() : undefined;
    const token = stored.encryptedToken ? this.encryption.decrypt<string>(stored.encryptedToken) : legacyEnvironmentToken;
    if (!token || !stored.bankId || !stored.accountNo || !stored.accountName) return undefined;
    return { id: stored.id, label: stored.label,
      provider: stored.provider === 'BIDV_V2' ? 'BIDV_V4' : stored.provider, token,
      bankId: stored.bankId, accountNo: stored.accountNo, template: stored.template, accountName: stored.accountName };
  }

  /** Used by the Vercel webhook handler; never return this value to an admin UI. */
  async getRuntimeBotToken(): Promise<RuntimeBotToken> {
    const setting = await this.settings.findOne({ key: 'telegram.bot_token' }).select('value').lean();
    if (setting) {
      const value = setting.value as StoredBotToken;
      if (!value?.encryptedToken) throw new BadRequestException('Stored Telegram token is malformed');
      return { token: this.encryption.decrypt<string>(value.encryptedToken), source: 'database' };
    }
    const token = process.env.BOT_TOKEN?.trim();
    if (!token) throw new BadRequestException('Telegram bot token has not been configured');
    return { token, source: 'environment' };
  }

  async updateWelcomeMessage(message: string, adminId: string, requestId?: string) {
    const adminObjectId = new Types.ObjectId(adminId);
    const setting = await this.settings.findOneAndUpdate({ key: 'shop.welcome_message' }, { $set: {
      value: message.trim(), description: 'Telegram /start welcome message', public: false, updatedBy: adminObjectId,
    } }, { upsert: true, new: true, setDefaultsOnInsert: true });
    await this.audits.create({ actorType: 'ADMIN', actorId: adminObjectId, action: 'TELEGRAM_WELCOME_MESSAGE_UPDATED',
      resourceType: 'Setting', resourceId: setting._id, requestId, metadata: { length: message.trim().length } });
    return { welcomeMessage: message.trim(), updatedAt: setting.updatedAt, reloadWithinSeconds: botConfigPollSeconds() };
  }

  async updateBankConfig(input: UpdateBankConfigDto, adminId: string, requestId?: string) {
    return this.withBankConfigUpdateLock(() => this.updateBankConfigUnlocked(input, adminId, requestId));
  }

  private async updateBankConfigUnlocked(input: UpdateBankConfigDto, adminId: string, requestId?: string) {
    const adminObjectId = new Types.ObjectId(adminId);
    const current = await this.settings.findOne({ key: 'bank.api_config' }).select('value').lean();
    const stored = storedBankCollection(current?.value);
    const environment = !stored ? environmentBankAccount(this.encryption) : undefined;
    const collection = stored ?? (environment
      ? { version: 2 as const, activeBankId: environment.encryptedToken && environment.bankId && environment.accountNo && environment.accountName ? environment.id : '', banks: [environment] }
      : emptyBankCollection());
    const legacyStyleUpdate = !input.id && input.provider === undefined && input.label === undefined &&
      input.active === undefined && input.enabled === undefined;
    const existingId = legacyStyleUpdate ? collection.activeBankId : input.id;
    const existingIndex = existingId ? collection.banks.findIndex((bank) => bank.id === existingId) : -1;
    if (input.id && existingIndex < 0) throw new BadRequestException('Không tìm thấy cấu hình ngân hàng');
    const previous = existingIndex >= 0 ? collection.banks[existingIndex] : undefined;
    const id = previous?.id ?? new Types.ObjectId().toString();
    const token = input.tokenApiBank?.trim();
    if (!token && !previous?.encryptedToken) throw new BadRequestException('SECRET_KEY API ngân hàng là bắt buộc');
    const value: StoredBankAccount = {
      id,
      label: input.label?.trim() || previous?.label || `${input.bankId.trim()} · ${input.accountNo.trim().slice(-4)}`,
      provider: input.provider ?? previous?.provider ?? 'CAKE_V2',
      ...(token ? { encryptedToken: this.encryption.encrypt(token), encryptionKeyVersion: this.encryption.currentVersion,
        lastFour: token.slice(-4) } : {
        encryptedToken: previous!.encryptedToken, encryptionKeyVersion: previous!.encryptionKeyVersion,
        lastFour: previous!.lastFour,
      }),
      bankId: input.bankId.trim(), accountNo: input.accountNo.trim(), template: input.template,
      accountName: input.accountName.trim(), amount: input.amount, description: input.description.trim(),
    };
    const banks = [...collection.banks];
    if (existingIndex >= 0) banks[existingIndex] = value;
    else banks.push(value);
    const requestedActive = input.active ?? input.enabled;
    const activeBankId = requestedActive === true || !collection.activeBankId || banks.length === 1
      ? id : collection.activeBankId;
    const savedValue: StoredBankCollection = { version: 2, activeBankId, banks };
    const setting = await this.settings.findOneAndUpdate({ key: 'bank.api_config' }, { $set: {
      value: savedValue, description: 'Encrypted multi-bank API history and VietQR settings', public: false,
      updatedBy: adminObjectId,
    } }, { upsert: true, new: true, setDefaultsOnInsert: true });
    await this.audits.create({ actorType: 'ADMIN', actorId: adminObjectId,
      action: previous ? 'BANK_API_CONFIG_UPDATED' : 'BANK_API_CONFIG_CREATED',
      resourceType: 'Setting', resourceId: setting._id, requestId,
      metadata: { bankConfigId: id, provider: value.provider, active: activeBankId === id,
        bankId: value.bankId, accountNoLastFour: value.accountNo.slice(-4), template: value.template } });
    return { ...publicBankConfigState(savedValue, setting.updatedAt), savedBankId: id,
      reloadWithinSeconds: botConfigPollSeconds() };
  }

  async activateBankConfig(id: string, adminId: string, requestId?: string) {
    return this.withBankConfigUpdateLock(async () => {
      const adminObjectId = new Types.ObjectId(adminId);
      const current = await this.settings.findOne({ key: 'bank.api_config' }).select('value').lean();
      const collection = storedBankCollection(current?.value);
      const bank = collection?.banks.find((entry) => entry.id === id && !entry.archivedAt);
      if (!collection || !bank) throw new BadRequestException('Không tìm thấy cấu hình ngân hàng');
      const value: StoredBankCollection = { ...collection, activeBankId: bank.id };
      const setting = await this.settings.findOneAndUpdate({ key: 'bank.api_config' }, { $set: {
        value, description: 'Encrypted multi-bank API history and VietQR settings', public: false,
        updatedBy: adminObjectId,
      } }, { new: true });
      if (!setting) throw new BadRequestException('Không thể bật ngân hàng');
      await this.audits.create({ actorType: 'ADMIN', actorId: adminObjectId, action: 'BANK_API_CONFIG_ACTIVATED',
        resourceType: 'Setting', resourceId: setting._id, requestId,
        metadata: { bankConfigId: bank.id, provider: bank.provider, bankId: bank.bankId } });
      return { ...publicBankConfigState(value, setting.updatedAt), reloadWithinSeconds: botConfigPollSeconds() };
    });
  }

  /** Archive instead of hard-delete so a pending QR can still query its original provider. */
  async archiveBankConfig(id: string, adminId: string, requestId?: string) {
    return this.withBankConfigUpdateLock(async () => {
      const adminObjectId = new Types.ObjectId(adminId);
      const current = await this.settings.findOne({ key: 'bank.api_config' }).select('value').lean();
      const collection = storedBankCollection(current?.value);
      if (!collection) throw new BadRequestException('Không tìm thấy cấu hình ngân hàng');
      if (collection.activeBankId === id) throw new ConflictException('Hãy bật ngân hàng khác trước khi xóa');
      const index = collection.banks.findIndex((bank) => bank.id === id && !bank.archivedAt);
      if (index < 0) throw new BadRequestException('Không tìm thấy cấu hình ngân hàng');
      const banks = [...collection.banks];
      banks[index] = { ...banks[index]!, archivedAt: new Date().toISOString() };
      const value: StoredBankCollection = { ...collection, banks };
      const setting = await this.settings.findOneAndUpdate({ key: 'bank.api_config' }, { $set: {
        value, description: 'Encrypted multi-bank API history and VietQR settings', public: false,
        updatedBy: adminObjectId,
      } }, { new: true });
      if (!setting) throw new BadRequestException('Không thể xóa ngân hàng');
      await this.audits.create({ actorType: 'ADMIN', actorId: adminObjectId, action: 'BANK_API_CONFIG_ARCHIVED',
        resourceType: 'Setting', resourceId: setting._id, requestId, metadata: { bankConfigId: id } });
      return { ...publicBankConfigState(value, setting.updatedAt), reloadWithinSeconds: botConfigPollSeconds() };
    });
  }

  /** Resolve hot-editable values from MongoDB, with environment variables as bootstrap fallback. */
  async getRuntimeOperationalConfig(): Promise<RuntimeOperationalConfig> {
    const setting = await this.settings.findOne({ key: 'runtime.operational_config' }).select('value').lean();
    const stored = isStoredOperationalConfig(setting?.value) ? setting.value : undefined;
    const fallback = operationalConfigFromEnvironment();
    const encryptedToken = stored?.encryptedQstashToken;
    const environmentToken = process.env.QSTASH_TOKEN?.trim() ?? '';
    return {
      shopName: stored?.shopName || fallback.shopName,
      adminTelegramIds: stored?.adminTelegramIds ?? fallback.adminTelegramIds,
      apiUrl: stripTrailingSlash(stored?.apiUrl || fallback.apiUrl),
      telegramWebhookUrl: stripTrailingSlash(stored?.telegramWebhookUrl || fallback.telegramWebhookUrl),
      qstashUrl: stripTrailingSlash(stored?.qstashUrl || fallback.qstashUrl),
      taskBaseUrl: stripTrailingSlash(stored?.taskBaseUrl || fallback.taskBaseUrl),
      qstashToken: encryptedToken ? this.encryption.decrypt<string>(encryptedToken) : environmentToken,
      source: encryptedToken ? 'database' : environmentToken ? 'environment' : 'none',
      qstashTokenLastFour: stored?.qstashTokenLastFour ?? (environmentToken.slice(-4) || undefined),
    };
  }

  async getQStashRuntimeConfig() {
    const runtime = await this.getRuntimeOperationalConfig();
    if (!runtime.qstashToken) throw new Error('QStash token has not been configured');
    if (!runtime.taskBaseUrl || !runtime.qstashUrl) throw new Error('QStash URL and task base URL have not been configured');
    return { token: runtime.qstashToken, endpoint: runtime.qstashUrl, taskBaseUrl: runtime.taskBaseUrl };
  }

  async updateRuntimeConfig(input: UpdateRuntimeConfigDto, adminId: string, requestId?: string) {
    const adminObjectId = new Types.ObjectId(adminId);
    const current = await this.settings.findOne({ key: 'runtime.operational_config' }).lean();
    const previous = isStoredOperationalConfig(current?.value) ? current.value : undefined;
    const enteredToken = normalizeSecretValue(input.qstashToken, 'QSTASH_TOKEN');
    const value: StoredOperationalConfig = {
      shopName: input.shopName.trim(),
      adminTelegramIds: input.adminTelegramIds.split(',').map((id) => id.trim()).filter(Boolean),
      apiUrl: stripTrailingSlash(input.apiUrl.trim()),
      telegramWebhookUrl: stripTrailingSlash(input.telegramWebhookUrl.trim()),
      qstashUrl: stripTrailingSlash(input.qstashUrl.trim()),
      taskBaseUrl: stripTrailingSlash(input.taskBaseUrl.trim()),
      ...(enteredToken ? {
        encryptedQstashToken: this.encryption.encrypt(enteredToken),
        qstashTokenLastFour: enteredToken.slice(-4),
        encryptionKeyVersion: this.encryption.currentVersion,
      } : previous?.encryptedQstashToken ? {
        encryptedQstashToken: previous.encryptedQstashToken,
        qstashTokenLastFour: previous.qstashTokenLastFour,
        encryptionKeyVersion: previous.encryptionKeyVersion,
      } : {}),
    };
    if (isServerlessRuntime()) {
      if (!/^https:\/\//i.test(value.apiUrl)) {
        throw new BadRequestException('API URL must use HTTPS in serverless mode');
      }
      if (!value.telegramWebhookUrl || !value.qstashUrl || !value.taskBaseUrl) {
        throw new BadRequestException('Webhook URL, QStash URL and task base URL are required in serverless mode');
      }
      if (!value.encryptedQstashToken && !process.env.QSTASH_TOKEN?.trim()) {
        throw new BadRequestException('QStash token is required in serverless mode');
      }
    }
    const setting = await this.settings.findOneAndUpdate({ key: 'runtime.operational_config' }, { $set: {
      value, description: 'Hot-reloadable operational endpoints and encrypted QStash token', public: false,
      updatedBy: adminObjectId,
    } }, { upsert: true, new: true, setDefaultsOnInsert: true });
    try {
      // A webhook URL change takes effect immediately for an already configured bot.
      if (isServerlessRuntime()) {
        const runtimeToken = await this.getRuntimeBotToken().catch(() => undefined);
        if (runtimeToken) await this.configureServerlessWebhook(runtimeToken.token, await this.serverlessWebhookConfig(value));
      }
    } catch (error) {
      if (current) {
        await this.settings.updateOne({ _id: setting._id }, { $set: {
          value: current.value, description: current.description, public: current.public, updatedBy: current.updatedBy,
        } });
      } else await this.settings.deleteOne({ _id: setting._id });
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException('Không thể áp dụng Telegram webhook mới');
    }
    await this.audits.create({ actorType: 'ADMIN', actorId: adminObjectId, action: 'RUNTIME_CONFIG_UPDATED',
      resourceType: 'Setting', resourceId: setting._id, requestId, metadata: {
        shopName: value.shopName, adminTelegramIds: value.adminTelegramIds.length, apiUrl: value.apiUrl,
        telegramWebhookUrl: value.telegramWebhookUrl, qstashUrl: value.qstashUrl, taskBaseUrl: value.taskBaseUrl,
        qstashTokenChanged: Boolean(enteredToken),
      } });
    return { runtime: publicOperationalConfig(value, setting.updatedAt), reloadWithinSeconds: botConfigPollSeconds() };
  }

  async updateToken(token: string, adminId: string, requestId?: string) {
    return this.withTokenUpdateLock(() => this.updateTokenUnlocked(token, adminId, requestId));
  }

  private async updateTokenUnlocked(token: string, adminId: string, requestId?: string) {
    let bot: VerifiedTelegramBot;
    try {
      bot = await withTimeout(this.verifyToken(token), 10_000);
    } catch { throw new BadRequestException('Telegram rejected the token or verification timed out'); }

    const value: StoredBotToken = { encryptedToken: this.encryption.encrypt(token),
      encryptionKeyVersion: this.encryption.currentVersion, lastFour: token.slice(-4), botId: bot.id,
      botUsername: bot.username };
    const adminObjectId = new Types.ObjectId(adminId);
    const previousSetting = await this.settings.findOne({ key: 'telegram.bot_token' }).lean();
    const previousToken = await this.previousRuntimeToken(previousSetting?.value);
    const webhookConfig = isServerlessRuntime() ? await this.serverlessWebhookConfig() : undefined;

    // An old bot can keep delivering to the same URL after a token switch. It
    // carries the same static header secret, so it must be disabled *before*
    // the database starts treating updates as belonging to the new token.
    if (webhookConfig && previousToken && previousToken !== token) {
      await this.deleteServerlessWebhook(previousToken);
    }

    let setting: Setting & { _id: Types.ObjectId };
    let wroteNewSetting = false;
    try {
      setting = await this.settings.findOneAndUpdate({ key: 'telegram.bot_token' }, { $set: {
        value, description: 'Encrypted Telegram bot token managed from the admin console', public: false,
        updatedBy: adminObjectId,
      } }, { upsert: true, new: true, setDefaultsOnInsert: true }) as Setting & { _id: Types.ObjectId };
      if (!setting) throw new Error('Telegram bot token setting could not be saved');
      wroteNewSetting = true;
      if (webhookConfig) await this.configureServerlessWebhook(token, webhookConfig);
    } catch (error) {
      // Telegram is an external system, so this is a compensation rather than
      // a transaction. It makes an unsuccessful token change return to the
      // prior DB/webhook pair instead of leaving a mismatched active bot.
      const restored = !wroteNewSetting || await this.restorePreviousTokenSetting(value, previousSetting).catch(() => false);
      if (restored && webhookConfig && previousToken && previousToken !== token) {
        await this.configureServerlessWebhook(previousToken, webhookConfig).catch(() => undefined);
      }
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException('Could not save or configure the Telegram bot token');
    }
    await this.audits.create({ actorType: 'ADMIN', actorId: adminObjectId, action: 'TELEGRAM_BOT_TOKEN_UPDATED',
      resourceType: 'Setting', resourceId: setting._id, requestId,
      metadata: { botId: bot.id, botUsername: bot.username, encryptionKeyVersion: this.encryption.currentVersion } });
    return { configured: true, source: 'database', botId: bot.id, botUsername: bot.username,
      maskedToken: `••••••••${token.slice(-4)}`, encryptionKeyVersion: this.encryption.currentVersion,
      updatedAt: setting.updatedAt, reloadWithinSeconds: botConfigPollSeconds() };
  }

  private async serverlessWebhookConfig(stored?: StoredOperationalConfig): Promise<ServerlessWebhookConfig> {
    const webhookUrl = stored?.telegramWebhookUrl || (await this.getRuntimeOperationalConfig()).telegramWebhookUrl;
    const secretSeed = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
    if (!webhookUrl || !/^https:\/\//i.test(webhookUrl)) {
      throw new BadRequestException('TELEGRAM_WEBHOOK_URL HTTPS is required in serverless mode');
    }
    if (!isTelegramWebhookSecretSeed(secretSeed)) {
      throw new BadRequestException('TELEGRAM_WEBHOOK_SECRET must contain 32-256 URL-safe characters');
    }
    return { webhookUrl, secretSeed };
  }

  private async configureServerlessWebhook(token: string, config?: ServerlessWebhookConfig) {
    const resolved = config ?? await this.serverlessWebhookConfig();
    try {
      await withTimeout(new Telegram(token).setWebhook(resolved.webhookUrl, {
        secret_token: deriveTelegramWebhookSecret(resolved.secretSeed, token),
        allowed_updates: ['message', 'callback_query'],
        drop_pending_updates: false,
      }), 10_000);
    } catch {
      throw new BadRequestException('Could not configure the Telegram webhook');
    }
  }

  private async deleteServerlessWebhook(token: string) {
    try {
      await withTimeout(new Telegram(token).deleteWebhook({ drop_pending_updates: false }), 10_000);
    } catch {
      throw new BadRequestException('Could not disable the previous Telegram webhook safely');
    }
  }

  private async previousRuntimeToken(value: unknown) {
    if (isStoredBotToken(value)) return this.encryption.decrypt<string>(value.encryptedToken);
    return process.env.BOT_TOKEN?.trim();
  }

  private async restorePreviousTokenSetting(newValue: StoredBotToken, previous?: Setting | null) {
    const filter = { key: 'telegram.bot_token', 'value.encryptedToken': newValue.encryptedToken };
    if (!previous) {
      return (await this.settings.deleteOne(filter)).deletedCount === 1;
    }
    return (await this.settings.updateOne(filter, { $set: {
      value: previous.value, description: previous.description, public: previous.public, updatedBy: previous.updatedBy,
    } })).matchedCount === 1;
  }

  private async withTokenUpdateLock<T>(work: () => Promise<T>) {
    if (!this.leases) return work();
    const token = randomUUID();
    const now = new Date();
    try {
      const lease = await this.leases.findOneAndUpdate({ _id: 'telegram-bot-token-update', expiresAt: { $lte: now } }, {
        $set: { token, expiresAt: new Date(now.getTime() + BOT_TOKEN_UPDATE_LEASE_MS) },
      }, { upsert: true, new: true, setDefaultsOnInsert: true });
      if (!lease || lease.token !== token) throw new ConflictException('Another Telegram bot token update is in progress');
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      if (isMongoDuplicateKey(error)) throw new ConflictException('Another Telegram bot token update is in progress');
      throw error;
    }
    try {
      return await work();
    } finally {
      await this.leases.updateOne({ _id: 'telegram-bot-token-update', token }, { $set: { expiresAt: new Date() } }).catch(() => undefined);
    }
  }

  private async withBankConfigUpdateLock<T>(work: () => Promise<T>) {
    if (!this.leases) return work();
    const token = randomUUID();
    const now = new Date();
    try {
      const lease = await this.leases.findOneAndUpdate({ _id: 'bank-config-update', expiresAt: { $lte: now } }, {
        $set: { token, expiresAt: new Date(now.getTime() + BANK_CONFIG_UPDATE_LEASE_MS) },
      }, { upsert: true, new: true, setDefaultsOnInsert: true });
      if (!lease || lease.token !== token) throw new ConflictException('Một thay đổi ngân hàng khác đang được xử lý');
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      if (isMongoDuplicateKey(error)) throw new ConflictException('Một thay đổi ngân hàng khác đang được xử lý');
      throw error;
    }
    try {
      return await work();
    } finally {
      await this.leases.updateOne({ _id: 'bank-config-update', token }, { $set: { expiresAt: new Date() } }).catch(() => undefined);
    }
  }
}

export const botTokenVerifierProvider = {
  provide: BOT_TOKEN_VERIFIER,
  useValue: async (token: string): Promise<VerifiedTelegramBot> => {
    const bot = await new Telegram(token).getMe();
    return { id: bot.id, username: bot.username, first_name: bot.first_name };
  },
};

function withTimeout<T>(operation: Promise<T>, milliseconds: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Telegram verification timed out')), milliseconds);
    operation.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

function botConfigPollSeconds() {
  const configured = Number(process.env.BOT_CONFIG_POLL_SECONDS ?? 15);
  return Number.isSafeInteger(configured) && configured >= 5 ? configured : 15;
}

function defaultWelcomeMessage() {
  return `Chào mừng bạn đến với ${process.env.SHOP_NAME ?? 'Digital Store'}!`;
}

function isStoredBotToken(value: unknown): value is StoredBotToken {
  return Boolean(value && typeof value === 'object' && 'encryptedToken' in value && 'lastFour' in value);
}

function isStoredBankConfig(value: unknown): value is StoredBankConfig {
  return Boolean(value && typeof value === 'object' && 'bankId' in value && 'accountNo' in value);
}

function isStoredBankCollection(value: unknown): value is StoredBankCollection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<StoredBankCollection>;
  return candidate.version === 2 && typeof candidate.activeBankId === 'string' && Array.isArray(candidate.banks);
}

function normalizeStoredBankAccount(value: unknown, fallbackId?: string): StoredBankAccount | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const bank = value as Record<string, unknown>;
  const bankId = typeof bank.bankId === 'string' ? bank.bankId.trim() : '';
  const accountNo = typeof bank.accountNo === 'string' ? bank.accountNo.trim() : '';
  if (!bankId || !accountNo) return undefined;
  const provider = bank.provider === 'BIDV_V4' || bank.provider === 'BIDV_V2' ? 'BIDV_V4' : 'CAKE_V2';
  const amount = Number(bank.amount ?? 0);
  const id = typeof bank.id === 'string' && bank.id.trim() ? bank.id.trim() : fallbackId || `${provider}:${bankId}:${accountNo}`;
  return {
    id,
    label: typeof bank.label === 'string' && bank.label.trim() ? bank.label.trim() : `${bankId} · ${accountNo.slice(-4)}`,
    provider,
    ...(typeof bank.encryptedToken === 'string' && bank.encryptedToken ? { encryptedToken: bank.encryptedToken } : {}),
    ...(Number.isSafeInteger(bank.encryptionKeyVersion) ? { encryptionKeyVersion: Number(bank.encryptionKeyVersion) } : {}),
    ...(typeof bank.lastFour === 'string' ? { lastFour: bank.lastFour } : {}),
    bankId,
    accountNo,
    template: ['compact', 'compact2', 'qr_only', 'print', 'loax'].includes(String(bank.template)) ? String(bank.template) : 'compact2',
    accountName: typeof bank.accountName === 'string' ? bank.accountName.trim() : '',
    amount: Number.isSafeInteger(amount) && amount >= 0 ? amount : 0,
    description: typeof bank.description === 'string' ? bank.description : '',
    ...(typeof bank.archivedAt === 'string' ? { archivedAt: bank.archivedAt } : {}),
  };
}

function emptyBankCollection(): StoredBankCollection {
  return { version: 2, activeBankId: '', banks: [] };
}

/** Read both the old singleton and the v2 collection without a destructive migration. */
function storedBankCollection(value: unknown): StoredBankCollection | undefined {
  if (isStoredBankCollection(value)) {
    const banks = value.banks.map((bank, index) => normalizeStoredBankAccount(bank, `bank-${index + 1}`))
      .filter((bank): bank is StoredBankAccount => Boolean(bank));
    const requested = banks.find((bank) => bank.id === value.activeBankId && !bank.archivedAt);
    const activeBankId = requested?.id ?? banks.find((bank) => !bank.archivedAt)?.id ?? '';
    return { version: 2, activeBankId, banks };
  }
  if (!isStoredBankConfig(value)) return undefined;
  const bank = normalizeStoredBankAccount({ ...value, id: LEGACY_BANK_CONFIG_ID, provider: 'CAKE_V2' });
  if (!bank) return undefined;
  return { version: 2, activeBankId: bank.id, banks: [bank] };
}

function isStoredOperationalConfig(value: unknown): value is StoredOperationalConfig {
  return Boolean(value && typeof value === 'object' && 'shopName' in value && 'apiUrl' in value
    && 'adminTelegramIds' in value && Array.isArray((value as StoredOperationalConfig).adminTelegramIds));
}

function operationalConfigFromEnvironment(): Omit<RuntimeOperationalConfig, 'qstashToken' | 'source' | 'qstashTokenLastFour'> {
  return {
    shopName: process.env.SHOP_NAME?.trim() || 'Digital Store',
    adminTelegramIds: (process.env.ADMIN_TELEGRAM_IDS ?? '').split(',').map((id) => id.trim()).filter(Boolean),
    apiUrl: stripTrailingSlash(process.env.API_URL?.trim() || 'http://localhost:3001'),
    telegramWebhookUrl: stripTrailingSlash(process.env.TELEGRAM_WEBHOOK_URL?.trim() || ''),
    qstashUrl: stripTrailingSlash(process.env.QSTASH_URL?.trim() || 'https://qstash.upstash.io'),
    taskBaseUrl: stripTrailingSlash(process.env.TASK_BASE_URL?.trim() || process.env.WEB_APP_URL?.trim() || ''),
  };
}

function publicOperationalConfig(value: unknown, updatedAt?: Date) {
  const stored = isStoredOperationalConfig(value) ? value : undefined;
  const fallback = operationalConfigFromEnvironment();
  const environmentToken = process.env.QSTASH_TOKEN?.trim();
  const source = stored?.encryptedQstashToken ? 'database' : environmentToken ? 'environment' : 'none';
  const lastFour = stored?.qstashTokenLastFour ?? environmentToken?.slice(-4);
  return {
    shopName: stored?.shopName || fallback.shopName,
    adminTelegramIds: (stored?.adminTelegramIds ?? fallback.adminTelegramIds).join(','),
    apiUrl: stored?.apiUrl || fallback.apiUrl,
    telegramWebhookUrl: stored?.telegramWebhookUrl || fallback.telegramWebhookUrl,
    qstashUrl: stored?.qstashUrl || fallback.qstashUrl,
    taskBaseUrl: stored?.taskBaseUrl || fallback.taskBaseUrl,
    qstashConfigured: Boolean(stored?.encryptedQstashToken || environmentToken),
    qstashSource: source,
    maskedQstashToken: lastFour ? `••••••••${lastFour}` : undefined,
    updatedAt,
  };
}

function normalizeSecretValue(value: string | undefined, variableName: string) {
  let text = value?.trim() ?? '';
  text = text.replace(new RegExp(`^(?:export\\s+)?${variableName}\\s*=\\s*`, 'i'), '').trim();
  const quote = text[0];
  if ((quote === '"' || quote === "'") && text.at(-1) === quote) text = text.slice(1, -1).trim();
  return text;
}

function stripTrailingSlash(value: string) { return value.replace(/\/+$/, ''); }

function publicBankConfigState(value: unknown, updatedAt?: Date) {
  const collection = storedBankCollection(value);
  if (collection) {
    const banks = collection.banks.filter((bank) => !bank.archivedAt)
      .map((bank) => publicStoredBank(bank, bank.id === collection.activeBankId, updatedAt));
    return { bank: banks.find((bank) => bank.active), banks, activeBankId: collection.activeBankId };
  }
  const environmentToken = process.env.TOKEN_API_BANK?.trim();
  const bankId = process.env.BANK_ID?.trim() ?? '';
  const accountNo = process.env.BANK_ACCOUNT_NO?.trim() ?? '';
  const template = process.env.BANK_QR_TEMPLATE?.trim() || 'compact2';
  const accountName = process.env.BANK_ACCOUNT_NAME?.trim() ?? '';
  const amount = Number(process.env.BANK_QR_AMOUNT ?? 0);
  const description = process.env.BANK_QR_DESCRIPTION ?? '';
  if (!environmentToken && !bankId && !accountNo) return { bank: undefined, banks: [], activeBankId: '' };
  const provider = environmentBankProvider();
  const qrUrl = bankId && accountNo ? vietQrPreview(bankId, accountNo, template, amount, description, accountName) : undefined;
  const bank = {
    id: ENVIRONMENT_BANK_CONFIG_ID, label: `${bankId || 'Ngân hàng'} · ${accountNo.slice(-4)}`,
    provider, active: true, enabled: true, configured: Boolean(environmentToken && bankId && accountNo && accountName),
    tokenConfigured: Boolean(environmentToken), tokenLastFour: environmentToken?.slice(-4), source: 'environment',
    maskedToken: environmentToken ? `••••••••${environmentToken.slice(-4)}` : undefined,
    bankId, accountNo, template, accountName, amount: Number.isSafeInteger(amount) && amount >= 0 ? amount : 0,
    description, qrUrl, updatedAt,
  };
  return { bank, banks: [bank], activeBankId: bank.id };
}

function publicStoredBank(bank: StoredBankAccount, active: boolean, updatedAt?: Date) {
  const legacyEnvironmentToken = bank.id === LEGACY_BANK_CONFIG_ID ? process.env.TOKEN_API_BANK?.trim() : undefined;
  const tokenConfigured = Boolean(bank.encryptedToken || legacyEnvironmentToken);
  const tokenLastFour = bank.lastFour ?? legacyEnvironmentToken?.slice(-4);
  const qrUrl = bank.bankId && bank.accountNo
    ? vietQrPreview(bank.bankId, bank.accountNo, bank.template, bank.amount, bank.description, bank.accountName)
    : undefined;
  return {
    id: bank.id, label: bank.label, provider: bank.provider, active, enabled: active,
    configured: Boolean(tokenConfigured && bank.bankId && bank.accountNo && bank.accountName),
    tokenConfigured, tokenLastFour, source: bank.encryptedToken ? 'database' : legacyEnvironmentToken ? 'environment' : 'none',
    maskedToken: tokenLastFour ? `••••••••${tokenLastFour}` : undefined,
    bankId: bank.bankId, accountNo: bank.accountNo, template: bank.template,
    accountName: bank.accountName, amount: bank.amount, description: bank.description, qrUrl, updatedAt,
  };
}

function vietQrPreview(bankId: string, accountNo: string, template: string, amount: number,
  description: string, accountName: string) {
  return `https://img.vietqr.io/image/${encodeURIComponent(bankId)}-${encodeURIComponent(accountNo)}-${encodeURIComponent(template)}.png?amount=${amount}&addInfo=${encodeURIComponent(description)}&accountName=${encodeURIComponent(accountName)}`;
}

function environmentBankProvider(): BankHistoryProvider {
  return ['BIDV_V4', 'BIDV_V2'].includes(process.env.BANK_HISTORY_PROVIDER?.trim().toUpperCase() ?? '')
    ? 'BIDV_V4' : 'CAKE_V2';
}

function environmentBankConfig(): RuntimeBankConfig | undefined {
  const token = process.env.TOKEN_API_BANK?.trim();
  const bankId = process.env.BANK_ID?.trim();
  const accountNo = process.env.BANK_ACCOUNT_NO?.trim();
  const accountName = process.env.BANK_ACCOUNT_NAME?.trim();
  if (!token || !bankId || !accountNo || !accountName) return undefined;
  return { id: ENVIRONMENT_BANK_CONFIG_ID, label: `${bankId} · ${accountNo.slice(-4)}`,
    provider: environmentBankProvider(), token, bankId, accountNo,
    template: process.env.BANK_QR_TEMPLATE?.trim() || 'compact2', accountName };
}

function environmentBankAccount(encryption: EncryptionService): StoredBankAccount | undefined {
  const token = process.env.TOKEN_API_BANK?.trim() ?? '';
  const bankId = process.env.BANK_ID?.trim() ?? '';
  const accountNo = process.env.BANK_ACCOUNT_NO?.trim() ?? '';
  const accountName = process.env.BANK_ACCOUNT_NAME?.trim() ?? '';
  if (!token && !bankId && !accountNo) return undefined;
  const amount = Number(process.env.BANK_QR_AMOUNT ?? 0);
  return {
    id: ENVIRONMENT_BANK_CONFIG_ID,
    label: `${bankId || 'Ngân hàng'} · ${accountNo.slice(-4)}`,
    provider: environmentBankProvider(),
    ...(token ? { encryptedToken: encryption.encrypt(token), encryptionKeyVersion: encryption.currentVersion,
      lastFour: token.slice(-4) } : {}),
    bankId, accountNo, template: process.env.BANK_QR_TEMPLATE?.trim() || 'compact2', accountName,
    amount: Number.isSafeInteger(amount) && amount >= 0 ? amount : 0,
    description: process.env.BANK_QR_DESCRIPTION ?? '',
  };
}

function secretsEqual(candidate: string, expected: string) {
  const left = Buffer.from(candidate);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}
