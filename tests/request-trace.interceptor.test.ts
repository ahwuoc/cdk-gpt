import { expect, test } from 'bun:test';
import { Types } from 'mongoose';
import { lastValueFrom, of } from 'rxjs';
import { RequestTraceInterceptor } from '../apps/api/src/request-trace.interceptor';

test('request tracing records sanitized admin mutation timing under one request ID', async () => {
  const entries: Array<Record<string, unknown>> = [];
  const interceptor = new RequestTraceInterceptor({
    create: async (entry: Record<string, unknown>) => { entries.push(entry); return entry; },
  } as never);
  const responseHeaders: Record<string, string> = {};
  const adminId = new Types.ObjectId().toString();
  const request = {
    method: 'POST', url: '/api/admin/products?preview=false', ip: '127.0.0.1',
    headers: { 'x-request-id': 'trace-test', 'user-agent': 'integration-test' },
    admin: { sub: adminId, type: 'access', permissions: ['*'] },
  };
  const reply = { statusCode: 201, header: (name: string, value: string) => { responseHeaders[name] = value; } };
  const context = { switchToHttp: () => ({ getRequest: () => request, getResponse: () => reply }) };

  const result = await lastValueFrom(interceptor.intercept(context as never, { handle: () => of({ ok: true }) }));

  expect(result).toEqual({ ok: true });
  expect(responseHeaders['x-request-id']).toBe('trace-test');
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({ actorType: 'ADMIN', action: 'HTTP_REQUEST_COMPLETED',
    resourceType: 'HttpRequest', requestId: 'trace-test', ipAddress: '127.0.0.1', userAgent: 'integration-test',
    metadata: { method: 'POST', path: '/api/admin/products', statusCode: 201, success: true } });
  expect((entries[0]?.metadata as { durationMs: number }).durationMs).toBeGreaterThanOrEqual(0);
  expect(JSON.stringify(entries[0])).not.toContain('preview=false');
});
