import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsString, Length, Max, Min } from 'class-validator';

export class AdminWalletAdjustmentDto {
  @Transform(({ value }) => String(value ?? '').trim().toUpperCase())
  @IsIn(['CREDIT', 'DEBIT'])
  direction!: 'CREDIT' | 'DEBIT';

  @Type(() => Number) @IsInt() @Min(1) @Max(9_999_999_999_999)
  amount!: number;

  @Transform(({ value }) => String(value ?? '').trim())
  @IsString() @Length(3, 500)
  reason!: string;
}
