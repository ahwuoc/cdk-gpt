import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import type { AdminClaims } from './auth.service';

const PERMISSIONS = 'permissions';
const ANY_PERMISSIONS = 'any_permissions';
export const RequirePermissions = (...permissions: string[]) => SetMetadata(PERMISSIONS, permissions);
export const RequireAnyPermission = (...permissions: string[]) => SetMetadata(ANY_PERMISSIONS, permissions);

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(context: ExecutionContext) {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS, [context.getHandler(), context.getClass()]) ?? [];
    const anyRequired = this.reflector.getAllAndOverride<string[]>(ANY_PERMISSIONS, [context.getHandler(), context.getClass()]) ?? [];
    const claims = context.switchToHttp().getRequest<FastifyRequest & { admin?: AdminClaims }>().admin;
    const granted = claims?.permissions ?? [];
    const hasAll = required.every((permission) => granted.includes('*') || granted.includes(permission));
    const hasAny = anyRequired.length === 0 || anyRequired.some((permission) => granted.includes('*') || granted.includes(permission));
    if (!claims || !hasAll || !hasAny) {
      throw new ForbiddenException('Missing required permission');
    }
    return true;
  }
}
