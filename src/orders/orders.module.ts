import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CartItemEntity } from '../carts/entities/cart-item.entity';
import { CouponUsageEntity } from '../discounts/entities/coupon-usage.entity';
import { DiscountCategoryEntity } from '../discounts/entities/discount-category.entity';
import { DiscountProductEntity } from '../discounts/entities/discount-product.entity';
import { DiscountEntity } from '../discounts/entities/discount.entity';
import { ShoppingCartEntity } from '../carts/entities/shopping-cart.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { ProductEntity } from '../products/entities/product.entity';
import { InventoryTransactionEntity } from '../products/entities/inventory-transaction.entity';
import { SettingsModule } from '../settings/settings.module';
import { UserEntity } from '../users/entities/user.entity';
import { DeliveryMethodsController } from './delivery-methods.controller';
import { OrdersController } from './orders.controller';
import { PaymentsController } from './payments.controller';
import { ReturnsController } from './returns.controller';
import { DeliveryMethodEntity } from './entities/delivery-method.entity';
import { OrderItemEntity } from './entities/order-item.entity';
import { OrderTrackingEntity } from './entities/order-tracking.entity';
import { OrderStatusHistoryEntity } from './entities/order-status-history.entity';
import { OrderEntity } from './entities/order.entity';
import { PaymentTransactionEntity } from './entities/payment-transaction.entity';
import { ReturnEntity } from './entities/return.entity';
import { ShippingAddressEntity } from './entities/shipping-address.entity';
import { OrdersService } from './orders.service';

@Module({
  imports: [
    NotificationsModule,
    SettingsModule,
    TypeOrmModule.forFeature([
      DeliveryMethodEntity,
      ShippingAddressEntity,
      OrderEntity,
      OrderTrackingEntity,
      OrderItemEntity,
      OrderStatusHistoryEntity,
      ReturnEntity,
      ShoppingCartEntity,
      CartItemEntity,
      ProductEntity,
      InventoryTransactionEntity,
      UserEntity,
      DiscountEntity,
      DiscountCategoryEntity,
      DiscountProductEntity,
      CouponUsageEntity,
      PaymentTransactionEntity,
    ]),
  ],
  controllers: [OrdersController, PaymentsController, ReturnsController, DeliveryMethodsController],
  providers: [OrdersService],
  exports: [OrdersService, TypeOrmModule],
})
export class OrdersModule {}
