import { Module } from '@nestjs/common';
import { MessagingModule } from '../messaging/messaging.module';
import { ProductController } from './product.controller';
import { ProductService } from './product.service';

@Module({ imports: [MessagingModule], controllers: [ProductController], providers: [ProductService], exports: [ProductService] })
export class ProductModule {}
