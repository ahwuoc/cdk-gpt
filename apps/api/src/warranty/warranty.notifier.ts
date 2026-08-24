import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Telegram } from 'telegraf';
import type { Model, Types } from 'mongoose';
import type { User } from '@store/database';
import { BotConfigService } from '../bot-config/bot-config.service';

export interface ReportResolutionNotification {
  userId: Types.ObjectId;
  requestCode: string;
  orderCode: string;
  status: string;
  resolutionNote?: string;
}

@Injectable()
export class WarrantyNotifier {
  constructor(
    @InjectModel('User') private readonly users: Model<User>,
    private readonly botConfig: BotConfigService,
  ) {}

  async notify(input: ReportResolutionNotification) {
    const user = await this.users.findOne({ _id: input.userId, deletedAt: null }).select('telegramId').lean();
    if (!user) return false;
    const runtime = await this.botConfig.getRuntimeBotToken();
    const message = [
      '📣 CẬP NHẬT KHIẾU NẠI',
      '',
      `Mã khiếu nại: ${input.requestCode}`,
      `Đơn hàng: ${input.orderCode}`,
      `Trạng thái: ${statusLabel(input.status)}`,
      ...(input.resolutionNote ? ['', `Phản hồi từ shop: ${input.resolutionNote}`] : []),
    ].join('\n');
    await new Telegram(runtime.token).sendMessage(user.telegramId, message);
    return true;
  }
}

function statusLabel(value: string) {
  const labels: Record<string, string> = {
    PENDING: 'Chờ xử lý', REVIEWING: 'Đang xử lý', RESOLVED: 'Đã giải quyết', REJECTED: 'Đã từ chối',
  };
  return labels[value] ?? value;
}
