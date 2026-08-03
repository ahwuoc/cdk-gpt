import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import type { Model, Types } from 'mongoose';
import bcrypt from 'bcryptjs';
import { createHash, randomUUID } from 'node:crypto';
import { loadConfig } from '@store/config';
import { Admin, RefreshToken, Role } from '@store/database';

export interface AdminClaims { sub: string; type: 'access' | 'refresh'; permissions?: string[]; familyId?: string; jti?: string; }

@Injectable()
export class AuthService {
  private readonly config = loadConfig();
  constructor(
    @InjectModel('Admin') private readonly admins: Model<Admin>,
    @InjectModel('Role') private readonly roles: Model<Role>,
    @InjectModel('RefreshToken') private readonly refreshTokens: Model<RefreshToken>,
    private readonly jwt: JwtService,
  ) {}

  async login(email: string, password: string, context: { ip?: string; userAgent?: string }) {
    const admin = await this.admins.findOne({ email: email.toLowerCase(), status: 'ACTIVE', deletedAt: null }).select('+passwordHash');
    if (!admin || !await bcrypt.compare(password, admin.passwordHash)) throw new UnauthorizedException('Invalid credentials');
    admin.lastLoginAt = new Date(); await admin.save();
    return this.issuePair(admin, randomUUID(), context);
  }

  async refresh(rawToken: string, context: { ip?: string; userAgent?: string }) {
    let claims: AdminClaims;
    try { claims = await this.jwt.verifyAsync<AdminClaims>(rawToken, { secret: this.config.jwtRefreshSecret }); }
    catch { throw new UnauthorizedException('Invalid refresh token'); }
    if (claims.type !== 'refresh' || !claims.familyId) throw new UnauthorizedException('Invalid refresh token type');
    const hash = this.hash(rawToken);
    const stored = await this.refreshTokens.findOne({ tokenHash: hash }).select('+tokenHash');
    if (!stored || stored.expiresAt <= new Date()) throw new UnauthorizedException('Refresh token expired');
    if (stored.revokedAt) {
      await this.refreshTokens.updateMany({ familyId: claims.familyId, revokedAt: { $exists: false } }, { $set: { revokedAt: new Date(), revokedByIp: context.ip } });
      throw new UnauthorizedException('Refresh token reuse detected');
    }
    const admin = await this.admins.findOne({ _id: claims.sub, status: 'ACTIVE', deletedAt: null });
    if (!admin) throw new UnauthorizedException('Admin account unavailable');
    const pair = await this.issuePair(admin, claims.familyId, context);
    stored.revokedAt = new Date(); stored.revokedByIp = context.ip; stored.replacedByTokenHash = this.hash(pair.refreshToken);
    await stored.save();
    return pair;
  }

  async verifyAccess(token: string) {
    const claims = await this.jwt.verifyAsync<AdminClaims>(token, { secret: this.config.jwtAccessSecret });
    if (claims.type !== 'access') throw new UnauthorizedException('Invalid access token type');
    return claims;
  }

  private async issuePair(admin: { _id: Types.ObjectId; roleIds: Types.ObjectId[] }, familyId: string, context: { ip?: string; userAgent?: string }) {
    const roles = await this.roles.find({ _id: { $in: admin.roleIds }, deletedAt: null }).select('permissions').lean();
    const permissions = [...new Set(roles.flatMap((role) => role.permissions))];
    const accessToken = await this.jwt.signAsync({ sub: admin._id.toString(), type: 'access', permissions } satisfies AdminClaims,
      { secret: this.config.jwtAccessSecret, expiresIn: this.config.jwtAccessExpiresIn as never });
    const jti = randomUUID();
    const refreshToken = await this.jwt.signAsync({ sub: admin._id.toString(), type: 'refresh', familyId, jti } satisfies AdminClaims,
      { secret: this.config.jwtRefreshSecret, expiresIn: this.config.jwtRefreshExpiresIn as never });
    await this.refreshTokens.create({ adminId: admin._id, tokenHash: this.hash(refreshToken), familyId,
      expiresAt: new Date(Date.now() + parseDuration(this.config.jwtRefreshExpiresIn)), createdByIp: context.ip, userAgent: context.userAgent });
    return { accessToken, refreshToken };
  }

  private hash(token: string) { return createHash('sha256').update(token).digest('hex'); }
}

function parseDuration(value: string): number {
  const match = /^(\d+)(s|m|h|d)$/.exec(value);
  if (!match) throw new Error(`Unsupported duration ${value}`);
  const units = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const;
  return Number(match[1]) * units[match[2] as keyof typeof units];
}
