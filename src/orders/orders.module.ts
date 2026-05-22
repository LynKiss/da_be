import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CartItemEntity } from '../carts/entities/cart-item.entity';
import { CouponUsageEntity } from '../discounts/entities/coupon-usage.entity';
import { DiscountCategoryEntity } from '../discounts/entities/discount-category.entity';
import { DiscountProductEntity } from '../discounts/entities/discount-product.entity';
import { DiscountEntity } from '../discounts/entities/discount.entity';
import { ShoppingCartEntity } from '../carts/entities/shopping-cart.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuthModule } from '../auth/auth.module';
import { ProductEntity } from '../products/entities/product.entity';
import { InventoryTransactionEntity } from '../products/entities/inventory-transaction.entity';
import { ProductsModule } from '../products/products.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { RolesModule } from '../roles/roles.module';
import { WarehouseEntity } from '../warehouses/entities/warehouse.entity';
import { WarehouseStockEntity } from '../warehouses/entities/warehouse-stock.entity';
import { SettingsModule } from '../settings/settings.module';
import { UserEntity } from '../users/entities/user.entity';
import { DeliveryMethodsController } from './delivery-methods.controller';
import { OrdersController } from './orders.controller';
import { PaymentsController } from './payments.controller';
import { ReturnsController } from './returns.controller';
import { DeliveryMethodEntity } from './entities/delivery-method.entity';
import { DeliveryMethodAreaEntity } from './entities/delivery-method-area.entity';
import { OrderItemEntity } from './entities/order-item.entity';
import { OrderTrackingEntity } from './entities/order-tracking.entity';
import { OrderStatusHistoryEntity } from './entities/order-status-history.entity';
import { OrderEntity } from './entities/order.entity';
import { PaymentTransactionEntity } from './entities/payment-transaction.entity';
import { ReturnEntity } from './entities/return.entity';
import { ShippingAddressEntity } from './entities/shipping-address.entity';
import { OrdersAdminGateway } from './orders-admin.gateway';
import { OrdersAdminPublisher } from './orders-admin.publisher';
import { OrdersService } from './orders.service';
import { MembershipModule } from '../membership/membership.module';
import { CustomerCreditLimitEntity } from '../credit-limits/entities/customer-credit-limit.entity';

@Module({
  imports: [
    AuthModule,
    NotificationsModule,
    PermissionsModule,
    RolesModule,
    SettingsModule,
    MembershipModule,
    ProductsModule,
    TypeOrmModule.forFeature([
      DeliveryMethodEntity,
      DeliveryMethodAreaEntity,
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
      WarehouseEntity,
      WarehouseStockEntity,
      UserEntity,
      DiscountEntity,
      DiscountCategoryEntity,
      DiscountProductEntity,
      CouponUsageEntity,
      PaymentTransactionEntity,
      CustomerCreditLimitEntity,
    ]),
  ],
  controllers: [OrdersController, PaymentsController, ReturnsController, DeliveryMethodsController],
  providers: [OrdersService, OrdersAdminPublisher, OrdersAdminGateway],
  exports: [OrdersService, TypeOrmModule],
})
export class OrdersModule {}
