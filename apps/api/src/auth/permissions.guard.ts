import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import type { AdminClaims } from './auth.service';

const PERMISSIONS = 'permissions';
export const RequirePermissions = (...permissions: string[]) => SetMetadata(PERMISSIONS, permissions);

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(context: ExecutionContext) {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS, [context.getHandler(), context.getClass()]) ?? [];
    if (required.length === 0) return true;
    const claims = context.switchToHttp().getRequest<FastifyRequest & { admin?: AdminClaims }>().admin;
    if (!claims || !required.every((permission) => claims.permissions?.includes('*') || claims.permissions?.includes(permission))) {
      throw new ForbiddenException('Missing required permission');
    }
    return true;
  }
}
