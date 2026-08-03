import { IsInt, IsMongoId, IsString, Length, Min } from 'class-validator';

export class PurchaseDto {
  @IsMongoId() userId!: string;
  @IsMongoId() productId!: string;
  @IsInt() @Min(0) expectedUnitPrice!: number;
  @IsString() @Length(8, 128) idempotencyKey!: string;
}
