import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsOptional,
  IsString, IsUrl, Length, Matches, Max, Min, ValidateNested,
} from 'class-validator';
import { ProductFieldType } from '@store/database';
import { ProductStatus } from '@store/shared';

export class ProductFieldDefinitionDto {
  @IsString() @Length(2, 100)
  name!: string;

  @IsString() @Matches(/^[a-z][a-zA-Z0-9_]{1,63}$/)
  key!: string;

  @IsIn(Object.values(ProductFieldType))
  type!: typeof ProductFieldType[keyof typeof ProductFieldType];

  @IsBoolean()
  sensitive!: boolean;

  @IsBoolean()
  visibleToCustomer!: boolean;

  @IsBoolean()
  required!: boolean;

  @IsInt()
  sortOrder!: number;
}

export class SaveProductDto {
  @IsString() @Length(2, 200)
  name!: string;

  @IsString() @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  slug!: string;

  @IsString() @Length(1, 10_000)
  description!: string;

  @IsInt() @Min(0)
  price!: number;

  @IsIn([ProductStatus.DRAFT, ProductStatus.ACTIVE, ProductStatus.INACTIVE])
  status!: typeof ProductStatus.DRAFT | typeof ProductStatus.ACTIVE | typeof ProductStatus.INACTIVE;

  @IsArray() @ArrayMaxSize(20) @IsUrl({}, { each: true })
  imageUrls!: string[];

  @IsOptional() @IsString() @Length(0, 20_000)
  instructions?: string;

  @IsOptional() @IsString() @Length(0, 20_000)
  warrantyPolicy?: string;

  @IsInt() @Min(0) @Max(3650)
  warrantyDays!: number;

  @IsString() @Length(1, 20_000)
  deliveryTemplate!: string;

  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ArrayUnique((field: ProductFieldDefinitionDto) => field.key)
  @ValidateNested({ each: true }) @Type(() => ProductFieldDefinitionDto)
  fieldDefinitions!: ProductFieldDefinitionDto[];

  @IsInt() @Min(0)
  purchaseLimitPerUser!: number;

  @IsInt() @Min(0)
  lowStockThreshold!: number;

  @IsInt()
  sortOrder!: number;
}
