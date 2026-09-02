import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';

export class SendDirectMessageDto {
  @Transform(({ value }) => String(value ?? '').trim())
  @Matches(/^-?\d{1,32}$/)
  telegramId!: string;

  @IsString() @Length(1, 4_000)
  body!: string;
}

export class SendBroadcastMessageDto {
  @IsString() @Length(1, 4_000)
  body!: string;
}

export class ReceiveSupportMessageDto {
  @IsString() @Length(1, 4_000)
  body!: string;

  @IsString() @Length(8, 160)
  idempotencyKey!: string;

  @IsString() @Length(24, 24)
  userId!: string;
}

export class AdminMessageQueryDto {
  @IsOptional() @Transform(({ value }) => String(value ?? '').trim()) @Matches(/^-?\d{1,32}$/)
  telegramId?: string;

  @IsOptional() @IsString() @Length(1, 100)
  search?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page = 1;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit = 30;
}

export class AdminConversationQueryDto {
  @IsOptional() @Transform(({ value }) => String(value ?? '').trim()) @IsString() @Length(1, 100)
  search?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page = 1;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit = 50;
}

export class BroadcastQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page = 1;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit = 20;
}
