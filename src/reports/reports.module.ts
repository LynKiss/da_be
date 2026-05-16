import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { CategoryEntity } from '../categories/entities/category.entity';
import { CommentEntity } from '../comments/entities/comment.entity';
import { CouponUsageEntity } from '../discounts/entities/coupon-usage.entity';
import { DiscountEntity } from '../discounts/entities/discount.entity';
import { OrderItemEntity } from '../orders/entities/order-item.entity';
import { OrderEntity } from '../orders/entities/order.entity';
import { ReturnEntity } from '../orders/entities/return.entity';
import { PermissionsModule } from '../permissions/permissions.module';
import { PurchaseOrderEntity } from '../procurement/entities/purchase-order.entity';
import { InventoryTransactionEntity } from '../products/entities/inventory-transaction.entity';
import { ProductBatchEntity } from '../products/entities/product-batch.entity';
import { ProductEntity } from '../products/entities/product.entity';
import { RiceDiagnosisHistoryEntity } from '../rice-diagnosis/entities/rice-diagnosis-history.entity';
import { RolesModule } from '../roles/roles.module';
import { DashboardEventsSubscriber } from './dashboard-events.subscriber';
import { DashboardGateway } from './dashboard.gateway';
import { DashboardPublisher } from './dashboard.publisher';
import { UserEntity } from '../users/entities/user.entity';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [
    AuthModule,
    PermissionsModule,
    RolesModule,
    TypeOrmModule.forFeature([
      OrderEntity,
      OrderItemEntity,
      ProductEntity,
      UserEntity,
      InventoryTransactionEntity,
      DiscountEntity,
      CouponUsageEntity,
      PurchaseOrderEntity,
      CategoryEntity,
      CommentEntity,
      RiceDiagnosisHistoryEntity,
      ReturnEntity,
      ProductBatchEntity,
    ]),
  ],
  controllers: [ReportsController],
  providers: [
    ReportsService,
    DashboardPublisher,
    DashboardGateway,
    DashboardEventsSubscriber,
  ],
})
export class ReportsModule {}
