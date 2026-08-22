import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApiApplication } from './app.factory';

declare global {
  // Vercel reuses a warm Node.js isolate. Store one initialized Nest app per
  // isolate so every request does not open a new MongoDB connection pool.
  var __digitalStoreServerlessApi: Promise<NestFastifyApplication> | undefined;
}

export function getServerlessApi() {
  if (!globalThis.__digitalStoreServerlessApi) {
    // Swagger is served by the Docker/VPS API only. Leaving it out keeps the
    // serverless function cold start and bundle size lower.
    const created = createApiApplication({ enableSwagger: false });
    globalThis.__digitalStoreServerlessApi = created.catch((error) => {
      // Do not poison future cold/warm invocations after a transient Atlas or
      // configuration failure.
      globalThis.__digitalStoreServerlessApi = undefined;
      throw error;
    });
  }
  return globalThis.__digitalStoreServerlessApi;
}
