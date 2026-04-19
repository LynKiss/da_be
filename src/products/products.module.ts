import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CategoryEntity } from '../categories/entities/category.entity';
import { DiscountCategoryEntity } from '../discounts/entities/discount-category.entity';
import { DiscountProductEntity } from '../discounts/entities/discount-product.entity';
import { DiscountEntity } from '../discounts/entities/discount.entity';
import { UserEntity } from '../users/entities/user.entity';
import { InventoryTransactionEntity } from './entities/inventory-transaction.entity';
import { OriginEntity } from './entities/origin.entity';
import { ProductDescriptionImageEntity } from './entities/product-description-image.entity';
import { ProductImageEntity } from './entities/product-image.entity';
import { ProductTagEntity } from './entities/product-tag.entity';
import { InventoryController } from './inventory.controller';
import { ProductsController } from './products.controller';
import { SubcategoryEntity } from './entities/subcategory.entity';
import { TagEntity } from './entities/tag.entity';
import { WishlistEntity } from './entities/wishlist.entity';
import { WishlistController } from './wishlist.controller';
import { ProductEntity } from './entities/product.entity';
import { ProductsService } from './products.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ProductEntity,
      CategoryEntity,
      SubcategoryEntity,
      OriginEntity,
      TagEntity,
      ProductImageEntity,
      ProductDescriptionImageEntity,
      ProductTagEntity,
      InventoryTransactionEntity,
      WishlistEntity,
      UserEntity,
      DiscountEntity,
      DiscountCategoryEntity,
      DiscountProductEntity,
    ]),
  ],
  controllers: [ProductsController, InventoryController, WishlistController],
  providers: [ProductsService],
  exports: [ProductsService, TypeOrmModule],
})
export class ProductsModule {}
