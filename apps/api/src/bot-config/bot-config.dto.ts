import { IsString, Length, Matches } from 'class-validator';

export class UpdateBotTokenDto {
  @IsString()
  @Length(30, 200)
  @Matches(/^\d{6,15}:[A-Za-z0-9_-]{20,}$/)
  token!: string;
}
