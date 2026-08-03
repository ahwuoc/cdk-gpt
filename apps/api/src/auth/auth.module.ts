import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth.controller';
import { AdminAuthGuard } from './auth.guard';
import { PermissionsGuard } from './permissions.guard';
import { AuthService } from './auth.service';

@Module({
  imports: [JwtModule.register({})], controllers: [AuthController], providers: [AuthService,
    { provide: APP_GUARD, useClass: AdminAuthGuard }, { provide: APP_GUARD, useClass: PermissionsGuard },
  ], exports: [AuthService],
})
export class AuthModule {}
