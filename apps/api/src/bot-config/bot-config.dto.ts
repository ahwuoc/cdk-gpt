import { Transform } from 'class-transformer';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';

export function normalizeTelegramBotToken(value: unknown): unknown {
  if (typeof value !== 'string') return value;

  let token = value.trim()
    .replace(/^(?:export\s+)?(?:BOT_TOKEN|TELEGRAM_BOT_TOKEN)\s*=\s*/i, '')
    .trim();
  const quote = token[0];
  if ((quote === '"' || quote === "'") && token.at(-1) === quote) token = token.slice(1, -1).trim();
  return token;
}

export class UpdateBotTokenDto {
  @Transform(({ value }) => normalizeTelegramBotToken(value))
  @IsString()
  @Length(30, 200)
  @Matches(/^\d{6,15}:[A-Za-z0-9_-]{20,}$/, { message: 'Token Telegram không đúng định dạng BotFather' })
  token!: string;
}

export class UpdateWelcomeMessageDto {
  @IsString()
  @Length(1, 2000)
  message!: string;
}

export class UpdateBankConfigDto {
  /** Stable identifier used by the multi-bank configuration UI. Omit it to
   * update the legacy/current active account through PUT /bank. */
  @IsOptional() @IsString() @Length(1, 80) @Matches(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/)
  id?: string;

  @IsOptional() @IsString() @Length(1, 100)
  label?: string;

  /** Provider adapter. CAKE_V2 is the backwards-compatible default. */
  @IsOptional() @IsString() @IsIn(['CAKE_V2', 'BIDV_V4'])
  provider?: 'CAKE_V2' | 'BIDV_V4';

  /** When omitted, a newly-created account follows the current active state.
   * Existing accounts retain their state unless explicitly changed. */
  @IsOptional() @IsBoolean()
  active?: boolean;

  /** Alias accepted by clients that call the toggle `enabled`. */
  @IsOptional() @IsBoolean()
  enabled?: boolean;

  @IsOptional() @IsString() @Length(0, 200)
  tokenApiBank?: string;

  @IsString() @Length(2, 40) @Matches(/^[a-z0-9_-]+$/i)
  bankId!: string;

  @IsString() @Length(4, 40) @Matches(/^\d+$/)
  accountNo!: string;

  @IsString() @IsIn(['compact', 'compact2', 'qr_only', 'print', 'loax'])
  template!: string;

  @IsString() @Length(2, 200)
  accountName!: string;

  @Type(() => Number) @IsInt() @Min(0) @Max(9_999_999_999_999)
  amount!: number;

  @IsString() @Length(0, 50) @Matches(/^[\p{L}\p{N} _-]*$/u)
  description!: string;
}

export class TestBankHistoryDto {
  @IsOptional() @IsString() @Length(1, 80) @Matches(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/)
  bankConfigId?: string;
}

/** Values that are safe to rotate from the admin console without rebuilding. */
export class UpdateRuntimeConfigDto {
  @IsString() @Length(1, 100)
  shopName!: string;

  @IsString() @Length(0, 500)
  @Matches(/^$|^\d{1,20}(?:,\d{1,20})*$/, { message: 'ADMIN_TELEGRAM_IDS phải là các ID số, ngăn cách bằng dấu phẩy' })
  adminTelegramIds!: string;

  @IsString() @Length(8, 500)
  @Matches(/^https?:\/\/[^\s,]+$/i, { message: 'API_URL phải là một URL http/https hợp lệ' })
  apiUrl!: string;

  @IsString() @Length(0, 500)
  @Matches(/^$|^https:\/\/[^\s,]+$/i, { message: 'Telegram webhook phải là một URL HTTPS' })
  telegramWebhookUrl!: string;

  @IsString() @Length(0, 500)
  @Matches(/^$|^https:\/\/[^\s,]+$/i, { message: 'QSTASH_URL phải là một URL HTTPS' })
  qstashUrl!: string;

  @IsString() @Length(0, 500)
  @Matches(/^$|^https:\/\/[^\s,]+$/i, { message: 'TASK_BASE_URL phải là một URL HTTPS' })
  taskBaseUrl!: string;

  /** Empty means retain the encrypted database token or environment fallback. */
  @IsOptional() @IsString() @Length(0, 2000)
  qstashToken?: string;
}
