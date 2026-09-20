import { Type } from 'class-transformer';
import { IsIn, IsInt, IsMongoId, IsOptional, Max, Min } from 'class-validator';
import { AnalyticsInsightsQueryDto } from './insights.dto';

export class ProductRepeatPurchasesQueryDto extends AnalyticsInsightsQueryDto {
  @IsOptional() @Type(() => Number) @IsIn([2, 3])
  days: 2 | 3 = 2;

  @IsOptional() @IsMongoId()
  productId?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER)
  page = 1;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit = 20;
}
