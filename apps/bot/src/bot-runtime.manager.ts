import { createHash } from 'node:crypto';
import { SettingModel } from '@store/database';
import { EncryptionService } from '@store/encryption';
import { Telegraf } from 'telegraf';
import { createShopBot } from './shop.bot';

interface StoredBotToken {
  encryptedToken: string;
  botUsername?: string;
}

interface StoredOperationalConfig {
  shopName?: string;
  adminTelegramIds?: string[];
  apiUrl?: string;
}

export class BotRuntimeManager {
  private readonly encryption = EncryptionService.fromEnvironment();
  private current?: Telegraf;
  private fingerprint?: string;
  private timer?: ReturnType<typeof setInterval>;
  private refreshing = false;

  readonly telegram = {
    sendMessage: (chatId: string | number, text: string, extra?: Parameters<Telegraf['telegram']['sendMessage']>[2]) => {
      if (!this.current) throw new Error('Telegram bot is not active');
      return this.current.telegram.sendMessage(chatId, text, extra);
    },
    deleteMessage: (chatId: string | number, messageId: number) => {
      if (!this.current) throw new Error('Telegram bot is not active');
      return this.current.telegram.deleteMessage(chatId, messageId);
    },
  };

  constructor(private readonly environmentToken: string, private readonly apiUrl: string,
    private readonly botApiSecret: string, private readonly shopName: string,
    private readonly pollSeconds: number, private readonly environmentAdminTelegramIds: string[] = []) {}

  async getAdminTelegramIds() {
    return (await this.loadOperationalConfig()).adminTelegramIds;
  }

  async start() {
    await this.refresh(false);
    const seconds = Number.isFinite(this.pollSeconds) ? Math.max(5, this.pollSeconds) : 15;
    this.timer = setInterval(() => void this.refresh(false), seconds * 1000);
  }

  stop(signal = 'shutdown') {
    if (this.timer) clearInterval(this.timer);
    this.current?.stop(signal);
  }

  private async refresh(required: boolean) {
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      const [configured, runtime] = await Promise.all([this.loadConfiguredToken(), this.loadOperationalConfig()]);
      const fingerprint = createHash('sha256').update(JSON.stringify({ token: configured.token,
        apiUrl: runtime.apiUrl, shopName: runtime.shopName })).digest('hex');
      if (this.current && fingerprint === this.fingerprint) return;
      const next = createShopBot(configured.token, runtime.apiUrl, this.botApiSecret, runtime.shopName);
      const identity = await next.telegram.getMe();
      this.current?.stop('token-reload');
      this.current = next;
      this.fingerprint = fingerprint;
      console.log(`Telegram bot activated: @${identity.username ?? identity.id} (${configured.source})`);
      // Telegraf's long-polling launch promise intentionally stays pending for
      // the lifetime of the bot. Do not await it or the config refresh loop
      // will stop after the first launch.
      void next.launch().catch((error) => {
        if (this.current === next) {
          this.current = undefined;
          this.fingerprint = undefined;
        }
        console.error({ event: 'bot-launch-failed', message: error instanceof Error ? error.message : 'unknown error' });
      });
    } catch (error) {
      console.error({ event: 'bot-token-reload-failed', message: error instanceof Error ? error.message : 'unknown error' });
      if (required && !this.current) throw new Error('Unable to start Telegram bot with the configured token');
    } finally { this.refreshing = false; }
  }

  private async loadConfiguredToken(): Promise<{ token: string; source: 'database' | 'environment' }> {
    const setting = await SettingModel.findOne({ key: 'telegram.bot_token' }).select('value').lean();
    if (setting) {
      const value = setting.value as StoredBotToken;
      if (!value?.encryptedToken) throw new Error('Stored Telegram bot token is malformed');
      return { token: this.encryption.decrypt<string>(value.encryptedToken), source: 'database' };
    }
    if (!this.environmentToken) throw new Error('No Telegram bot token is configured');
    return { token: this.environmentToken, source: 'environment' };
  }

  private async loadOperationalConfig() {
    const setting = await SettingModel.findOne({ key: 'runtime.operational_config' }).select('value').lean();
    const value = setting?.value && typeof setting.value === 'object' ? setting.value as StoredOperationalConfig : undefined;
    const adminTelegramIds = Array.isArray(value?.adminTelegramIds)
      ? value.adminTelegramIds.filter((id): id is string => typeof id === 'string' && /^\d{1,20}$/.test(id))
      : this.environmentAdminTelegramIds;
    return {
      apiUrl: typeof value?.apiUrl === 'string' && value.apiUrl ? value.apiUrl.replace(/\/+$/, '') : this.apiUrl,
      shopName: typeof value?.shopName === 'string' && value.shopName ? value.shopName : this.shopName,
      adminTelegramIds,
    };
  }
}
