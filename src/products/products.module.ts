import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationsModule } from '../notifications/notifications.module';
import { CategoryEntity } from '../categories/entities/category.entity';
import { DiscountCategoryEntity } from '../discounts/entities/discount-category.entity';
import { DiscountProductEntity } from '../discounts/entities/discount-product.entity';
import { DiscountEntity } from '../discounts/entities/discount.entity';
import { UserEntity } from '../users/entities/user.entity';
import { WarehouseEntity } from '../warehouses/entities/warehouse.entity';
import { WarehouseStockEntity } from '../warehouses/entities/warehouse-stock.entity';
import { InventoryTransactionEntity } from './entities/inventory-transaction.entity';
import { OriginEntity } from './entities/origin.entity';
import { ProductDescriptionImageEntity } from './entities/product-description-image.entity';
import { ProductImageEntity } from './entities/product-image.entity';
import { ProductTagEntity } from './entities/product-tag.entity';
import { ProductEntity } from './entities/product.entity';
import { SubcategoryEntity } from './entities/subcategory.entity';
import { TagEntity } from './entities/tag.entity';
import { WishlistEntity } from './entities/wishlist.entity';
import { InventoryController } from './inventory.controller';
import { OriginsController } from './origins.controller';
import { OriginsService } from './origins.service';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { SubcategoriesController } from './subcategories.controller';
import { SubcategoriesService } from './subcategories.service';
import { TagsController } from './tags.controller';
import { TagsService } from './tags.service';
import { WishlistController } from './wishlist.controller';

@Module({
  imports: [
    NotificationsModule,
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
      WarehouseEntity,
      WarehouseStockEntity,
      UserEntity,
      DiscountEntity,
      DiscountCategoryEntity,
      DiscountProductEntity,
    ]),
  ],
  controllers: [
    ProductsController,
    InventoryController,
    WishlistController,
    OriginsController,
    SubcategoriesController,
    TagsController,
  ],
  providers: [ProductsService, OriginsService, SubcategoriesService, TagsService],
  exports: [
    ProductsService,
    OriginsService,
    SubcategoriesService,
    TagsService,
    TypeOrmModule,
  ],
})
export class ProductsModule {}
