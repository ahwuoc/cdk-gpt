import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { ApiExceptionFilter } from './http-exception.filter';

export interface ApiApplicationOptions {
  /** Swagger is useful in the long-running API, but needlessly increases a Vercel function. */
  enableSwagger?: boolean;
}

/**
 * Creates an initialized API without binding a TCP port. Keeping this separate
 * from main.ts lets the same Nest/Fastify application run behind Docker/Nginx
 * or be invoked through Fastify.inject() from a Vercel Route Handler.
 */
export async function createApiApplication({ enableSwagger = true }: ApiApplicationOptions = {}): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { bufferLogs: true });
  app.setGlobalPrefix('api');
  app.enableCors({ origin: (process.env.WEB_APP_URL ?? 'http://localhost:3000').split(','), credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new ApiExceptionFilter());

  const fastify = app.getHttpAdapter().getInstance();
  fastify.addHook('onSend', async (request, reply, payload) => {
    // Authenticated API responses must never be persisted by a browser/CDN.
    // The static Next.js shell keeps its own cache behaviour.
    if (request.url.startsWith('/api/')) reply.header('cache-control', 'no-store, max-age=0');
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('permissions-policy', 'camera=(), microphone=(), geolocation=()');
    return payload;
  });

  if (enableSwagger) {
    const { DocumentBuilder, SwaggerModule } = await import('@nestjs/swagger');
    const document = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('Digital Store API').setVersion('1.0')
      .addBearerAuth().build());
    SwaggerModule.setup('api/docs', app, document);
  }
  await app.init();
  return app;
}
