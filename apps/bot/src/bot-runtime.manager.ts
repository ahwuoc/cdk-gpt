import { createHash } from 'node:crypto';
import { SettingModel } from '@store/database';
import { EncryptionService } from '@store/encryption';
import { Telegraf } from 'telegraf';
import { createShopBot } from './shop.bot';

interface StoredBotToken {
  encryptedToken: string;
  botUsername?: string;
}

export class BotRuntimeManager {
  private readonly encryption = EncryptionService.fromEnvironment();
  private current?: Telegraf;
  private fingerprint?: string;
  private timer?: ReturnType<typeof setInterval>;
  private refreshing = false;

  readonly telegram = {
    sendMessage: (chatId: string | number, text: string) => {
      if (!this.current) throw new Error('Telegram bot is not active');
      return this.current.telegram.sendMessage(chatId, text);
    },
  };

  constructor(private readonly environmentToken: string, private readonly apiUrl: string,
    private readonly botApiSecret: string, private readonly shopName: string,
    private readonly pollSeconds: number) {}

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
      const configured = await this.loadConfiguredToken();
      const fingerprint = createHash('sha256').update(configured.token).digest('hex');
      if (this.current && fingerprint === this.fingerprint) return;
      const next = createShopBot(configured.token, this.apiUrl, this.botApiSecret, this.shopName);
      const identity = await next.telegram.getMe();
      this.current?.stop('token-reload');
      await next.launch();
      this.current = next;
      this.fingerprint = fingerprint;
      console.log(`Telegram bot activated: @${identity.username ?? identity.id} (${configured.source})`);
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
}
