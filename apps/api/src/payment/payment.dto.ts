import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsIn, IsInt, IsMongoId, IsOptional, IsString, Length, Matches, Max, Min, ValidateNested } from 'class-validator';

export class CreatePaymentRequestDto {
  @IsMongoId() userId!: string;
  @IsInt() @Min(1) amount!: number;
  @IsString() @Length(2, 50) provider!: string;
  @IsString() @Length(8, 160) idempotencyKey!: string;
}
export class ApprovePaymentRequestDto { @IsString() @Length(8, 160) idempotencyKey!: string; }
export class PaymentWebhookDto {
  @IsString() @Length(2, 50) provider!: string;
  @IsString() @Length(1, 200) providerReference!: string;
  @IsMongoId() userId!: string;
  @IsInt() @Min(1) amount!: number;
}

export class CreateBotDepositDto {
  @IsMongoId() userId!: string;
  @IsInt() @Min(1_000) @Max(9_999_999_999_999)
  amount!: number;
  @IsString() @Length(8, 160)
  idempotencyKey!: string;
}

export class CheckBotDepositDto {
  @IsMongoId()
  userId!: string;
}

export class CakeCallbackTransactionDto {
  @Transform(({ value }) => String(value ?? '').trim())
  @IsString() @Matches(/^\d{1,100}$/, { message: 'transactionID phải là chuỗi số' })
  transactionID!: string;

  @Type(() => Number) @IsInt() @Min(1) @Max(9_999_999_999_999)
  amount!: number;

  @IsString() @Length(0, 1000)
  description!: string;

  @IsOptional() @IsString() @Length(0, 100)
  transactionDate?: string;

  @Transform(({ value }) => String(value ?? 'IN').trim().toUpperCase())
  @IsString() @IsIn(['IN', 'OUT'])
  type: 'IN' | 'OUT' = 'IN';
}

export class CakeCallbackDto {
  @ArrayMinSize(1) @ArrayMaxSize(100)
  @ValidateNested({ each: true }) @Type(() => CakeCallbackTransactionDto)
  transactions!: CakeCallbackTransactionDto[];
}
