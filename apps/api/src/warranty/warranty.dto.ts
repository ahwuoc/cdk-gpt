import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsMongoId, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator';
import { WarrantyStatus } from '@store/database';
import { ComplaintCategory } from '@store/shared';

export const OrderReportStatus = {
  PENDING: WarrantyStatus.PENDING,
  REVIEWING: WarrantyStatus.REVIEWING,
  RESOLVED: WarrantyStatus.RESOLVED,
  REJECTED: WarrantyStatus.REJECTED,
} as const;

export class CreateOrderReportDto {
  @IsMongoId()
  userId!: string;

  @IsMongoId()
  orderId!: string;

  @IsIn(Object.values(ComplaintCategory))
  category!: typeof ComplaintCategory[keyof typeof ComplaintCategory];

  @IsString() @Length(5, 2_000)
  description!: string;
}

export class OrderReportQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page = 1;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit = 20;

  @IsOptional() @IsString() @Length(1, 100)
  search?: string;

  @IsOptional() @IsIn(Object.values(WarrantyStatus))
  status?: typeof WarrantyStatus[keyof typeof WarrantyStatus];

  @IsOptional() @IsIn(Object.values(ComplaintCategory))
  category?: typeof ComplaintCategory[keyof typeof ComplaintCategory];

  @IsOptional() @IsMongoId()
  userId?: string;

  @IsOptional() @IsMongoId()
  orderId?: string;

  @IsOptional() @IsDateString()
  from?: string;

  @IsOptional() @IsDateString()
  to?: string;
}

export class UpdateOrderReportDto {
  @IsIn(Object.values(OrderReportStatus))
  status!: typeof OrderReportStatus[keyof typeof OrderReportStatus];

  @IsOptional() @IsString() @MaxLength(5_000)
  resolutionNote?: string;
}

export class SendOrderReportMessageDto {
  @IsString() @Length(1, 4_000)
  body!: string;
}

export class SendBotOrderReportMessageDto extends SendOrderReportMessageDto {
  @IsMongoId()
  userId!: string;

  @IsString() @Length(8, 160)
  idempotencyKey!: string;
}
