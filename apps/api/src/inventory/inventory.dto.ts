import { IsArray, IsMongoId, IsObject, IsOptional, IsString, Length } from 'class-validator';

export class ImportInventoryDto {
  @IsMongoId() productId!: string;
  @IsArray() @IsObject({ each: true }) rows!: Record<string, unknown>[];
  @IsOptional() @IsString() @Length(1, 255) sourceName?: string;
}
