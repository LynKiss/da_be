import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CartsController } from './carts.controller';
import { CartItemEntity } from './entities/cart-item.entity';
import { ShoppingCartEntity } from './entities/shopping-cart.entity';
import { CartsService } from './carts.service';

@Module({
  imports: [TypeOrmModule.forFeature([ShoppingCartEntity, CartItemEntity])],
  controllers: [CartsController],
  providers: [CartsService],
  exports: [CartsService, TypeOrmModule],
})
export class CartsModule {}
