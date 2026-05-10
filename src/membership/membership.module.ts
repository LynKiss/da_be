import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserEntity } from '../users/entities/user.entity';
import { OrderEntity } from '../orders/entities/order.entity';
import { DiscountEntity } from '../discounts/entities/discount.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuthModule } from '../auth/auth.module';
import { SettingsModule } from '../settings/settings.module';
import { MembershipService } from './membership.service';
import { MembershipController } from './membership.controller';

@Module({
  imports: [
    AuthModule,
    NotificationsModule,
    SettingsModule,
    TypeOrmModule.forFeature([UserEntity, OrderEntity, DiscountEntity]),
  ],
  controllers: [MembershipController],
  providers: [MembershipService],
  exports: [MembershipService],
})
export class MembershipModule {}
