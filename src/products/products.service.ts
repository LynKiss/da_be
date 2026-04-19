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
import { Repository } from 'typeorm';
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
import { QueryProductsDto } from './dto/query-products.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import {
  InventoryTransactionEntity,
  InventoryTransactionType,
} from './entities/inventory-transaction.entity';
import { ProductEntity } from './entities/product.entity';
import { ProductImageEntity } from './entities/product-image.entity';
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
    @InjectRepository(CategoryEntity)
    private readonly categoriesRepository: Repository<CategoryEntity>,
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
  ) {}

  async findAll(query: QueryProductsDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;

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

    if (!query.includeHidden) {
      queryBuilder.andWhere('product.is_show = :isShow', { isShow: true });
    }

    queryBuilder
      .orderBy('product.created_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [items, total] = await queryBuilder.getManyAndCount();
    const mappedItems = await Promise.all(
      items.map((item) => this.enrichProductWithDiscount(item)),
    );

    return {
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      items: mappedItems,
    };
  }

  async findOne(productId: string) {
    const product = await this.productsRepository.findOneBy({ productId });
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    return this.enrichProductWithDiscount(product);
  }

  async create(createProductDto: CreateProductDto) {
    await this.ensureCategoryExists(createProductDto.categoryId);
    await this.ensureUniqueFields(createProductDto);

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
      expiredAt: createProductDto.expiredAt
        ? new Date(createProductDto.expiredAt)
        : null,
      unit: createProductDto.unit ?? null,
      quantityPerBox: createProductDto.quantityPerBox ?? null,
      barcode: createProductDto.barcode ?? null,
      boxBarcode: createProductDto.boxBarcode ?? null,
    });

    return this.productsRepository.save(product);
  }

  async update(productId: string, updateProductDto: UpdateProductDto) {
    const product = await this.findOne(productId);

    if (updateProductDto.categoryId) {
      await this.ensureCategoryExists(updateProductDto.categoryId);
    }

    await this.ensureUniqueFields(updateProductDto, product.productId);

    product.productName = updateProductDto.productName ?? product.productName;
    product.productSlug = updateProductDto.productSlug
      ? this.normalizeSlug(updateProductDto.productSlug)
      : updateProductDto.productName
        ? this.normalizeSlug(updateProductDto.productName)
        : product.productSlug;
    product.categoryId = updateProductDto.categoryId ?? product.categoryId;
    product.subcategoryId =
      updateProductDto.subcategoryId ?? product.subcategoryId;
    product.originId = updateProductDto.originId ?? product.originId;
    product.productPrice =
      updateProductDto.productPrice ?? product.productPrice;
    product.productPriceSale =
      updateProductDto.productPriceSale ?? product.productPriceSale;
    product.quantityAvailable =
      updateProductDto.quantityAvailable ?? product.quantityAvailable;
    product.description = updateProductDto.description ?? product.description;
    product.isShow = updateProductDto.isShow ?? product.isShow;
    product.expiredAt = updateProductDto.expiredAt
      ? new Date(updateProductDto.expiredAt)
      : product.expiredAt;
    product.unit = updateProductDto.unit ?? product.unit;
    product.quantityPerBox =
      updateProductDto.quantityPerBox ?? product.quantityPerBox;
    product.barcode = updateProductDto.barcode ?? product.barcode;
    product.boxBarcode = updateProductDto.boxBarcode ?? product.boxBarcode;

    return this.productsRepository.save(product);
  }

  async remove(productId: string) {
    const product = await this.findOne(productId);
    await this.productsRepository.remove(product);

    return { success: true };
  }

  async uploadProductImage(
    productId: string,
    file: UploadedImageFile | undefined,
    isPrimary = true,
  ) {
    const product = await this.productsRepository.findOneBy({ productId });
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    if (!file) {
      throw new BadRequestException('Image file is required');
    }

    if (!file.mimetype.startsWith('image/')) {
      throw new BadRequestException('Only image files are allowed');
    }

    if (file.size > 5 * 1024 * 1024) {
      throw new BadRequestException('Image size must be 5MB or less');
    }

    const uploadedImageUrl = await this.uploadImageToCloudinary(file, productId);

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

    const savedImage = await this.productImagesRepository.save(image);

    return {
      productImageId: savedImage.productImageId,
      productId,
      imageUrl: savedImage.imageUrl,
      isPrimary: savedImage.isPrimary,
      sortOrder: savedImage.sortOrder,
    };
  }

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

    const savedTransaction =
      await this.inventoryTransactionsRepository.save(transaction);

    return {
      productId: product.productId,
      quantityAvailable: product.quantityAvailable,
      transactionId: savedTransaction.transactionId,
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

    const savedTransaction =
      await this.inventoryTransactionsRepository.save(transaction);

    return {
      productId: product.productId,
      previousQuantity,
      currentQuantity: product.quantityAvailable,
      quantityChange,
      transactionId: savedTransaction.transactionId,
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
      .select([
        'transaction.transactionId AS id',
        'transaction.productId AS productId',
        'transaction.performedBy AS performedBy',
        'transaction.transactionType AS transactionType',
        'transaction.quantityChange AS quantityChange',
        'transaction.note AS note',
        'transaction.relatedOrderId AS relatedOrderId',
        'transaction.createdAt AS createdAt',
        'product.product_name AS productName',
      ]);

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

    queryBuilder
      .orderBy('transaction.created_at', 'DESC')
      .offset((page - 1) * limit)
      .limit(limit);

    const [items, total] = await Promise.all([
      queryBuilder.getRawMany(),
      queryBuilder.getCount(),
    ]);

    return {
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      items,
    };
  }

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
    const productsById = new Map(
      products.map((product) => [product.productId, product]),
    );

    return items.map((item) => ({
      productId: item.productId,
      createdAt: item.createdAt,
      product: productsById.get(item.productId) ?? null,
    }));
  }

  async addWishlistItem(userId: string, productId: string) {
    await this.ensureUserExists(userId);
    await this.findOne(productId);

    const existingItem = await this.wishlistRepository.findOneBy({
      userId,
      productId,
    });
    if (existingItem) {
      return {
        userId,
        productId,
        createdAt: existingItem.createdAt,
      };
    }

    const item = this.wishlistRepository.create({
      userId,
      productId,
    });

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

  private async ensureCategoryExists(categoryId: string) {
    const category = await this.categoriesRepository.findOneBy({ categoryId });
    if (!category) {
      throw new NotFoundException('Category not found');
    }
  }

  private async collectCategoryIds(rootCategoryId: string) {
    await this.ensureCategoryExists(rootCategoryId);

    const collectedIds = new Set<string>([rootCategoryId]);
    const queue = [rootCategoryId];

    while (queue.length > 0) {
      const currentCategoryId = queue.shift();
      if (!currentCategoryId) {
        continue;
      }

      const childCategories = await this.categoriesRepository.find({
        where: { parentId: currentCategoryId },
        select: {
          categoryId: true,
        },
      });

      for (const childCategory of childCategories) {
        if (collectedIds.has(childCategory.categoryId)) {
          continue;
        }

        collectedIds.add(childCategory.categoryId);
        queue.push(childCategory.categoryId);
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

  private calculateDiscountAmount(discount: DiscountEntity, amount: number) {
    const rawDiscount =
      discount.discountType === DiscountType.PERCENT
        ? (amount * Number(discount.discountValue)) / 100
        : Number(discount.discountValue);

    const maxDiscount = discount.maxDiscountAmount
      ? Number(discount.maxDiscountAmount)
      : null;

    const cappedDiscount =
      maxDiscount !== null ? Math.min(rawDiscount, maxDiscount) : rawDiscount;

    return Math.min(cappedDiscount, amount);
  }

  private async findApplicableDiscount(product: ProductEntity) {
    const now = new Date();
    const activeDiscounts = await this.discountsRepository.find({
      where: { isActive: true },
      order: { createdAt: 'DESC' },
    });

    const validDiscounts = activeDiscounts.filter(
      (discount) =>
        discount.startAt.getTime() <= now.getTime() &&
        discount.expireDate.getTime() >= now.getTime(),
    );

    let bestDiscount: DiscountEntity | null = null;
    let bestDiscountValue = 0;
    const productBasePrice = Number(
      product.productPriceSale ?? product.productPrice,
    );

    for (const discount of validDiscounts) {
      let isApplicable = false;

      if (discount.appliesTo === DiscountApplyTarget.ORDER) {
        isApplicable = true;
      }

      if (discount.appliesTo === DiscountApplyTarget.CATEGORY) {
        const exists = await this.discountCategoriesRepository.findOneBy({
          discountId: discount.discountId,
          categoryId: product.categoryId,
        });
        isApplicable = !!exists;
      }

      if (discount.appliesTo === DiscountApplyTarget.PRODUCT) {
        const exists = await this.discountProductsRepository.findOneBy({
          discountId: discount.discountId,
          productId: product.productId,
        });
        isApplicable = !!exists;
      }

      if (!isApplicable) {
        continue;
      }

      if (productBasePrice < Number(discount.minOrderValue)) {
        continue;
      }

      const discountValue = this.calculateDiscountAmount(
        discount,
        productBasePrice,
      );
      if (discountValue > bestDiscountValue) {
        bestDiscount = discount;
        bestDiscountValue = discountValue;
      }
    }

    return bestDiscount;
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
      const existedProduct = await this.productsRepository.findOneBy({
        productSlug: slug,
      });
      if (existedProduct && existedProduct.productId !== excludeProductId) {
        throw new ConflictException('Product slug already exists');
      }
    }

    if (payload.barcode) {
      const existedBarcode = await this.productsRepository.findOneBy({
        barcode: payload.barcode,
      });
      if (existedBarcode && existedBarcode.productId !== excludeProductId) {
        throw new ConflictException('Barcode already exists');
      }
    }

    if (payload.boxBarcode) {
      const existedBoxBarcode = await this.productsRepository.findOneBy({
        boxBarcode: payload.boxBarcode,
      });
      if (
        existedBoxBarcode &&
        existedBoxBarcode.productId !== excludeProductId
      ) {
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
    productId: string,
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
    const signature = createHash('sha1')
      .update(`folder=${folder}&timestamp=${timestamp}${apiSecret}`)
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
    formData.append('public_id', `${productId}-${Date.now()}`);

    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
      {
        method: 'POST',
        body: formData,
      },
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
