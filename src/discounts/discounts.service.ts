import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CategoryEntity } from '../categories/entities/category.entity';
import { ProductEntity } from '../products/entities/product.entity';
import { CreateDiscountDto } from './dto/create-discount.dto';
import { UpdateDiscountDto } from './dto/update-discount.dto';
import {
  DiscountApplyTarget,
  DiscountEntity,
} from './entities/discount.entity';
import { DiscountCategoryEntity } from './entities/discount-category.entity';
import { DiscountProductEntity } from './entities/discount-product.entity';

@Injectable()
export class DiscountsService {
  constructor(
    @InjectRepository(DiscountEntity)
    private readonly discountsRepository: Repository<DiscountEntity>,
    @InjectRepository(DiscountCategoryEntity)
    private readonly discountCategoriesRepository: Repository<DiscountCategoryEntity>,
    @InjectRepository(DiscountProductEntity)
    private readonly discountProductsRepository: Repository<DiscountProductEntity>,
    @InjectRepository(CategoryEntity)
    private readonly categoriesRepository: Repository<CategoryEntity>,
    @InjectRepository(ProductEntity)
    private readonly productsRepository: Repository<ProductEntity>,
  ) {}

  async findAllForAdmin() {
    return this.discountsRepository.find({
      order: { createdAt: 'DESC' },
    });
  }

  async findAvailableOrderDiscounts() {
    const now = new Date();
    const discounts = await this.discountsRepository.find({
      where: {
        appliesTo: DiscountApplyTarget.ORDER,
        isActive: true,
      },
      order: { createdAt: 'DESC' },
    });

    return discounts
      .filter((discount) => {
        const withinDateRange =
          discount.startAt.getTime() <= now.getTime() &&
          discount.expireDate.getTime() >= now.getTime();
        const hasRemainingUsage =
          discount.usageLimit === null ||
          discount.usedCount < discount.usageLimit;

        return withinDateRange && hasRemainingUsage;
      })
      .map((discount) => ({
        id: discount.discountId,
        code: discount.discountCode,
        name: discount.discountName,
        description: discount.discountDescription,
        type: discount.discountType,
        value: discount.discountValue,
        minOrderValue: discount.minOrderValue,
        maxDiscountAmount: discount.maxDiscountAmount,
        expiresAt: discount.expireDate,
        isPrivate: discount.userId !== null,
      }));
  }

  async findOne(discountId: string) {
    const discount = await this.discountsRepository.findOneBy({ discountId });
    if (!discount) {
      throw new NotFoundException('Discount not found');
    }

    return {
      ...discount,
      categoryIds: await this.findDiscountCategoryIds(discount.discountId),
      productIds: await this.findDiscountProductIds(discount.discountId),
    };
  }

  async create(createDiscountDto: CreateDiscountDto) {
    await this.ensureDiscountCodeUnique(createDiscountDto.discountCode);
    this.validateDiscountDates(
      createDiscountDto.startAt,
      createDiscountDto.expireDate,
    );
    await this.validateDiscountTargets(createDiscountDto);

    const discount = this.discountsRepository.create({
      discountCode: this.normalizeDiscountCode(createDiscountDto.discountCode),
      discountName: createDiscountDto.discountName,
      discountType: createDiscountDto.discountType,
      appliesTo: createDiscountDto.appliesTo ?? DiscountApplyTarget.ORDER,
      startAt: new Date(createDiscountDto.startAt),
      expireDate: new Date(createDiscountDto.expireDate),
      userId: createDiscountDto.userId ?? null,
      discountDescription: createDiscountDto.discountDescription ?? null,
      discountValue: createDiscountDto.discountValue,
      isActive: createDiscountDto.isActive ?? true,
      usageLimit: createDiscountDto.usageLimit ?? null,
      usedCount: 0,
      minOrderValue: createDiscountDto.minOrderValue ?? '0',
      maxDiscountAmount: createDiscountDto.maxDiscountAmount ?? null,
    });

    const savedDiscount = await this.discountsRepository.save(discount);
    await this.syncDiscountTargets(savedDiscount.discountId, createDiscountDto);

    return this.findOne(savedDiscount.discountId);
  }

  async update(discountId: string, updateDiscountDto: UpdateDiscountDto) {
    const discount = await this.findOne(discountId);

    const nextCode = updateDiscountDto.discountCode
      ? this.normalizeDiscountCode(updateDiscountDto.discountCode)
      : discount.discountCode;
    await this.ensureDiscountCodeUnique(nextCode, discount.discountId);

    const nextStartAt = updateDiscountDto.startAt
      ? new Date(updateDiscountDto.startAt)
      : discount.startAt;
    const nextExpireDate = updateDiscountDto.expireDate
      ? new Date(updateDiscountDto.expireDate)
      : discount.expireDate;
    this.validateDiscountDates(nextStartAt, nextExpireDate);
    await this.validateDiscountTargets({
      appliesTo: updateDiscountDto.appliesTo ?? discount.appliesTo,
      categoryIds: updateDiscountDto.categoryIds,
      productIds: updateDiscountDto.productIds,
    });

    discount.discountCode = nextCode;
    discount.discountName =
      updateDiscountDto.discountName ?? discount.discountName;
    discount.discountType =
      updateDiscountDto.discountType ?? discount.discountType;
    discount.appliesTo = updateDiscountDto.appliesTo ?? discount.appliesTo;
    discount.startAt = nextStartAt;
    discount.expireDate = nextExpireDate;
    discount.userId =
      updateDiscountDto.userId !== undefined
        ? updateDiscountDto.userId || null
        : discount.userId;
    discount.discountDescription =
      updateDiscountDto.discountDescription ?? discount.discountDescription;
    discount.discountValue =
      updateDiscountDto.discountValue ?? discount.discountValue;
    discount.isActive = updateDiscountDto.isActive ?? discount.isActive;
    discount.usageLimit =
      updateDiscountDto.usageLimit !== undefined
        ? updateDiscountDto.usageLimit
        : discount.usageLimit;
    discount.minOrderValue =
      updateDiscountDto.minOrderValue ?? discount.minOrderValue;
    discount.maxDiscountAmount =
      updateDiscountDto.maxDiscountAmount !== undefined
        ? updateDiscountDto.maxDiscountAmount || null
        : discount.maxDiscountAmount;

    if (
      discount.usageLimit !== null &&
      discount.usedCount > discount.usageLimit
    ) {
      throw new BadRequestException(
        'Usage limit cannot be lower than used count',
      );
    }

    const savedDiscount = await this.discountsRepository.save(discount);
    await this.syncDiscountTargets(savedDiscount.discountId, {
      appliesTo: discount.appliesTo,
      categoryIds: updateDiscountDto.categoryIds,
      productIds: updateDiscountDto.productIds,
    });

    return this.findOne(savedDiscount.discountId);
  }

  async remove(discountId: string) {
    const discount = await this.findOne(discountId);
    await this.discountsRepository.remove(discount);

    return { success: true };
  }

  private normalizeDiscountCode(value: string) {
    return value.trim().toUpperCase();
  }

  private async ensureDiscountCodeUnique(
    discountCode: string,
    excludeDiscountId?: string,
  ) {
    const normalizedCode = this.normalizeDiscountCode(discountCode);
    const existingDiscount = await this.discountsRepository.findOneBy({
      discountCode: normalizedCode,
    });

    if (existingDiscount && existingDiscount.discountId !== excludeDiscountId) {
      throw new ConflictException('Discount code already exists');
    }
  }

  private validateDiscountDates(
    startAt: string | Date,
    expireDate: string | Date,
  ) {
    const startDate = startAt instanceof Date ? startAt : new Date(startAt);
    const expireDateValue =
      expireDate instanceof Date ? expireDate : new Date(expireDate);

    if (startDate.getTime() >= expireDateValue.getTime()) {
      throw new BadRequestException('Expire date must be after start date');
    }
  }

  private async validateDiscountTargets(payload: {
    appliesTo?: DiscountApplyTarget;
    categoryIds?: string[];
    productIds?: string[];
  }) {
    if (payload.appliesTo === DiscountApplyTarget.CATEGORY) {
      if (!payload.categoryIds || payload.categoryIds.length === 0) {
        throw new BadRequestException('Category discount requires categoryIds');
      }

      const categories = await this.categoriesRepository.findBy(
        payload.categoryIds.map((categoryId) => ({ categoryId })),
      );
      if (categories.length !== payload.categoryIds.length) {
        throw new NotFoundException('One or more categories not found');
      }
    }

    if (payload.appliesTo === DiscountApplyTarget.PRODUCT) {
      if (!payload.productIds || payload.productIds.length === 0) {
        throw new BadRequestException('Product discount requires productIds');
      }

      const products = await this.productsRepository.findBy(
        payload.productIds.map((productId) => ({ productId })),
      );
      if (products.length !== payload.productIds.length) {
        throw new NotFoundException('One or more products not found');
      }
    }
  }

  private async syncDiscountTargets(
    discountId: string,
    payload: {
      appliesTo?: DiscountApplyTarget;
      categoryIds?: string[];
      productIds?: string[];
    },
  ) {
    await this.discountCategoriesRepository.delete({ discountId });
    await this.discountProductsRepository.delete({ discountId });

    if (
      payload.appliesTo === DiscountApplyTarget.CATEGORY &&
      payload.categoryIds &&
      payload.categoryIds.length > 0
    ) {
      const entities = payload.categoryIds.map((categoryId) =>
        this.discountCategoriesRepository.create({ discountId, categoryId }),
      );
      await this.discountCategoriesRepository.save(entities);
    }

    if (
      payload.appliesTo === DiscountApplyTarget.PRODUCT &&
      payload.productIds &&
      payload.productIds.length > 0
    ) {
      const entities = payload.productIds.map((productId) =>
        this.discountProductsRepository.create({ discountId, productId }),
      );
      await this.discountProductsRepository.save(entities);
    }
  }

  private async findDiscountCategoryIds(discountId: string) {
    const mappings = await this.discountCategoriesRepository.find({
      where: { discountId },
      order: { categoryId: 'ASC' },
    });

    return mappings.map((item) => item.categoryId);
  }

  private async findDiscountProductIds(discountId: string) {
    const mappings = await this.discountProductsRepository.find({
      where: { discountId },
      order: { productId: 'ASC' },
    });

    return mappings.map((item) => item.productId);
  }
}
