import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CartItemEntity } from '../carts/entities/cart-item.entity';
import { ShoppingCartEntity } from '../carts/entities/shopping-cart.entity';
import { ProductEntity } from '../products/entities/product.entity';
import { UserEntity } from '../users/entities/user.entity';
import { OrdersController } from './orders.controller';
import { DeliveryMethodEntity } from './entities/delivery-method.entity';
import { OrderItemEntity } from './entities/order-item.entity';
import { OrderStatusHistoryEntity } from './entities/order-status-history.entity';
import { OrderEntity } from './entities/order.entity';
import { ReturnEntity } from './entities/return.entity';
import { ShippingAddressEntity } from './entities/shipping-address.entity';
import { OrdersService } from './orders.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      DeliveryMethodEntity,
      ShippingAddressEntity,
      OrderEntity,
      OrderItemEntity,
      OrderStatusHistoryEntity,
      ReturnEntity,
      ShoppingCartEntity,
      CartItemEntity,
      ProductEntity,
      UserEntity,
    ]),
  ],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService, TypeOrmModule],
})
export class OrdersModule {}
