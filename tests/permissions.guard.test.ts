import { describe, expect, test } from 'bun:test';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { PermissionsGuard } from '../apps/api/src/auth/permissions.guard';

function context(permissions?: string[]) {
  return {
    getHandler: () => function handler() {}, getClass: () => class Controller {},
    switchToHttp: () => ({ getRequest: () => permissions ? { admin: { permissions } } : {} }),
  } as unknown as ExecutionContext;
}

function guard(required: string[], anyRequired: string[]) {
  const reflector = { getAllAndOverride: (key: string) => key === 'permissions' ? required : anyRequired } as unknown as Reflector;
  return new PermissionsGuard(reflector);
}

describe('PermissionsGuard', () => {
  test('allows routes with no permission metadata, including public routes', () => {
    expect(guard([], []).canActivate(context())).toBeTrue();
  });

  test('accepts any one of the configured alternative permissions', () => {
    expect(guard([], ['products.manage', 'inventory.import']).canActivate(context(['inventory.import']))).toBeTrue();
    expect(() => guard([], ['products.manage', 'inventory.import']).canActivate(context(['inventory.read_sensitive']))).toThrow();
  });
});
