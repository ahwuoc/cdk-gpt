import { Controller, Get, SetMetadata } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { PUBLIC_ROUTE } from './auth/auth.guard';

@Controller()
export class AppController {
  constructor(@InjectConnection() private readonly connection: Connection) {}
  @Get('health') @SetMetadata(PUBLIC_ROUTE, true)
  health() { return { status: this.connection.readyState === 1 ? 'ok' : 'degraded', database: this.connection.readyState }; }
}
