import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CategoryEntity } from '../categories/entities/category.entity';
import { ProductsController } from './products.controller';
import { ProductEntity } from './entities/product.entity';
import { ProductsService } from './products.service';

@Module({
  imports: [TypeOrmModule.forFeature([ProductEntity, CategoryEntity])],
  controllers: [ProductsController],
  providers: [ProductsService],
  exports: [ProductsService, TypeOrmModule],
})
export class ProductsModule {}
