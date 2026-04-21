import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductEntity } from '../products/entities/product.entity';
import { ProductImageEntity } from '../products/entities/product-image.entity';
import { UserEntity } from '../users/entities/user.entity';
import { CartsController } from './carts.controller';
import { CartItemEntity } from './entities/cart-item.entity';
import { ShoppingCartEntity } from './entities/shopping-cart.entity';
import { CartsService } from './carts.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ShoppingCartEntity,
      CartItemEntity,
      ProductEntity,
      ProductImageEntity,
      UserEntity,
    ]),
  ],
  controllers: [CartsController],
  providers: [CartsService],
  exports: [CartsService, TypeOrmModule],
})
export class CartsModule {}
