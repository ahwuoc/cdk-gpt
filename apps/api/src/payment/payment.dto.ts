import { IsInt, IsMongoId, IsString, Length, Max, Min } from 'class-validator';

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
