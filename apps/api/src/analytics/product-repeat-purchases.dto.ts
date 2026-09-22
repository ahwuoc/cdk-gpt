import { Type } from 'class-transformer';
import { IsIn, IsInt, IsMongoId, IsOptional, Max, Min } from 'class-validator';
import { AnalyticsInsightsQueryDto } from './insights.dto';

export class ProductRepeatPurchasesQueryDto extends AnalyticsInsightsQueryDto {
  @IsOptional() @IsIn(['1'])
  refresh?: '1';

  @IsOptional() @Type(() => Number) @IsInt() @Min(2) @Max(366)
  days = 2;

  @IsOptional() @Type(() => Number) @IsInt() @Min(2) @Max(366)
  maxDays?: number;

  @IsOptional() @IsMongoId()
  productId?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER)
  page = 1;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit = 20;
}
