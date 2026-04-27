import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DiscountEntity } from '../discounts/entities/discount.entity';
import { NewsEntity } from '../news/entities/news.entity';
import { OrderEntity } from '../orders/entities/order.entity';
import { ProductEntity } from '../products/entities/product.entity';
import { SupplierEntity } from '../suppliers/entities/supplier.entity';
import { UserEntity } from '../users/entities/user.entity';
import { WarehouseEntity } from '../warehouses/entities/warehouse.entity';
import { AdminSearchController } from './admin-search.controller';
import { AdminSearchService } from './admin-search.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ProductEntity,
      OrderEntity,
      UserEntity,
      SupplierEntity,
      NewsEntity,
      DiscountEntity,
      WarehouseEntity,
    ]),
  ],
  controllers: [AdminSearchController],
  providers: [AdminSearchService],
})
export class AdminSearchModule {}
