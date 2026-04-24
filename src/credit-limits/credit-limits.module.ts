import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrderEntity } from '../orders/entities/order.entity';
import { UserEntity } from '../users/entities/user.entity';
import { CreditLimitsController } from './credit-limits.controller';
import { CreditLimitsService } from './credit-limits.service';
import { CustomerCreditLimitEntity } from './entities/customer-credit-limit.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([CustomerCreditLimitEntity, UserEntity, OrderEntity]),
  ],
  controllers: [CreditLimitsController],
  providers: [CreditLimitsService],
  exports: [CreditLimitsService],
})
export class CreditLimitsModule {}
