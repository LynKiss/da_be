import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContactEntity } from '../contacts/entities/contact.entity';
import { CartItemEntity } from '../carts/entities/cart-item.entity';
import { ShoppingCartEntity } from '../carts/entities/shopping-cart.entity';
import { NotificationEntity } from '../notifications/entities/notification.entity';
import { OrderItemEntity } from '../orders/entities/order-item.entity';
import { OrderEntity } from '../orders/entities/order.entity';
import { PaymentTransactionEntity } from '../orders/entities/payment-transaction.entity';
import { ReturnEntity } from '../orders/entities/return.entity';
import { ShippingAddressEntity } from '../orders/entities/shipping-address.entity';
import { WishlistEntity } from '../products/entities/wishlist.entity';
import { RefreshTokenEntity } from './entities/refresh-token.entity';
import { UserEntity } from './entities/user.entity';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      UserEntity,
      RefreshTokenEntity,
      ContactEntity,
      ShoppingCartEntity,
      CartItemEntity,
      NotificationEntity,
      ShippingAddressEntity,
      OrderEntity,
      OrderItemEntity,
      PaymentTransactionEntity,
      ReturnEntity,
      WishlistEntity,
    ]),
  ],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService, TypeOrmModule],
})
export class UsersModule {}
