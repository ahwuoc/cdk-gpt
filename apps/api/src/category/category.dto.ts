import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';

export class SaveCategoryDto {
  @IsString() @Length(2, 120)
  name!: string;

  @IsString() @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  slug!: string;

  @IsOptional() @IsString() @Length(0, 1000)
  description?: string;

  @IsInt() @Min(0)
  sortOrder!: number;
}

export class CategoryQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page = 1;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit = 50;

  @IsOptional() @IsString() @Length(1, 100)
  search?: string;
}
