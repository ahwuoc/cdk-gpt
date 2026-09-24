import { PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsMongoId,
  IsOptional, IsString, Length, Matches, Max, Min, ValidateIf } from 'class-validator';

export class CouponFieldsDto {
  @IsIn(['PERCENT', 'FIXED']) type!: 'PERCENT' | 'FIXED';
  @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER) value!: number;
  @ValidateIf((_, value) => value !== undefined) @IsInt() @Min(0) @Max(Number.MAX_SAFE_INTEGER) minSubtotal?: number;
  @IsOptional() @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER) maxDiscount?: number | null;
  @IsOptional() @IsDateString() startsAt?: string | null;
  @IsOptional() @IsDateString() endsAt?: string | null;
  @IsOptional() @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER) usageLimit?: number | null;
  @ValidateIf((_, value) => value !== undefined) @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER) perUserLimit?: number;
  @ValidateIf((_, value) => value !== undefined) @IsArray() @ArrayMaxSize(100) @ArrayUnique() @IsMongoId({ each: true }) productIds?: string[];
  @ValidateIf((_, value) => value !== undefined) @IsBoolean() active?: boolean;
}
export class CreateCouponDto extends CouponFieldsDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toUpperCase() : value)
  @IsString() @Matches(/^[A-Z0-9][A-Z0-9_-]{2,39}$/) code!: string;
}
export class UpdateCouponDto extends PartialType(CouponFieldsDto, { skipNullProperties: false }) {}
export class CouponQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100000) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
  @IsOptional() @IsString() @Length(0, 100) q?: string;
  @IsOptional() @IsIn(['true', 'false']) active?: 'true' | 'false';
}

/** Query used by the bot; the user id is trusted only after normal DTO validation. */
export class BotCouponQueryDto {
  @IsMongoId() userId!: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100000)
  page = 1;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5)
  limit = 5;
}
