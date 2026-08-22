import { BadRequestException, ConflictException, Inject, Injectable, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { randomUUID } from 'node:crypto';
import { Telegram } from 'telegraf';
import { EncryptionService } from '@store/encryption';
import { isServerlessRuntime } from '@store/config';
import { type AuditLog, type RuntimeLease, type Setting } from '@store/database';
import { isMongoDuplicateKey } from '@store/shared';
import type { UpdateBankConfigDto, UpdateRuntimeConfigDto } from './bot-config.dto';
import { deriveTelegramWebhookSecret, isTelegramWebhookSecretSeed } from './telegram-webhook-secret';

export interface VerifiedTelegramBot { id: number; username?: string; first_name: string; }
export interface RuntimeBankConfig {
  token: string;
  bankId: string;
  accountNo: string;
  template: string;
  accountName: string;
}
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
    if (!setting) {
      const environmentToken = process.env.BOT_TOKEN;
      return { configured: Boolean(environmentToken), source: environmentToken ? 'environment' : 'none',
        maskedToken: environmentToken ? `••••••••${environmentToken.slice(-4)}` : undefined,
        welcomeMessage, bank: publicBankConfig(bankSetting?.value, bankSetting?.updatedAt), runtime,
        reloadWithinSeconds: botConfigPollSeconds() };
    }
    const value = setting.value as StoredBotToken;
    return { configured: true, source: 'database', botId: value.botId, botUsername: value.botUsername,
      maskedToken: `••••••••${value.lastFour}`, encryptionKeyVersion: value.encryptionKeyVersion,
      updatedAt: setting.updatedAt, welcomeMessage, bank: publicBankConfig(bankSetting?.value, bankSetting?.updatedAt), runtime,
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

  /** Shared secret used by the Cake callback `signature` header. */
  async getBankApiTokenForRuntime(): Promise<string | undefined> {
    const setting = await this.settings.findOne({ key: 'bank.api_config' }).select('value').lean();
    const stored = isStoredBankConfig(setting?.value) ? setting.value : undefined;
    if (stored?.encryptedToken) return this.encryption.decrypt<string>(stored.encryptedToken);
    return process.env.TOKEN_API_BANK?.trim() || undefined;
  }

  async getBankConfigForRuntime(): Promise<RuntimeBankConfig | undefined> {
    const setting = await this.settings.findOne({ key: 'bank.api_config' }).select('value').lean();
    const stored = isStoredBankConfig(setting?.value) ? setting.value : undefined;
    const fallback = {
      bankId: process.env.BANK_ID ?? '', accountNo: process.env.BANK_ACCOUNT_NO ?? '',
      template: process.env.BANK_QR_TEMPLATE ?? 'compact2', accountName: process.env.BANK_ACCOUNT_NAME ?? '',
    };
    const config = stored ?? fallback;
    const token = stored?.encryptedToken ? this.encryption.decrypt<string>(stored.encryptedToken) : process.env.TOKEN_API_BANK?.trim();
    if (!token || !config.bankId || !config.accountNo || !config.accountName) return undefined;
    return { token, bankId: config.bankId, accountNo: config.accountNo, template: config.template, accountName: config.accountName };
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
    const adminObjectId = new Types.ObjectId(adminId);
    const current = await this.settings.findOne({ key: 'bank.api_config' }).select('value').lean();
    const previous = isStoredBankConfig(current?.value) ? current.value : undefined;
    const token = input.tokenApiBank?.trim();
    const value: StoredBankConfig = {
      ...(token ? { encryptedToken: this.encryption.encrypt(token), encryptionKeyVersion: this.encryption.currentVersion, lastFour: token.slice(-4) } : previous?.encryptedToken ? {
        encryptedToken: previous.encryptedToken, encryptionKeyVersion: previous.encryptionKeyVersion, lastFour: previous.lastFour,
      } : {}),
      bankId: input.bankId.trim(), accountNo: input.accountNo.trim(), template: input.template,
      accountName: input.accountName.trim(), amount: input.amount, description: input.description.trim(),
    };
    const setting = await this.settings.findOneAndUpdate({ key: 'bank.api_config' }, { $set: {
      value, description: 'Encrypted Cake callback signature token and VietQR settings', public: false, updatedBy: adminObjectId,
    } }, { upsert: true, new: true, setDefaultsOnInsert: true });
    await this.audits.create({ actorType: 'ADMIN', actorId: adminObjectId, action: 'BANK_API_CONFIG_UPDATED',
      resourceType: 'Setting', resourceId: setting._id, requestId,
      metadata: { bankId: value.bankId, accountNoLastFour: value.accountNo.slice(-4), template: value.template } });
    return { bank: publicBankConfig(value, setting.updatedAt), reloadWithinSeconds: botConfigPollSeconds() };
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

function publicBankConfig(value: unknown, updatedAt?: Date) {
  const stored = isStoredBankConfig(value) ? value : undefined;
  const environmentToken = process.env.TOKEN_API_BANK?.trim();
  const configuredToken = stored?.encryptedToken || environmentToken;
  const config = stored ?? {
    bankId: process.env.BANK_ID ?? '', accountNo: process.env.BANK_ACCOUNT_NO ?? '',
    template: process.env.BANK_QR_TEMPLATE ?? 'compact2', accountName: process.env.BANK_ACCOUNT_NAME ?? '',
    amount: Number(process.env.BANK_QR_AMOUNT ?? 0), description: process.env.BANK_QR_DESCRIPTION ?? '',
  };
  const qrUrl = config.bankId && config.accountNo
    ? `https://img.vietqr.io/image/${encodeURIComponent(config.bankId)}-${encodeURIComponent(config.accountNo)}-${encodeURIComponent(config.template)}.png?amount=${config.amount}&addInfo=${encodeURIComponent(config.description)}&accountName=${encodeURIComponent(config.accountName)}`
    : undefined;
  return {
    configured: Boolean(configuredToken && config.bankId && config.accountNo),
    source: stored?.encryptedToken ? 'database' : environmentToken ? 'environment' : 'none',
    maskedToken: stored?.lastFour || environmentToken ? `••••••••${stored?.lastFour ?? environmentToken?.slice(-4)}` : undefined,
    bankId: config.bankId, accountNo: config.accountNo, template: config.template,
    accountName: config.accountName, amount: config.amount, description: config.description, qrUrl, updatedAt,
  };
}
