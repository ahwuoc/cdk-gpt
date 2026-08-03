import { Body, Controller, Headers, Ip, Post, SetMetadata } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LoginDto, RefreshDto } from './auth.dto';
import { PUBLIC_ROUTE } from './auth.guard';

@ApiTags('admin-auth')
@Controller('admin/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  @Post('login') @SetMetadata(PUBLIC_ROUTE, true)
  login(@Body() body: LoginDto, @Ip() ip: string, @Headers('user-agent') userAgent?: string) {
    return this.auth.login(body.email, body.password, { ip, userAgent });
  }
  @Post('refresh') @SetMetadata(PUBLIC_ROUTE, true)
  refresh(@Body() body: RefreshDto, @Ip() ip: string, @Headers('user-agent') userAgent?: string) {
    return this.auth.refresh(body.refreshToken, { ip, userAgent });
  }
}
