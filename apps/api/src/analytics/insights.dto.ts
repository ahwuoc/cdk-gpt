import { IsIn, IsInt, IsMongoId, IsOptional, IsString, Matches, Max, Min, ValidateIf } from 'class-validator';
import { CustomerEventType } from '../../../../packages/database/src/schemas/customer-event.schema';
import type { CustomerEventTypeValue } from '../../../../packages/database/src/schemas/customer-event.schema';

export class AnalyticsInsightsQueryDto {
  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from?: string;

  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to?: string;
}

export class RecordCustomerEventDto {
  @IsString() @Matches(/^\d{1,20}$/)
  telegramId!: string;

  @IsInt() @Min(0) @Max(Number.MAX_SAFE_INTEGER)
  updateId!: number;

  @IsIn(Object.values(CustomerEventType))
  type!: CustomerEventTypeValue;

  @ValidateIf((body: RecordCustomerEventDto) => body.type !== CustomerEventType.MENU_VIEW || body.productId !== undefined)
  @IsMongoId()
  productId?: string;
}
