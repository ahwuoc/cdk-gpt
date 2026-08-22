import { CallHandler, ExecutionContext, HttpException, Injectable, NestInterceptor } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { catchError, concatMap, dematerialize, from, map, materialize, of, type Observable } from 'rxjs';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AuditLog } from '@store/database';
import type { AdminClaims } from './auth/auth.service';

/**
 * Records one sanitized timing event for operational mutations. Domain audit
 * entries reuse x-request-id, so the admin can correlate a request with every
 * product/inventory/config change it caused without storing request payloads.
 */
@Injectable()
export class RequestTraceInterceptor implements NestInterceptor {
  constructor(@InjectModel('AuditLog') private readonly audits: Model<AuditLog>) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<FastifyRequest & { admin?: AdminClaims }>();
    const reply = context.switchToHttp().getResponse<FastifyReply>();
    const requestId = traceId(request.headers['x-request-id']);
    reply.header('x-request-id', requestId);
    if (!shouldTrace(request)) return next.handle();

    const startedAt = Date.now();
    return next.handle().pipe(
      materialize(),
      concatMap((notification) => {
        if (notification.kind === 'C') return of(notification);
        const failed = notification.kind === 'E';
        const statusCode = failed ? errorStatus(notification.error) : reply.statusCode;
        const actorId = request.admin?.sub && Types.ObjectId.isValid(request.admin.sub)
          ? new Types.ObjectId(request.admin.sub) : undefined;
        return from(this.audits.create({
          actorType: actorId ? 'ADMIN' : 'SYSTEM', actorId,
          action: failed ? 'HTTP_REQUEST_FAILED' : 'HTTP_REQUEST_COMPLETED',
          resourceType: 'HttpRequest', requestId,
          ipAddress: request.ip, userAgent: headerValue(request.headers['user-agent']),
          metadata: {
            method: request.method,
            path: request.url.split('?')[0],
            statusCode,
            durationMs: Date.now() - startedAt,
            success: !failed && statusCode < 400,
          },
        })).pipe(
          catchError((error) => {
            console.error(error instanceof Error
              ? { name: error.name, message: error.message, context: 'request-trace' }
              : { context: 'request-trace', message: 'Unknown audit write error' });
            return of(undefined);
          }),
          map(() => notification),
        );
      }),
      dematerialize(),
    );
  }
}

function shouldTrace(request: FastifyRequest) {
  if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') return false;
  return /^\/api\/(admin|webhooks|internal|telegram)(?:\/|$)/.test(request.url);
}

function traceId(value: string | string[] | undefined) {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate?.trim().slice(0, 128) || randomUUID();
}

function errorStatus(error: unknown) {
  return error instanceof HttpException ? error.getStatus() : 500;
}

function headerValue(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value)?.slice(0, 1000);
}
