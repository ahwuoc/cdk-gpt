import { Body, Controller, Headers, Ip, Post, Req, Res, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AuthService } from './auth.service';
import { LoginDto, RefreshDto } from './auth.dto';
import { PUBLIC_ROUTE } from './auth.guard';

@ApiTags('admin-auth')
@Controller('admin/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  @Post('login') @SetMetadata(PUBLIC_ROUTE, true)
  async login(@Body() body: LoginDto, @Ip() ip: string, @Headers('user-agent') userAgent: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply) {
    const pair = await this.auth.login(body.email, body.password, { ip, userAgent });
    setRefreshCookie(reply, pair.refreshToken, this.auth.refreshCookieMaxAgeSeconds());
    return { accessToken: pair.accessToken };
  }
  @Post('refresh') @SetMetadata(PUBLIC_ROUTE, true)
  async refresh(@Body() body: RefreshDto, @Req() request: FastifyRequest, @Ip() ip: string,
    @Headers('user-agent') userAgent: string | undefined, @Res({ passthrough: true }) reply: FastifyReply) {
    const token = readCookie(request.headers.cookie, 'admin_refresh_token') ?? body?.refreshToken;
    if (!token) throw new UnauthorizedException('Refresh token required');
    const pair = await this.auth.refresh(token, { ip, userAgent });
    setRefreshCookie(reply, pair.refreshToken, this.auth.refreshCookieMaxAgeSeconds());
    return { accessToken: pair.accessToken };
  }
  @Post('logout') @SetMetadata(PUBLIC_ROUTE, true)
  async logout(@Body() body: RefreshDto, @Req() request: FastifyRequest, @Ip() ip: string,
    @Res({ passthrough: true }) reply: FastifyReply) {
    const token = readCookie(request.headers.cookie, 'admin_refresh_token') ?? body?.refreshToken;
    if (token) await this.auth.logout(token, { ip });
    clearRefreshCookie(reply);
    return { loggedOut: true };
  }
}

function readCookie(header: string | undefined, name: string) {
  const prefix = `${name}=`;
  const item = header?.split(';').map((part) => part.trim()).find((part) => part.startsWith(prefix));
  if (!item) return undefined;
  try { return decodeURIComponent(item.slice(prefix.length)); }
  catch { return undefined; }
}

function setRefreshCookie(reply: FastifyReply, token: string, maxAge: number) {
  const attributes = [`admin_refresh_token=${encodeURIComponent(token)}`, 'Path=/api/admin/auth', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`];
  if (isHttpsDeployment()) attributes.push('Secure');
  reply.header('set-cookie', attributes.join('; '));
}

function clearRefreshCookie(reply: FastifyReply) {
  const attributes = ['admin_refresh_token=', 'Path=/api/admin/auth', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (isHttpsDeployment()) attributes.push('Secure');
  reply.header('set-cookie', attributes.join('; '));
}

function isHttpsDeployment() {
  return (process.env.WEB_APP_URL ?? '').split(',').some((url) => url.trim().startsWith('https://'));
}
