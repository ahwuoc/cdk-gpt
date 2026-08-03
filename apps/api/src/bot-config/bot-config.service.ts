import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { Telegram } from 'telegraf';
import { EncryptionService } from '@store/encryption';
import type { AuditLog, Setting } from '@store/database';

export interface VerifiedTelegramBot { id: number; username?: string; first_name: string; }
export type BotTokenVerifier = (token: string) => Promise<VerifiedTelegramBot>;
export const BOT_TOKEN_VERIFIER = Symbol('BOT_TOKEN_VERIFIER');

interface StoredBotToken {
  encryptedToken: string;
  encryptionKeyVersion: number;
  lastFour: string;
  botId: number;
  botUsername?: string;
}

@Injectable()
export class BotConfigService {
  private readonly encryption = EncryptionService.fromEnvironment();
  constructor(
    @InjectModel('Setting') private readonly settings: Model<Setting>,
    @InjectModel('AuditLog') private readonly audits: Model<AuditLog>,
    @Inject(BOT_TOKEN_VERIFIER) private readonly verifyToken: BotTokenVerifier,
  ) {}

  async getPublicConfig() {
    const setting = await this.settings.findOne({ key: 'telegram.bot_token' }).select('value updatedAt').lean();
    if (!setting) {
      const environmentToken = process.env.BOT_TOKEN;
      return { configured: Boolean(environmentToken), source: environmentToken ? 'environment' : 'none',
        maskedToken: environmentToken ? `••••••••${environmentToken.slice(-4)}` : undefined,
        reloadWithinSeconds: botConfigPollSeconds() };
    }
    const value = setting.value as StoredBotToken;
    return { configured: true, source: 'database', botId: value.botId, botUsername: value.botUsername,
      maskedToken: `••••••••${value.lastFour}`, encryptionKeyVersion: value.encryptionKeyVersion,
      updatedAt: setting.updatedAt, reloadWithinSeconds: botConfigPollSeconds() };
  }

  async updateToken(token: string, adminId: string, requestId?: string) {
    let bot: VerifiedTelegramBot;
    try {
      bot = await withTimeout(this.verifyToken(token), 10_000);
    } catch { throw new BadRequestException('Telegram rejected the token or verification timed out'); }

    const value: StoredBotToken = { encryptedToken: this.encryption.encrypt(token),
      encryptionKeyVersion: this.encryption.currentVersion, lastFour: token.slice(-4), botId: bot.id,
      botUsername: bot.username };
    const adminObjectId = new Types.ObjectId(adminId);
    const setting = await this.settings.findOneAndUpdate({ key: 'telegram.bot_token' }, { $set: {
      value, description: 'Encrypted Telegram bot token managed from the admin console', public: false,
      updatedBy: adminObjectId,
    } }, { upsert: true, new: true, setDefaultsOnInsert: true });
    await this.audits.create({ actorType: 'ADMIN', actorId: adminObjectId, action: 'TELEGRAM_BOT_TOKEN_UPDATED',
      resourceType: 'Setting', resourceId: setting._id, requestId,
      metadata: { botId: bot.id, botUsername: bot.username, encryptionKeyVersion: this.encryption.currentVersion } });
    return { configured: true, source: 'database', botId: bot.id, botUsername: bot.username,
      maskedToken: `••••••••${token.slice(-4)}`, encryptionKeyVersion: this.encryption.currentVersion,
      updatedAt: setting.updatedAt, reloadWithinSeconds: botConfigPollSeconds() };
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
