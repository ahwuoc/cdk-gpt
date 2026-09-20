import { Transform } from 'class-transformer';
import { IsInt, IsMongoId, IsString, Length, Matches, Max, Min, ValidateIf } from 'class-validator';

export class PurchaseDto {
  @IsMongoId() userId!: string;
  @IsMongoId() productId!: string;
  @IsInt() @Min(0) expectedUnitPrice!: number;
  @IsString() @Length(8, 128) idempotencyKey!: string;
}

export class PurchaseQuoteDto {
  @IsMongoId() userId!: string;
  @IsMongoId() productId!: string;
  @IsInt() @Min(0) @Max(Number.MAX_SAFE_INTEGER) expectedUnitPrice!: number;
  @IsInt() @Min(1) @Max(100) quantity!: number;
  @ValidateIf((_, value) => value !== undefined) @Transform(({ value }) => typeof value === 'string' ? value.trim().toUpperCase() : value)
  @IsString() @Matches(/^[A-Z0-9][A-Z0-9_-]{2,39}$/) couponCode?: string;
}
export class PurchaseBatchDto extends PurchaseQuoteDto {
  @IsString() @Length(8, 115) idempotencyPrefix!: string;
  @ValidateIf((_, value) => value !== undefined) @IsInt() @Min(0) @Max(Number.MAX_SAFE_INTEGER) expectedTotalAmount?: number;
}
