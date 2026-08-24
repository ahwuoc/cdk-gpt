import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsEnum, IsInt, IsMongoId, IsObject, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { InventoryStatus } from '@store/shared';

export class ImportInventoryDto {
  @IsMongoId() productId!: string;
  @IsArray() @IsObject({ each: true }) rows!: Record<string, unknown>[];
  @IsOptional() @IsString() @Length(1, 255) sourceName?: string;
  @IsOptional() @IsBoolean() overwriteDuplicates = false;
}

/** Safe, paginated view of inventory. Payloads are never accepted or returned here. */
export class InventoryListQueryDto {
  @IsOptional() @IsMongoId() productId?: string;
  @IsOptional() @IsEnum(InventoryStatus) status?: typeof InventoryStatus[keyof typeof InventoryStatus];

  // `search` is kept for the web UI; `query` is the API's documented alias.
  @IsOptional() @IsString() @Length(1, 120) query?: string;
  @IsOptional() @IsString() @Length(1, 120) search?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1_000_000) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
}
