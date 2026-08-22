import { Type } from 'class-transformer';
import { IsIn, IsInt, IsMongoId, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { ProductStatus } from '@store/shared';

export class ProductQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page = 1;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit = 20;

  @IsOptional() @IsString() @Length(1, 100)
  search?: string;

  @IsOptional() @IsMongoId()
  categoryId?: string;

  @IsOptional() @IsIn(Object.values(ProductStatus))
  status?: typeof ProductStatus[keyof typeof ProductStatus];
}
