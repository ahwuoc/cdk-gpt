import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsMongoId, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { DeliveryStatus, OrderStatus, PaymentRequestStatus } from '@store/shared';

class PaginatedHistoryQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page = 1;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit = 20;

  @IsOptional() @IsString() @Length(1, 100)
  search?: string;

  @IsOptional() @IsDateString()
  from?: string;

  @IsOptional() @IsDateString()
  to?: string;
}

export class OrderHistoryQueryDto extends PaginatedHistoryQueryDto {
  @IsOptional() @IsMongoId()
  userId?: string;

  @IsOptional() @IsMongoId()
  productId?: string;

  @IsOptional() @IsIn(Object.values(OrderStatus))
  status?: typeof OrderStatus[keyof typeof OrderStatus];

  @IsOptional() @IsIn(Object.values(DeliveryStatus))
  deliveryStatus?: typeof DeliveryStatus[keyof typeof DeliveryStatus];
}

export class DepositHistoryQueryDto extends PaginatedHistoryQueryDto {
  @IsOptional() @IsMongoId()
  userId?: string;

  @IsOptional() @IsIn(Object.values(PaymentRequestStatus))
  status?: typeof PaymentRequestStatus[keyof typeof PaymentRequestStatus];

  @IsOptional() @IsString() @Length(1, 50)
  provider?: string;
}
