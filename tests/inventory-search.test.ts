import 'reflect-metadata';
import { describe, expect, test } from 'bun:test';
import { BadRequestException, Module, RequestMethod, ValidationPipe } from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyRequest } from 'fastify';
import { validate } from 'class-validator';
import { MAX_INVENTORY_BULK_SEARCH_TERMS, normalizeInventorySearchTerms } from '@store/shared';
import { InventoryListQueryDto } from '../apps/api/src/inventory/inventory.dto';
import { InventoryController } from '../apps/api/src/inventory/inventory.controller';
import { InventoryAdminService } from '../apps/api/src/inventory/inventory-admin.service';
import { InventoryImportService } from '../apps/api/src/inventory/inventory-import.service';
import { InventoryReservationService } from '../apps/api/src/inventory/inventory-reservation.service';
import { PermissionsGuard } from '../apps/api/src/auth/permissions.guard';

describe('inventory bulk search', () => {
  test('extracts the email from bulk credential lines', () => {
    expect(normalizeInventorySearchTerms([
      'first@example.com----password-1----ABC123',
      '',
      'second@example.com----password-2----XYZ789',
    ].join('\n'))).toEqual(['first@example.com', 'second@example.com']);
  });

  test('keeps ordinary searches and removes case-insensitive duplicates', () => {
    expect(normalizeInventorySearchTerms([
      'Single@Example.com',
      'single@example.com----another-password----2FA',
      '66f012345678901234567890',
    ].join('\r\n'))).toEqual(['Single@Example.com', '66f012345678901234567890']);
  });

  test('rejects excess bulk terms instead of silently ignoring accounts', () => {
    const input = Array.from({ length: MAX_INVENTORY_BULK_SEARCH_TERMS + 10 }, (_, index) => `user${index}@example.com`).join('\n');
    expect(() => normalizeInventorySearchTerms(input)).toThrow('100');
  });

  test('rejects a long login instead of searching a truncated prefix', () => {
    expect(() => normalizeInventorySearchTerms('a'.repeat(121))).toThrow('120');
  });

  test('rejects credential lines missing their login instead of clearing the search', () => {
    expect(() => normalizeInventorySearchTerms('----password----2fa')).toThrow('email/login');
    expect(() => normalizeInventorySearchTerms('valid@example.com\n  ----password----2fa')).toThrow('email/login');
  });

  test('allows an empty search to clear the filter', () => {
    expect(normalizeInventorySearchTerms(' \r\n\t')).toEqual([]);
  });

  test('both API aliases accept the largest normalized bulk search including separators', async () => {
    const input = Array.from({ length: MAX_INVENTORY_BULK_SEARCH_TERMS }, (_, index) =>
      String(index).padStart(3, '0') + 'a'.repeat(117)).join('\n');
    const search = normalizeInventorySearchTerms(input).join('\n');
    expect(search).toHaveLength(12_099);
    const dto = Object.assign(new InventoryListQueryDto(), { query: search, search });
    expect((await validate(dto)).map((error) => error.constraints)).toEqual([]);
  });
});

describe('inventory search API', () => {
  test('invalid searches fail with HTTP 400 before reading inventory', async () => {
    // Invalid input must fail before a database or encryption dependency is used.
    const service: InventoryAdminService = Object.create(InventoryAdminService.prototype);
    for (const search of ['----private-password----2fa', 'a'.repeat(121),
      Array.from({ length: 101 }, (_, index) => `user${index}@example.com`).join('\n')]) {
      await expect(service.list({ page: 1, limit: 20, search })).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  test('POST search retains GET inventory permissions and is not public', () => {
    const search = InventoryController.prototype.search;
    expect(Reflect.getMetadata('any_permissions', search)).toEqual(['inventory.manage', 'inventory.import']);
    expect(Reflect.getMetadata('any_permissions', search)).toEqual(Reflect.getMetadata('any_permissions', InventoryController.prototype.list));
    expect(Reflect.getMetadata('public-route', search)).not.toBe(true);
    expect(Reflect.getMetadata('path', search)).toBe('search');
    expect(Reflect.getMetadata('method', search)).toBe(RequestMethod.POST);
  });

  test('POST accepts long searches in the body with filters, paging, validation and permissions', async () => {
    const forwarded: InventoryListQueryDto[] = [];
    @Module({
      controllers: [InventoryController],
      providers: [
        { provide: InventoryAdminService, useValue: { list(query: InventoryListQueryDto) {
          forwarded.push(query);
          return { items: [], page: query.page, limit: query.limit, total: 0, totalPages: 0 };
        } } },
        { provide: InventoryImportService, useValue: {} },
        { provide: InventoryReservationService, useValue: {} },
      ],
    })
    class SearchTestModule {}
    const app = await NestFactory.create<NestFastifyApplication>(SearchTestModule, new FastifyAdapter(), { logger: false });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalGuards(new PermissionsGuard(new Reflector()));
    app.getHttpAdapter().getInstance().addHook('onRequest', async (request: FastifyRequest & { admin?: { permissions: string[] } }) => {
      request.admin = { permissions: String(request.headers['x-test-permission'] ?? '').split(',') };
    });
    try {
      await app.init();
      const payload: InventoryListQueryDto = { productId: '66f012345678901234567890', status: 'AVAILABLE', page: 2, limit: 10,
        search: Array.from({ length: 100 }, (_, index) => String(index).padStart(3, '0') + 'a'.repeat(117)).join('\n') };
      for (const permission of ['inventory.manage', 'inventory.import']) {
        const response = await app.inject({ method: 'POST', url: '/admin/inventory/search', payload: { ...payload, page: '2', limit: '10' },
          headers: { 'x-test-permission': permission } });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({ page: 2, limit: 10, total: 0 });
        expect(forwarded.at(-1)).toEqual(payload);
      }
      const denied = await app.inject({ method: 'POST', url: '/admin/inventory/search', payload,
        headers: { 'x-test-permission': 'analytics.read' } });
      expect(denied.statusCode).toBe(403);
      const invalid = await app.inject({ method: 'POST', url: '/admin/inventory/search', payload: { ...payload, limit: 101 },
        headers: { 'x-test-permission': 'inventory.manage' } });
      expect(invalid.statusCode).toBe(400);
      expect(forwarded).toHaveLength(2);
    } finally { await app.close(); }
  });
});
