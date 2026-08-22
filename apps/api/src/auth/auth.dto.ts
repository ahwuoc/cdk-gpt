import { IsEmail, IsOptional, IsString, Length } from 'class-validator';

export class LoginDto {
  @IsEmail() email!: string;
  @IsString() @Length(8, 200) password!: string;
}
export class RefreshDto {
  @IsOptional()
  @IsString() @Length(20, 4096) refreshToken!: string;
}
