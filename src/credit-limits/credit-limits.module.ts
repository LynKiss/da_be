import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrderEntity } from '../orders/entities/order.entity';
import { UserEntity } from '../users/entities/user.entity';
import { CreditLimitsController } from './credit-limits.controller';
import { CreditLimitsService } from './credit-limits.service';
import { CustomerCreditTransactionEntity } from './entities/customer-credit-transaction.entity';
import { CustomerCreditLimitEntity } from './entities/customer-credit-limit.entity';
import { PaymentTransactionEntity } from '../orders/entities/payment-transaction.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CustomerCreditLimitEntity,
      CustomerCreditTransactionEntity,
      UserEntity,
      OrderEntity,
      PaymentTransactionEntity,
    ]),
  ],
  controllers: [CreditLimitsController],
  providers: [CreditLimitsService],
  exports: [CreditLimitsService],
})
export class CreditLimitsModule {}
