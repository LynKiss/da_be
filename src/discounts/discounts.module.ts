import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DiscountsController } from './discounts.controller';
import { CouponUsageEntity } from './entities/coupon-usage.entity';
import { DiscountCategoryEntity } from './entities/discount-category.entity';
import { DiscountProductEntity } from './entities/discount-product.entity';
import { DiscountEntity } from './entities/discount.entity';
import { DiscountsService } from './discounts.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      DiscountEntity,
      DiscountCategoryEntity,
      DiscountProductEntity,
      CouponUsageEntity,
    ]),
  ],
  controllers: [DiscountsController],
  providers: [DiscountsService],
  exports: [DiscountsService, TypeOrmModule],
})
export class DiscountsModule {}
