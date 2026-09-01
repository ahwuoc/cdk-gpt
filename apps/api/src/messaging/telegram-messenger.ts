import { Injectable } from '@nestjs/common';
import { Markup, Telegram } from 'telegraf';
import { BotConfigService } from '../bot-config/bot-config.service';

@Injectable()
export class TelegramMessenger {
  constructor(private readonly config: BotConfigService) {}

  async sendSupportMessage(telegramId: string, body: string, complaintId?: string) {
    const runtime = await this.config.getRuntimeBotToken();
    const callback = complaintId ? `support:reply:${complaintId}` : 'support:direct';
    const message = complaintId ? `💬 PHẢN HỒI KHIẾU NẠI\n\n${body}` : `💬 TIN NHẮN TỪ SHOP\n\n${body}`;
    return new Telegram(runtime.token).sendMessage(telegramId, message, {
      ...Markup.inlineKeyboard([[Markup.button.callback('↩️ Trả lời shop', callback)]]),
    });
  }

  async sendBroadcastMessage(telegramId: string, body: string) {
    const runtime = await this.config.getRuntimeBotToken();
    return new Telegram(runtime.token).sendMessage(telegramId, `📢 THÔNG BÁO TỪ SHOP\n\n${body}`, {
      ...Markup.inlineKeyboard([[Markup.button.callback('💬 Liên hệ shop', 'support:direct')]]),
    });
  }
}
