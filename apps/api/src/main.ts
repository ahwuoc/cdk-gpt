import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { ApiExceptionFilter } from './http-exception.filter';

const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { bufferLogs: true });
app.setGlobalPrefix('api');
app.enableCors({ origin: (process.env.WEB_APP_URL ?? 'http://localhost:3000').split(','), credentials: true });
app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
app.useGlobalFilters(new ApiExceptionFilter());
const document = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('Digital Store API').setVersion('1.0')
  .addBearerAuth().build());
SwaggerModule.setup('api/docs', app, document);
app.enableShutdownHooks();
await app.listen(Number(process.env.PORT ?? 3001), '0.0.0.0');
