import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsOptional,
  IsMongoId, IsString, IsUrl, Length, Matches, Max, Min, ValidateNested,
} from 'class-validator';
import { ProductFieldType } from '@store/database';
import { MAX_WARRANTY_HOURS, ProductStatus } from '@store/shared';

export class ProductFieldDefinitionDto {
  @IsString() @Length(1, 100)
  name!: string;

  @IsString() @Matches(/^(?!\s)(?!.*\s$)[^.$\u0000-\u001F\u007F{}]{1,64}$/u)
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

  @IsOptional() @IsMongoId()
  categoryId?: string;

  @IsArray() @ArrayMaxSize(20) @IsUrl({}, { each: true })
  imageUrls!: string[];

  @IsOptional() @IsString() @Length(0, 20_000)
  instructions?: string;

  @IsOptional() @IsString() @Length(0, 20_000)
  warrantyPolicy?: string;

  @IsInt() @Min(0) @Max(3650)
  warrantyDays!: number;

  /** Optional so legacy clients that only send warrantyDays keep working. */
  @IsOptional() @IsInt() @Min(0) @Max(MAX_WARRANTY_HOURS)
  warrantyHours?: number;

  @IsString() @Length(1, 20_000)
  deliveryTemplate!: string;

  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ArrayUnique((field: ProductFieldDefinitionDto) => field.key)
  @ValidateNested({ each: true }) @Type(() => ProductFieldDefinitionDto)
  fieldDefinitions!: ProductFieldDefinitionDto[];

  @IsOptional() @IsString() @Length(1, 500)
  inventoryPattern?: string;

  @IsInt() @Min(0)
  purchaseLimitPerUser!: number;

  @IsInt() @Min(0)
  lowStockThreshold!: number;

  @IsInt()
  sortOrder!: number;
}
