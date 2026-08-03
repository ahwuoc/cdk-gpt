import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { DomainError } from '@store/shared';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<FastifyReply>();
    if (error instanceof DomainError) return response.status(error.statusCode).send({ code: error.code, message: error.message });
    if (error instanceof HttpException) return response.status(error.getStatus()).send(error.getResponse());
    console.error(error instanceof Error ? { name: error.name, message: error.message } : 'Unknown server error');
    return response.status(500).send({ code: 'INTERNAL_ERROR', message: 'Internal server error' });
  }
}
