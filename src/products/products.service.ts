import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { NotificationChannel } from '../notifications/entities/notification.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { CategoryEntity } from '../categories/entities/category.entity';
import { DiscountCategoryEntity } from '../discounts/entities/discount-category.entity';
import {
  DiscountApplyTarget,
  DiscountEntity,
  DiscountType,
} from '../discounts/entities/discount.entity';
import { DiscountProductEntity } from '../discounts/entities/discount-product.entity';
import { UserEntity } from '../users/entities/user.entity';
import {
  AdjustInventoryDto,
  InventoryAdjustmentMode,
} from './dto/adjust-inventory.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { ImportInventoryDto } from './dto/import-inventory.dto';
import { QueryInventoryTransactionsDto } from './dto/query-inventory-transactions.dto';
import {
  ProductSortBy,
  QueryProductsDto,
  SortOrder,
} from './dto/query-products.dto';
import {
  RecordDamageDto,
  RecordReturnDto,
} from './dto/record-damage-return.dto';
import { ReorderImagesDto } from './dto/reorder-images.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import {
  InventoryTransactionEntity,
  InventoryTransactionType,
} from './entities/inventory-transaction.entity';
import { OriginEntity } from './entities/origin.entity';
import { ProductDescriptionImageEntity } from './entities/product-description-image.entity';
import { ProductEntity } from './entities/product.entity';
import { ProductImageEntity } from './entities/product-image.entity';
import { ProductTagEntity } from './entities/product-tag.entity';
import { SubcategoryEntity } from './entities/subcategory.entity';
import { TagEntity } from './entities/tag.entity';
import { WishlistEntity } from './entities/wishlist.entity';

type UploadedImageFile = {
  buffer: Buffer;
  mimetype: string;
  size: number;
  originalname: string;
};

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(ProductEntity)
    private readonly productsRepository: Repository<ProductEntity>,
    @InjectRepository(ProductImageEntity)
    private readonly productImagesRepository: Repository<ProductImageEntity>,
    @InjectRepository(ProductDescriptionImageEntity)
    private readonly productDescriptionImagesRepository: Repository<ProductDescriptionImageEntity>,
    @InjectRepository(CategoryEntity)
    private readonly categoriesRepository: Repository<CategoryEntity>,
    @InjectRepository(SubcategoryEntity)
    private readonly subcategoriesRepository: Repository<SubcategoryEntity>,
    @InjectRepository(OriginEntity)
    private readonly originsRepository: Repository<OriginEntity>,
    @InjectRepository(TagEntity)
    private readonly tagsRepository: Repository<TagEntity>,
    @InjectRepository(ProductTagEntity)
    private readonly productTagsRepository: Repository<ProductTagEntity>,
    @InjectRepository(InventoryTransactionEntity)
    private readonly inventoryTransactionsRepository: Repository<InventoryTransactionEntity>,
    @InjectRepository(WishlistEntity)
    private readonly wishlistRepository: Repository<WishlistEntity>,
    @InjectRepository(UserEntity)
    private readonly usersRepository: Repository<UserEntity>,
    @InjectRepository(DiscountEntity)
    private readonly discountsRepository: Repository<DiscountEntity>,
    @InjectRepository(DiscountCategoryEntity)
    private readonly discountCategoriesRepository: Repository<DiscountCategoryEntity>,
    @InjectRepository(DiscountProductEntity)
    private readonly discountProductsRepository: Repository<DiscountProductEntity>,
    private readonly notificationsService: NotificationsService,
  ) {}

  // ─── PRODUCTS ────────────────────────────────────────────────────────────────

  async findAll(query: QueryProductsDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const sortBy = query.sortBy ?? ProductSortBy.CREATED_AT;
    const sortOrder = query.sortOrder ?? SortOrder.DESC;

    const queryBuilder = this.productsRepository.createQueryBuilder('product');

    if (query.search) {
      queryBuilder.andWhere(
        '(product.product_name LIKE :search OR product.product_slug LIKE :search)',
        { search: `%${query.search}%` },
      );
    }

    if (query.categoryId) {
      const categoryIds = await this.collectCategoryIds(query.categoryId);
      queryBuilder.andWhere('product.category_id IN (:...categoryIds)', {
        categoryIds,
      });
    }

    if (query.subcategoryId) {
      queryBuilder.andWhere('product.subcategory_id = :subcategoryId', {
        subcategoryId: query.subcategoryId,
      });
    }

    if (query.originId) {
      queryBuilder.andWhere('product.origin_id = :originId', {
        originId: query.originId,
      });
    }

    if (query.tagId) {
      queryBuilder
        .innerJoin(
          'product_tags',
          'pt',
          'pt.product_id = product.product_id AND pt.tag_id = :tagId',
          { tagId: query.tagId },
        );
    }

    if (query.priceMin) {
      queryBuilder.andWhere('product.product_price >= :priceMin', {
        priceMin: query.priceMin,
      });
    }

    if (query.priceMax) {
      queryBuilder.andWhere('product.product_price <= :priceMax', {
        priceMax: query.priceMax,
      });
    }

    if (query.expiredSoon) {
      const soon = new Date();
      soon.setDate(soon.getDate() + 7);
      queryBuilder.andWhere(
        'product.expired_at IS NOT NULL AND product.expired_at <= :soon',
        { soon },
      );
    }

    if (query.lowStock) {
      const threshold = query.lowStockThreshold ?? 10;
      queryBuilder.andWhere('product.quantity_available <= :threshold', {
        threshold,
      });
    }

    if (!query.includeHidden) {
      queryBuilder.andWhere('product.is_show = :isShow', { isShow: true });
    }

    if (query.isFeatured !== undefined) {
      queryBuilder.andWhere('product.is_featured = :isFeatured', {
        isFeatured: query.isFeatured,
      });
    }

    if (query.hasSalePrice) {
      queryBuilder.andWhere('product.product_price_sale IS NOT NULL');
    }

    queryBuilder
      .orderBy(`product.${sortBy}`, sortOrder)
      .skip((page - 1) * limit)
      .take(limit);

    const [items, total] = await queryBuilder.getManyAndCount();
    const mappedItems = await Promise.all(
      items.map((item) => this.enrichProductWithDiscount(item)),
    );

    return {
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
      items: mappedItems,
    };
  }

  async findOne(productId: string) {
    const product = await this.productsRepository.findOneBy({ productId });
    if (!product) {
      throw new NotFoundException('Product not found');
    }
    return this.enrichProductWithFullDetails(product);
  }

  async getRecommendationCards(options: {
    productIds?: string[];
    keywordHints?: string[];
    limit?: number;
  }) {
    const limit = Math.max(1, Math.min(options.limit ?? 4, 12));
    const explicitIds = [...new Set((options.productIds ?? []).filter(Boolean))];
    const normalizedHints = [...new Set((options.keywordHints ?? []).map((item) => item.trim()).filter(Boolean))].slice(0, 8);

    const products: ProductEntity[] = [];

    if (explicitIds.length > 0) {
      const explicitProducts = await this.productsRepository.find({
        where: { productId: In(explicitIds), isShow: true },
      });
      explicitProducts.sort(
        (left, right) =>
          explicitIds.indexOf(left.productId) - explicitIds.indexOf(right.productId),
      );
      products.push(...explicitProducts);
    }

    if (products.length < limit && normalizedHints.length > 0) {
      const queryBuilder = this.productsRepository.createQueryBuilder('product');
      queryBuilder.andWhere('product.is_show = :isShow', { isShow: true });
      queryBuilder.andWhere('product.quantity_available > 0');

      if (explicitIds.length > 0) {
        queryBuilder.andWhere('product.product_id NOT IN (:...explicitIds)', {
          explicitIds,
        });
      }

      const hintClauses = normalizedHints.map((_, index) =>
        `(product.product_name LIKE :hint${index} OR product.description LIKE :hint${index})`,
      );
      queryBuilder.andWhere(`(${hintClauses.join(' OR ')})`);
      normalizedHints.forEach((hint, index) => {
        queryBuilder.setParameter(`hint${index}`, `%${hint}%`);
      });

      queryBuilder
        .orderBy('product.is_featured', 'DESC')
        .addOrderBy('product.quantity_available', 'DESC')
        .addOrderBy('product.rating_average', 'DESC')
        .addOrderBy('product.created_at', 'DESC')
        .take(limit - products.length);

      const fallbackProducts = await queryBuilder.getMany();
      products.push(...fallbackProducts);
    }

    const uniqueProducts = products
      .filter(
        (product, index, current) =>
          current.findIndex((item) => item.productId === product.productId) === index,
      )
      .slice(0, limit);

    return Promise.all(uniqueProducts.map((product) => this.mapRecommendationCard(product)));
  }

  async getAdminProductOptions(search?: string, limit = 24) {
    const safeLimit = Math.max(1, Math.min(limit, 50));
    const queryBuilder = this.productsRepository.createQueryBuilder('product');

    if (search?.trim()) {
      queryBuilder.andWhere(
        '(product.product_name LIKE :search OR product.product_slug LIKE :search OR product.description LIKE :search)',
        {
          search: `%${search.trim()}%`,
        },
      );
    }

    queryBuilder
      .orderBy('product.is_show', 'DESC')
      .addOrderBy('product.quantity_available', 'DESC')
      .addOrderBy('product.created_at', 'DESC')
      .take(safeLimit);

    const products = await queryBuilder.getMany();
    return Promise.all(products.map((product) => this.mapRecommendationCard(product)));
  }

  async create(createProductDto: CreateProductDto) {
    await this.ensureCategoryExists(createProductDto.categoryId);
    if (createProductDto.originId) {
      await this.ensureOriginExists(createProductDto.originId);
    }
    await this.ensureUniqueFields(createProductDto);

    if (
      createProductDto.productPriceSale != null &&
      Number(createProductDto.productPriceSale) > Number(createProductDto.productPrice)
    ) {
      throw new BadRequestException('Sale price cannot exceed regular price');
    }

    const product = this.productsRepository.create({
      productId: createProductDto.productId ?? randomUUID(),
      productName: createProductDto.productName,
      productSlug: this.normalizeSlug(
        createProductDto.productSlug ?? createProductDto.productName,
      ),
      categoryId: createProductDto.categoryId,
      subcategoryId: createProductDto.subcategoryId ?? null,
      originId: createProductDto.originId ?? null,
      productPrice: createProductDto.productPrice,
      productPriceSale: createProductDto.productPriceSale ?? null,
      quantityAvailable: createProductDto.quantityAvailable ?? 0,
      description: createProductDto.description ?? null,
      ratingAverage: '0',
      ratingCount: 0,
      isShow: createProductDto.isShow ?? true,
      isFeatured: createProductDto.isFeatured ?? false,
      expiredAt: createProductDto.expiredAt
        ? new Date(createProductDto.expiredAt)
        : null,
      unit: createProductDto.unit ?? null,
      quantityPerBox: createProductDto.quantityPerBox ?? null,
      barcode: createProductDto.barcode ?? null,
      boxBarcode: createProductDto.boxBarcode ?? null,
    });

    const saved = await this.productsRepository.save(product);
    void this.notificationsService.createNotification({
      channel: NotificationChannel.SYSTEM,
      title: 'Sản phẩm mới được thêm',
      message: `Sản phẩm "${saved.productName}" đã được thêm vào hệ thống.`,
      metadata: { productId: saved.productId, type: 'product_created' },
    });
    return saved;
  }

  async update(productId: string, updateProductDto: UpdateProductDto) {
    const product = await this.productsRepository.findOneBy({ productId });
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    if (updateProductDto.categoryId) {
      await this.ensureCategoryExists(updateProductDto.categoryId);
    }
    if (updateProductDto.originId) {
      await this.ensureOriginExists(updateProductDto.originId);
    }

    await this.ensureUniqueFields(updateProductDto, product.productId);

    const effectivePrice = updateProductDto.productPrice ?? product.productPrice;
    const effectiveSalePrice = updateProductDto.productPriceSale !== undefined
      ? updateProductDto.productPriceSale
      : product.productPriceSale;
    if (
      effectiveSalePrice != null &&
      Number(effectiveSalePrice) > Number(effectivePrice)
    ) {
      throw new BadRequestException('Sale price cannot exceed regular price');
    }

    product.productName = updateProductDto.productName ?? product.productName;
    product.productSlug = updateProductDto.productSlug
      ? this.normalizeSlug(updateProductDto.productSlug)
      : updateProductDto.productName
        ? this.normalizeSlug(updateProductDto.productName)
        : product.productSlug;
    product.categoryId = updateProductDto.categoryId ?? product.categoryId;
    product.subcategoryId =
      updateProductDto.subcategoryId !== undefined
        ? (updateProductDto.subcategoryId ?? null)
        : product.subcategoryId;
    product.originId =
      updateProductDto.originId !== undefined
        ? (updateProductDto.originId ?? null)
        : product.originId;
    product.productPrice =
      updateProductDto.productPrice ?? product.productPrice;
    product.productPriceSale =
      updateProductDto.productPriceSale !== undefined
        ? (updateProductDto.productPriceSale ?? null)
        : product.productPriceSale;
    product.quantityAvailable =
      updateProductDto.quantityAvailable ?? product.quantityAvailable;
    product.description =
      updateProductDto.description !== undefined
        ? (updateProductDto.description ?? null)
        : product.description;
    product.isShow = updateProductDto.isShow ?? product.isShow;
    if (updateProductDto.isFeatured !== undefined) {
      product.isFeatured = updateProductDto.isFeatured;
    }
    product.expiredAt = updateProductDto.expiredAt
      ? new Date(updateProductDto.expiredAt)
      : product.expiredAt;
    product.unit =
      updateProductDto.unit !== undefined
        ? (updateProductDto.unit ?? null)
        : product.unit;
    product.quantityPerBox =
      updateProductDto.quantityPerBox ?? product.quantityPerBox;
    product.barcode =
      updateProductDto.barcode !== undefined
        ? (updateProductDto.barcode ?? null)
        : product.barcode;
    product.boxBarcode =
      updateProductDto.boxBarcode !== undefined
        ? (updateProductDto.boxBarcode ?? null)
        : product.boxBarcode;

    const updated = await this.productsRepository.save(product);
    void this.notificationsService.createNotification({
      channel: NotificationChannel.SYSTEM,
      title: 'Sản phẩm được cập nhật',
      message: `Sản phẩm "${updated.productName}" đã được cập nhật.`,
      metadata: { productId: updated.productId, type: 'product_updated' },
    });
    return updated;
  }

  async remove(productId: string) {
    const product = await this.productsRepository.findOneBy({ productId });
    if (!product) {
      throw new NotFoundException('Product not found');
    }
    const name = product.productName;
    await this.productsRepository.remove(product);
    void this.notificationsService.createNotification({
      channel: NotificationChannel.SYSTEM,
      title: 'Sản phẩm bị xóa',
      message: `Sản phẩm "${name}" đã bị xóa khỏi hệ thống.`,
      metadata: { type: 'product_deleted' },
    });
    return { success: true };
  }

  async toggleVisibility(productId: string) {
    const product = await this.productsRepository.findOneBy({ productId });
    if (!product) {
      throw new NotFoundException('Product not found');
    }
    product.isShow = !product.isShow;
    const saved = await this.productsRepository.save(product);
    return { productId: saved.productId, isShow: saved.isShow };
  }

  async toggleFeatured(productId: string) {
    const product = await this.productsRepository.findOneBy({ productId });
    if (!product) {
      throw new NotFoundException('Product not found');
    }
    product.isFeatured = !product.isFeatured;
    const saved = await this.productsRepository.save(product);
    return { productId: saved.productId, isFeatured: saved.isFeatured };
  }

  // ─── PRODUCT IMAGES ──────────────────────────────────────────────────────────

  async getProductImages(productId: string) {
    await this.ensureProductExists(productId);
    return this.productImagesRepository.find({
      where: { productId },
      order: { isPrimary: 'DESC', sortOrder: 'ASC', createdAt: 'ASC' },
    });
  }

  async uploadProductImage(
    productId: string,
    file: UploadedImageFile | undefined,
    isPrimary = false,
  ) {
    await this.ensureProductExists(productId);

    if (!file) {
      throw new BadRequestException('Image file is required');
    }
    if (!file.mimetype.startsWith('image/')) {
      throw new BadRequestException('Only image files are allowed');
    }
    if (file.size > 5 * 1024 * 1024) {
      throw new BadRequestException('Image size must be 5MB or less');
    }

    const uploadedImageUrl = await this.uploadImageToCloudinary(
      file,
      productId,
    );

    if (isPrimary) {
      await this.productImagesRepository.update(
        { productId, isPrimary: true },
        { isPrimary: false },
      );
    }

    const sortOrder = await this.productImagesRepository.countBy({ productId });
    const image = this.productImagesRepository.create({
      productId,
      imageUrl: uploadedImageUrl,
      isPrimary,
      sortOrder,
    });

    const saved = await this.productImagesRepository.save(image);
    return {
      productImageId: saved.productImageId,
      productId,
      imageUrl: saved.imageUrl,
      isPrimary: saved.isPrimary,
      sortOrder: saved.sortOrder,
    };
  }

  async setPrimaryImage(productId: string, imageId: string) {
    await this.ensureProductExists(productId);

    const image = await this.productImagesRepository.findOneBy({
      productImageId: imageId,
      productId,
    });
    if (!image) {
      throw new NotFoundException('Image not found for this product');
    }

    await this.productImagesRepository.update(
      { productId, isPrimary: true },
      { isPrimary: false },
    );
    image.isPrimary = true;
    await this.productImagesRepository.save(image);

    return { success: true, primaryImageId: imageId };
  }

  async deleteProductImage(productId: string, imageId: string) {
    await this.ensureProductExists(productId);

    const image = await this.productImagesRepository.findOneBy({
      productImageId: imageId,
      productId,
    });
    if (!image) {
      throw new NotFoundException('Image not found for this product');
    }

    await this.productImagesRepository.remove(image);
    return { success: true };
  }

  async reorderProductImages(productId: string, dto: ReorderImagesDto) {
    await this.ensureProductExists(productId);

    const images = await this.productImagesRepository.findBy({ productId });
    const imageMap = new Map(images.map((img) => [img.productImageId, img]));

    for (const id of dto.imageIds) {
      if (!imageMap.has(id)) {
        throw new NotFoundException(`Image ${id} not found for this product`);
      }
    }

    const updates = dto.imageIds.map((id, index) => {
      const img = imageMap.get(id)!;
      img.sortOrder = index;
      return img;
    });

    await this.productImagesRepository.save(updates);
    return this.getProductImages(productId);
  }

  // ─── DESCRIPTION IMAGES ──────────────────────────────────────────────────────

  async getDescriptionImages(productId: string) {
    await this.ensureProductExists(productId);
    return this.productDescriptionImagesRepository.find({
      where: { productId },
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });
  }

  async uploadDescriptionImage(
    productId: string,
    file: UploadedImageFile | undefined,
  ) {
    await this.ensureProductExists(productId);

    if (!file) {
      throw new BadRequestException('Image file is required');
    }
    if (!file.mimetype.startsWith('image/')) {
      throw new BadRequestException('Only image files are allowed');
    }
    if (file.size > 5 * 1024 * 1024) {
      throw new BadRequestException('Image size must be 5MB or less');
    }

    const imageUrl = await this.uploadImageToCloudinary(
      file,
      `${productId}-desc`,
    );
    const sortOrder = await this.productDescriptionImagesRepository.countBy({
      productId,
    });

    const image = this.productDescriptionImagesRepository.create({
      productId,
      imageUrl,
      sortOrder,
    });

    return this.productDescriptionImagesRepository.save(image);
  }

  async deleteDescriptionImage(productId: string, imageId: string) {
    await this.ensureProductExists(productId);

    const image = await this.productDescriptionImagesRepository.findOneBy({
      productDescriptionImageId: imageId,
      productId,
    });
    if (!image) {
      throw new NotFoundException('Description image not found for this product');
    }

    await this.productDescriptionImagesRepository.remove(image);
    return { success: true };
  }

  // ─── INVENTORY ───────────────────────────────────────────────────────────────

  async importInventory(
    performedBy: string,
    importInventoryDto: ImportInventoryDto,
  ) {
    await this.ensureUserExists(performedBy);
    const product = await this.productsRepository.findOneBy({
      productId: importInventoryDto.productId,
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    product.quantityAvailable += importInventoryDto.quantity;
    await this.productsRepository.save(product);

    const transaction = this.inventoryTransactionsRepository.create({
      productId: product.productId,
      performedBy,
      transactionType: InventoryTransactionType.IMPORT,
      quantityChange: importInventoryDto.quantity,
      note: importInventoryDto.note ?? 'Import inventory by admin',
      relatedOrderId: null,
    });

    const saved = await this.inventoryTransactionsRepository.save(transaction);

    return {
      productId: product.productId,
      quantityAvailable: product.quantityAvailable,
      transactionId: saved.transactionId,
    };
  }

  async adjustInventory(
    performedBy: string,
    adjustInventoryDto: AdjustInventoryDto,
  ) {
    await this.ensureUserExists(performedBy);
    const product = await this.productsRepository.findOneBy({
      productId: adjustInventoryDto.productId,
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    const previousQuantity = product.quantityAvailable;
    let quantityChange = 0;

    if (adjustInventoryDto.mode === InventoryAdjustmentMode.SET) {
      quantityChange = adjustInventoryDto.quantity - previousQuantity;
      product.quantityAvailable = adjustInventoryDto.quantity;
    }

    if (adjustInventoryDto.mode === InventoryAdjustmentMode.INCREASE) {
      quantityChange = adjustInventoryDto.quantity;
      product.quantityAvailable += adjustInventoryDto.quantity;
    }

    if (adjustInventoryDto.mode === InventoryAdjustmentMode.DECREASE) {
      if (adjustInventoryDto.quantity > product.quantityAvailable) {
        throw new BadRequestException('Quantity exceeds available stock');
      }
      quantityChange = -adjustInventoryDto.quantity;
      product.quantityAvailable -= adjustInventoryDto.quantity;
    }

    await this.productsRepository.save(product);

    const transaction = this.inventoryTransactionsRepository.create({
      productId: product.productId,
      performedBy,
      transactionType: InventoryTransactionType.ADJUSTMENT,
      quantityChange,
      note:
        adjustInventoryDto.note ??
        `Adjustment mode: ${adjustInventoryDto.mode}`,
      relatedOrderId: null,
    });

    const saved = await this.inventoryTransactionsRepository.save(transaction);

    return {
      productId: product.productId,
      previousQuantity,
      currentQuantity: product.quantityAvailable,
      quantityChange,
      transactionId: saved.transactionId,
    };
  }

  async recordDamage(performedBy: string, dto: RecordDamageDto) {
    await this.ensureUserExists(performedBy);
    const product = await this.productsRepository.findOneBy({
      productId: dto.productId,
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    if (dto.quantity > product.quantityAvailable) {
      throw new BadRequestException(
        'Damage quantity exceeds available stock',
      );
    }

    product.quantityAvailable -= dto.quantity;
    await this.productsRepository.save(product);

    const transaction = this.inventoryTransactionsRepository.create({
      productId: product.productId,
      performedBy,
      transactionType: InventoryTransactionType.DAMAGE,
      quantityChange: -dto.quantity,
      note: dto.note ?? 'Damage/expired goods recorded',
      relatedOrderId: null,
    });

    const saved = await this.inventoryTransactionsRepository.save(transaction);

    return {
      productId: product.productId,
      quantityAvailable: product.quantityAvailable,
      transactionId: saved.transactionId,
    };
  }

  async recordReturn(performedBy: string, dto: RecordReturnDto) {
    await this.ensureUserExists(performedBy);
    const product = await this.productsRepository.findOneBy({
      productId: dto.productId,
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    product.quantityAvailable += dto.quantity;
    await this.productsRepository.save(product);

    const transaction = this.inventoryTransactionsRepository.create({
      productId: product.productId,
      performedBy,
      transactionType: InventoryTransactionType.RETURN_IN,
      quantityChange: dto.quantity,
      note: dto.note ?? 'Return goods recorded',
      relatedOrderId: dto.relatedOrderId ?? null,
    });

    const saved = await this.inventoryTransactionsRepository.save(transaction);

    return {
      productId: product.productId,
      quantityAvailable: product.quantityAvailable,
      transactionId: saved.transactionId,
    };
  }

  async findInventoryTransactions(query: QueryInventoryTransactionsDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;

    const queryBuilder = this.inventoryTransactionsRepository
      .createQueryBuilder('transaction')
      .leftJoin(
        ProductEntity,
        'product',
        'product.product_id = transaction.product_id',
      )
      .leftJoin(
        UserEntity,
        'user',
        'user.user_id = transaction.performed_by',
      )
      .select([
        'transaction.transactionId AS id',
        'transaction.productId AS productId',
        'transaction.transactionType AS transactionType',
        'transaction.quantityChange AS quantityChange',
        'transaction.note AS note',
        'transaction.relatedOrderId AS relatedOrderId',
        'transaction.createdAt AS createdAt',
        'product.product_name AS productName',
      ])
      .addSelect(
        'COALESCE(user.username, user.email, transaction.performed_by)',
        'performedBy',
      );

    if (query.productId) {
      queryBuilder.andWhere('transaction.product_id = :productId', {
        productId: query.productId,
      });
    }

    if (query.transactionType) {
      queryBuilder.andWhere('transaction.transaction_type = :transactionType', {
        transactionType: query.transactionType,
      });
    }

    if (query.relatedOrderId) {
      queryBuilder.andWhere('transaction.related_order_id = :relatedOrderId', {
        relatedOrderId: query.relatedOrderId,
      });
    }

    if (query.performedBy) {
      queryBuilder.andWhere('transaction.performed_by = :performedBy', {
        performedBy: query.performedBy,
      });
    }

    if (query.dateFrom) {
      queryBuilder.andWhere('transaction.created_at >= :dateFrom', {
        dateFrom: new Date(query.dateFrom),
      });
    }

    if (query.dateTo) {
      const dateTo = new Date(query.dateTo);
      dateTo.setHours(23, 59, 59, 999);
      queryBuilder.andWhere('transaction.created_at <= :dateTo', { dateTo });
    }

    queryBuilder
      .orderBy('transaction.created_at', 'DESC')
      .offset((page - 1) * limit)
      .limit(limit);

    const [items, total] = await Promise.all([
      queryBuilder.getRawMany(),
      queryBuilder.getCount(),
    ]);

    return {
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
      items,
    };
  }

  async getInventorySummary() {
    const results = await this.productsRepository
      .createQueryBuilder('product')
      .select([
        'product.product_id AS productId',
        'product.product_name AS productName',
        'product.quantity_available AS quantityAvailable',
        'product.barcode AS barcode',
        'product.unit AS unit',
      ])
      .addSelect(
        `COALESCE(SUM(CASE WHEN t.transaction_type = 'import' THEN t.quantity_change ELSE 0 END), 0)`,
        'totalImported',
      )
      .addSelect(
        `COALESCE(SUM(CASE WHEN t.transaction_type = 'damage' THEN ABS(t.quantity_change) ELSE 0 END), 0)`,
        'totalDamaged',
      )
      .addSelect(
        `COALESCE(SUM(CASE WHEN t.transaction_type = 'export' THEN ABS(t.quantity_change) ELSE 0 END), 0)`,
        'totalExported',
      )
      .leftJoin(
        'inventory_transactions',
        't',
        't.product_id = product.product_id',
      )
      .where('product.is_show = :isShow', { isShow: true })
      .groupBy('product.product_id')
      .orderBy('product.product_name', 'ASC')
      .getRawMany();

    return results;
  }

  async getLowStockProducts(threshold = 10) {
    const products = await this.productsRepository
      .createQueryBuilder('product')
      .where('product.quantity_available <= :threshold', { threshold })
      .andWhere('product.is_show = :isShow', { isShow: true })
      .orderBy('product.quantity_available', 'ASC')
      .getMany();

    return products.map((p) => ({
      productId: p.productId,
      productName: p.productName,
      quantityAvailable: p.quantityAvailable,
      unit: p.unit,
      barcode: p.barcode,
    }));
  }

  // ─── WISHLIST ─────────────────────────────────────────────────────────────────

  async findWishlist(userId: string) {
    await this.ensureUserExists(userId);

    const items = await this.wishlistRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });

    const productIds = items.map((item) => item.productId);
    const products = productIds.length
      ? await this.productsRepository.findBy(
          productIds.map((productId) => ({ productId })),
        )
      : [];

    const categoryIds = [...new Set(products.map((p) => p.categoryId).filter(Boolean))];
    const categories = categoryIds.length
      ? await this.categoriesRepository.findBy(categoryIds.map((id) => ({ categoryId: id })))
      : [];
    const categoriesById = new Map(categories.map((c) => [c.categoryId, c]));

    const enrichedEntries = await Promise.all(
      products.map(async (p) => [p.productId, await this.enrichProductWithDiscount(p)] as const),
    );
    const enrichedById = new Map(enrichedEntries);

    return items.map((item) => {
      const enriched = enrichedById.get(item.productId) ?? null;
      const cat = enriched ? (categoriesById.get(enriched.categoryId) ?? null) : null;
      return {
        productId: item.productId,
        createdAt: item.createdAt,
        product: enriched
          ? {
              ...enriched,
              category: cat ? { categoryId: cat.categoryId, categoryName: cat.categoryName } : null,
            }
          : null,
      };
    });
  }

  async addWishlistItem(userId: string, productId: string) {
    await this.ensureUserExists(userId);
    await this.ensureProductExists(productId);

    const existingItem = await this.wishlistRepository.findOneBy({
      userId,
      productId,
    });
    if (existingItem) {
      return { userId, productId, createdAt: existingItem.createdAt };
    }

    const item = this.wishlistRepository.create({ userId, productId });
    return this.wishlistRepository.save(item);
  }

  async removeWishlistItem(userId: string, productId: string) {
    await this.ensureUserExists(userId);

    const existingItem = await this.wishlistRepository.findOneBy({
      userId,
      productId,
    });
    if (!existingItem) {
      throw new NotFoundException('Wishlist item not found');
    }

    await this.wishlistRepository.delete({ userId, productId });
    return { success: true };
  }

  // ─── PRIVATE HELPERS ─────────────────────────────────────────────────────────

  private async ensureProductExists(productId: string) {
    const product = await this.productsRepository.findOneBy({ productId });
    if (!product) {
      throw new NotFoundException('Product not found');
    }
    return product;
  }

  private async ensureCategoryExists(categoryId: string) {
    const category = await this.categoriesRepository.findOneBy({ categoryId });
    if (!category) {
      throw new NotFoundException('Category not found');
    }
  }

  private async ensureOriginExists(originId: string) {
    const origin = await this.originsRepository.findOneBy({ originId });
    if (!origin) {
      throw new NotFoundException('Origin not found');
    }
  }

  private async collectCategoryIds(rootCategoryId: string) {
    await this.ensureCategoryExists(rootCategoryId);

    const collectedIds = new Set<string>([rootCategoryId]);
    const queue = [rootCategoryId];

    while (queue.length > 0) {
      const currentCategoryId = queue.shift();
      if (!currentCategoryId) continue;

      const childCategories = await this.categoriesRepository.find({
        where: { parentId: currentCategoryId },
        select: { categoryId: true },
      });

      for (const child of childCategories) {
        if (!collectedIds.has(child.categoryId)) {
          collectedIds.add(child.categoryId);
          queue.push(child.categoryId);
        }
      }
    }

    return [...collectedIds];
  }

  private async ensureUserExists(userId: string) {
    const user = await this.usersRepository.findOneBy({ userId });
    if (!user) {
      throw new UnauthorizedException('Nguoi dung khong ton tai');
    }
  }

  private async enrichProductWithFullDetails(product: ProductEntity) {
    const [images, descriptionImages, tags, enriched] = await Promise.all([
      this.productImagesRepository.find({
        where: { productId: product.productId },
        order: { isPrimary: 'DESC', sortOrder: 'ASC', createdAt: 'ASC' },
      }),
      this.productDescriptionImagesRepository.find({
        where: { productId: product.productId },
        order: { sortOrder: 'ASC', createdAt: 'ASC' },
      }),
      this.getProductTagsInternal(product.productId),
      this.enrichProductWithDiscount(product),
    ]);

    const [origin, subcategory, category] = await Promise.all([
      product.originId
        ? this.originsRepository.findOneBy({ originId: product.originId })
        : Promise.resolve(null),
      product.subcategoryId
        ? this.subcategoriesRepository.findOneBy({
            subcategoryId: product.subcategoryId,
          })
        : Promise.resolve(null),
      this.categoriesRepository.findOneBy({ categoryId: product.categoryId }),
    ]);

    return { ...enriched, images, descriptionImages, tags, origin, subcategory, category };
  }

  private async enrichProductWithDiscount(product: ProductEntity) {
    const primaryImage =
      (await this.productImagesRepository.findOne({
        where: { productId: product.productId, isPrimary: true },
        order: { sortOrder: 'ASC', createdAt: 'ASC' },
      })) ??
      (await this.productImagesRepository.findOne({
        where: { productId: product.productId },
        order: { isPrimary: 'DESC', sortOrder: 'ASC', createdAt: 'ASC' },
      }));

    const appliedDiscount = await this.findApplicableDiscount(product);
    const basePrice = Number(product.productPriceSale ?? product.productPrice);
    const discountAmount = appliedDiscount
      ? this.calculateDiscountAmount(appliedDiscount, basePrice)
      : 0;
    const effectivePrice = Math.max(0, basePrice - discountAmount).toFixed(2);

    return {
      ...product,
      primaryImageUrl: primaryImage?.imageUrl ?? null,
      basePrice: basePrice.toFixed(2),
      effectivePrice,
      appliedDiscount: appliedDiscount
        ? {
            id: appliedDiscount.discountId,
            code: appliedDiscount.discountCode,
            name: appliedDiscount.discountName,
            type: appliedDiscount.discountType,
            value: appliedDiscount.discountValue,
            appliesTo: appliedDiscount.appliesTo,
          }
        : null,
    };
  }

  private async mapRecommendationCard(product: ProductEntity) {
    const [origin, category, enriched] = await Promise.all([
      product.originId
        ? this.originsRepository.findOneBy({ originId: product.originId })
        : Promise.resolve(null),
      this.categoriesRepository.findOneBy({ categoryId: product.categoryId }),
      this.enrichProductWithDiscount(product),
    ]);

    return {
      productId: product.productId,
      productName: product.productName,
      productSlug: product.productSlug,
      quantityAvailable: product.quantityAvailable,
      unit: product.unit,
      isShow: product.isShow,
      basePrice: enriched.basePrice,
      effectivePrice: enriched.effectivePrice,
      primaryImageUrl: enriched.primaryImageUrl,
      appliedDiscount: enriched.appliedDiscount,
      category: category
        ? {
            categoryId: category.categoryId,
            categoryName: category.categoryName,
            categorySlug: category.categorySlug,
          }
        : null,
      origin: origin
        ? {
            originId: origin.originId,
            originName: origin.originName,
          }
        : null,
      ratingAverage: product.ratingAverage,
      ratingCount: product.ratingCount,
    };
  }

  private calculateDiscountAmount(discount: DiscountEntity, amount: number) {
    const rawDiscount =
      discount.discountType === DiscountType.PERCENT
        ? (amount * Number(discount.discountValue)) / 100
        : Number(discount.discountValue);

    const maxDiscount = discount.maxDiscountAmount
      ? Number(discount.maxDiscountAmount)
      : null;

    const capped =
      maxDiscount !== null ? Math.min(rawDiscount, maxDiscount) : rawDiscount;

    return Math.min(capped, amount);
  }

  private async findApplicableDiscount(product: ProductEntity) {
    const now = new Date();
    const activeDiscounts = await this.discountsRepository.find({
      where: { isActive: true },
      order: { createdAt: 'DESC' },
    });

    const validDiscounts = activeDiscounts.filter(
      (d) =>
        d.startAt.getTime() <= now.getTime() &&
        d.expireDate.getTime() >= now.getTime() &&
        (d.usageLimit === null || d.usedCount < d.usageLimit),
    );

    let bestDiscount: DiscountEntity | null = null;
    let bestValue = 0;
    const basePrice = Number(product.productPriceSale ?? product.productPrice);

    for (const discount of validDiscounts) {
      let applicable = false;

      if (discount.appliesTo === DiscountApplyTarget.ORDER) {
        applicable = true;
      }
      if (discount.appliesTo === DiscountApplyTarget.CATEGORY) {
        const exists = await this.discountCategoriesRepository.findOneBy({
          discountId: discount.discountId,
          categoryId: product.categoryId,
        });
        applicable = !!exists;
      }
      if (discount.appliesTo === DiscountApplyTarget.PRODUCT) {
        const exists = await this.discountProductsRepository.findOneBy({
          discountId: discount.discountId,
          productId: product.productId,
        });
        applicable = !!exists;
      }

      if (!applicable) continue;
      if (basePrice < Number(discount.minOrderValue)) continue;

      const value = this.calculateDiscountAmount(discount, basePrice);
      if (value > bestValue) {
        bestDiscount = discount;
        bestValue = value;
      }
    }

    return bestDiscount;
  }

  private async getProductTagsInternal(productId: string) {
    const productTags = await this.productTagsRepository.findBy({ productId });
    if (productTags.length === 0) return [];
    const tagIds = productTags.map((pt) => pt.tagId);
    return this.tagsRepository.findBy(tagIds.map((tagId) => ({ tagId })));
  }

  private async ensureUniqueFields(
    payload: Partial<CreateProductDto>,
    excludeProductId?: string,
  ) {
    const slug = payload.productSlug
      ? this.normalizeSlug(payload.productSlug)
      : payload.productName
        ? this.normalizeSlug(payload.productName)
        : null;

    if (slug) {
      const existing = await this.productsRepository.findOneBy({
        productSlug: slug,
      });
      if (existing && existing.productId !== excludeProductId) {
        throw new ConflictException('Product slug already exists');
      }
    }

    if (payload.barcode) {
      const existing = await this.productsRepository.findOneBy({
        barcode: payload.barcode,
      });
      if (existing && existing.productId !== excludeProductId) {
        throw new ConflictException('Barcode already exists');
      }
    }

    if (payload.boxBarcode) {
      const existing = await this.productsRepository.findOneBy({
        boxBarcode: payload.boxBarcode,
      });
      if (existing && existing.productId !== excludeProductId) {
        throw new ConflictException('Box barcode already exists');
      }
    }
  }

  private normalizeSlug(value: string) {
    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  private async uploadImageToCloudinary(
    file: UploadedImageFile,
    publicIdPrefix: string,
  ) {
    const cloudName = process.env.CLOUD_NAME;
    const apiKey = process.env.API_KEY;
    const apiSecret = process.env.API_SECRET;

    if (!cloudName || !apiKey || !apiSecret) {
      throw new InternalServerErrorException(
        'Cloudinary environment variables are missing',
      );
    }

    const folder = 'agri_ecommerce/products';
    const timestamp = Math.floor(Date.now() / 1000);
    const publicId = `${publicIdPrefix}-${Date.now()}`;
    const signature = createHash('sha1')
      .update(
        `folder=${folder}&public_id=${publicId}&timestamp=${timestamp}${apiSecret}`,
      )
      .digest('hex');

    const formData = new FormData();
    formData.append(
      'file',
      new Blob([new Uint8Array(file.buffer)], { type: file.mimetype }),
      file.originalname,
    );
    formData.append('api_key', apiKey);
    formData.append('timestamp', String(timestamp));
    formData.append('signature', signature);
    formData.append('folder', folder);
    formData.append('public_id', publicId);

    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
      { method: 'POST', body: formData },
    );

    const payload = (await response.json()) as {
      secure_url?: string;
      error?: { message?: string };
    };

    if (!response.ok || !payload.secure_url) {
      throw new InternalServerErrorException(
        payload.error?.message ?? 'Unable to upload image to Cloudinary',
      );
    }

    return payload.secure_url;
  }
}
