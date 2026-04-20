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
import { ApplyCouponDto } from './dto/apply-coupon.dto';
import { CreateDiscountDto } from './dto/create-discount.dto';
import { UpdateDiscountDto } from './dto/update-discount.dto';
import { ValidateCouponDto } from './dto/validate-coupon.dto';
import { CouponUsageEntity } from './entities/coupon-usage.entity';
import { DiscountCategoryEntity } from './entities/discount-category.entity';
import { DiscountProductEntity } from './entities/discount-product.entity';
import {
  DiscountApplyTarget,
  DiscountEntity,
  DiscountType,
} from './entities/discount.entity';

@Injectable()
export class DiscountsService {
  constructor(
    @InjectRepository(DiscountEntity)
    private readonly discountsRepository: Repository<DiscountEntity>,
    @InjectRepository(DiscountCategoryEntity)
    private readonly discountCategoriesRepository: Repository<DiscountCategoryEntity>,
    @InjectRepository(DiscountProductEntity)
    private readonly discountProductsRepository: Repository<DiscountProductEntity>,
    @InjectRepository(CouponUsageEntity)
    private readonly couponUsageRepository: Repository<CouponUsageEntity>,
    @InjectRepository(CategoryEntity)
    private readonly categoriesRepository: Repository<CategoryEntity>,
    @InjectRepository(ProductEntity)
    private readonly productsRepository: Repository<ProductEntity>,
  ) {}

  // ─── ADMIN CRUD ──────────────────────────────────────────────────────────────

  async findAllForAdmin() {
    const discounts = await this.discountsRepository.find({
      order: { createdAt: 'DESC' },
    });

    return discounts.map((d) => ({
      ...d,
      isExpired: d.expireDate.getTime() < Date.now(),
      isStarted: d.startAt.getTime() <= Date.now(),
    }));
  }

  async findOne(discountId: string) {
    const discount = await this.discountsRepository.findOneBy({ discountId });
    if (!discount) {
      throw new NotFoundException('Discount not found');
    }

    const [categoryIds, productIds, stats] = await Promise.all([
      this.findDiscountCategoryIds(discount.discountId),
      this.findDiscountProductIds(discount.discountId),
      this.getDiscountStatsInternal(discount.discountId),
    ]);

    return {
      ...discount,
      categoryIds,
      productIds,
      stats,
      isExpired: discount.expireDate.getTime() < Date.now(),
      isStarted: discount.startAt.getTime() <= Date.now(),
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

    const saved = await this.discountsRepository.save(discount);
    await this.syncDiscountTargets(saved.discountId, createDiscountDto);

    return this.findOne(saved.discountId);
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

    const saved = await this.discountsRepository.save(discount);
    await this.syncDiscountTargets(saved.discountId, {
      appliesTo: discount.appliesTo,
      categoryIds: updateDiscountDto.categoryIds,
      productIds: updateDiscountDto.productIds,
    });

    return this.findOne(saved.discountId);
  }

  async remove(discountId: string) {
    const discount = await this.findOne(discountId);
    await this.discountsRepository.remove(discount);
    return { success: true };
  }

  async toggleActive(discountId: string) {
    const discount = await this.discountsRepository.findOneBy({ discountId });
    if (!discount) {
      throw new NotFoundException('Discount not found');
    }
    discount.isActive = !discount.isActive;
    await this.discountsRepository.save(discount);
    return { discountId, isActive: discount.isActive };
  }

  // ─── PUBLIC / USER ENDPOINTS ─────────────────────────────────────────────────

  async findAvailableOrderDiscounts() {
    const now = new Date();
    const discounts = await this.discountsRepository.find({
      where: { appliesTo: DiscountApplyTarget.ORDER, isActive: true },
      order: { createdAt: 'DESC' },
    });

    return discounts
      .filter((d) => {
        const withinRange =
          d.startAt.getTime() <= now.getTime() &&
          d.expireDate.getTime() >= now.getTime();
        const hasRemaining =
          d.usageLimit === null || d.usedCount < d.usageLimit;
        return withinRange && hasRemaining;
      })
      .map((d) => ({
        id: d.discountId,
        code: d.discountCode,
        name: d.discountName,
        description: d.discountDescription,
        type: d.discountType,
        value: d.discountValue,
        minOrderValue: d.minOrderValue,
        maxDiscountAmount: d.maxDiscountAmount,
        expiresAt: d.expireDate,
        isPrivate: d.userId !== null,
      }));
  }

  async validateCoupon(userId: string, dto: ValidateCouponDto) {
    const code = this.normalizeDiscountCode(dto.discountCode);
    const discount = await this.discountsRepository.findOneBy({
      discountCode: code,
      isActive: true,
    });

    if (!discount) {
      throw new NotFoundException('Discount code not found or inactive');
    }

    const now = new Date();
    if (discount.startAt.getTime() > now.getTime()) {
      throw new BadRequestException('Discount code is not yet active');
    }
    if (discount.expireDate.getTime() < now.getTime()) {
      throw new BadRequestException('Discount code has expired');
    }

    if (
      discount.usageLimit !== null &&
      discount.usedCount >= discount.usageLimit
    ) {
      throw new BadRequestException('Discount code usage limit reached');
    }

    if (discount.userId && discount.userId !== userId) {
      throw new BadRequestException('This discount code is not for your account');
    }

    const orderValue = Number(dto.orderValue);
    if (orderValue < Number(discount.minOrderValue)) {
      throw new BadRequestException(
        `Minimum order value is ${discount.minOrderValue}`,
      );
    }

    const perUserLimit = 1;
    const usageCount = await this.couponUsageRepository.countBy({
      discountId: discount.discountId,
      userId,
    });
    if (usageCount >= perUserLimit) {
      throw new BadRequestException(
        'You have already used this discount code',
      );
    }

    if (discount.appliesTo === DiscountApplyTarget.PRODUCT) {
      if (!dto.productIds || dto.productIds.length === 0) {
        throw new BadRequestException(
          'No applicable products in cart for this discount',
        );
      }
      const applicableProducts = await this.discountProductsRepository.findBy(
        dto.productIds.map((productId) => ({
          discountId: discount.discountId,
          productId,
        })),
      );
      if (applicableProducts.length === 0) {
        throw new BadRequestException(
          'No products in cart qualify for this discount',
        );
      }
    }

    const discountAmount = this.calculateDiscountAmount(discount, orderValue);
    const finalPrice = Math.max(0, orderValue - discountAmount);

    return {
      valid: true,
      discountId: discount.discountId,
      code: discount.discountCode,
      name: discount.discountName,
      type: discount.discountType,
      value: discount.discountValue,
      discountAmount: discountAmount.toFixed(2),
      finalPrice: finalPrice.toFixed(2),
      appliesTo: discount.appliesTo,
    };
  }

  async applyCoupon(userId: string, dto: ApplyCouponDto) {
    const code = this.normalizeDiscountCode(dto.discountCode);
    const discount = await this.discountsRepository.findOneBy({
      discountCode: code,
      isActive: true,
    });

    if (!discount) {
      throw new NotFoundException('Discount code not found');
    }

    const alreadyUsed = await this.couponUsageRepository.findOneBy({
      discountId: discount.discountId,
      userId,
      orderId: dto.orderId,
    });
    if (alreadyUsed) {
      throw new ConflictException('Coupon already applied to this order');
    }

    const usage = this.couponUsageRepository.create({
      discountId: discount.discountId,
      userId,
      orderId: dto.orderId,
    });
    await this.couponUsageRepository.save(usage);

    discount.usedCount += 1;
    await this.discountsRepository.save(discount);

    return { success: true, usedCount: discount.usedCount };
  }

  async getDiscountStats(discountId: string) {
    const discount = await this.discountsRepository.findOneBy({ discountId });
    if (!discount) {
      throw new NotFoundException('Discount not found');
    }
    return this.getDiscountStatsInternal(discountId);
  }

  async getUserCouponHistory(userId: string) {
    const usages = await this.couponUsageRepository.find({
      where: { userId },
      order: { usedAt: 'DESC' },
    });

    const discountIds = [...new Set(usages.map((u) => u.discountId))];
    const discounts = discountIds.length
      ? await this.discountsRepository.findBy(
          discountIds.map((id) => ({ discountId: id })),
        )
      : [];
    const discountMap = new Map(discounts.map((d) => [d.discountId, d]));

    return usages.map((u) => {
      const d = discountMap.get(u.discountId);
      return {
        usageId: u.usageId,
        orderId: u.orderId,
        usedAt: u.usedAt,
        discount: d
          ? {
              code: d.discountCode,
              name: d.discountName,
              type: d.discountType,
              value: d.discountValue,
            }
          : null,
      };
    });
  }

  async findDiscountsByProduct(productId: string) {
    const now = new Date();
    const productMappings = await this.discountProductsRepository.findBy({
      productId,
    });
    const discountIds = productMappings.map((m) => m.discountId);

    if (discountIds.length === 0) return [];

    const discounts = await this.discountsRepository.findBy(
      discountIds.map((id) => ({ discountId: id })),
    );

    return discounts.filter(
      (d) =>
        d.isActive &&
        d.startAt.getTime() <= now.getTime() &&
        d.expireDate.getTime() >= now.getTime(),
    );
  }

  async findDiscountsByCategory(categoryId: string) {
    const now = new Date();
    const categoryMappings = await this.discountCategoriesRepository.findBy({
      categoryId,
    });
    const discountIds = categoryMappings.map((m) => m.discountId);

    if (discountIds.length === 0) return [];

    const discounts = await this.discountsRepository.findBy(
      discountIds.map((id) => ({ discountId: id })),
    );

    return discounts.filter(
      (d) =>
        d.isActive &&
        d.startAt.getTime() <= now.getTime() &&
        d.expireDate.getTime() >= now.getTime(),
    );
  }

  // ─── PRIVATE HELPERS ─────────────────────────────────────────────────────────

  private calculateDiscountAmount(
    discount: DiscountEntity,
    orderValue: number,
  ) {
    const raw =
      discount.discountType === DiscountType.PERCENT
        ? (orderValue * Number(discount.discountValue)) / 100
        : Number(discount.discountValue);

    const max = discount.maxDiscountAmount
      ? Number(discount.maxDiscountAmount)
      : null;

    const capped = max !== null ? Math.min(raw, max) : raw;
    return Math.min(capped, orderValue);
  }

  private async getDiscountStatsInternal(discountId: string) {
    const totalUsage = await this.couponUsageRepository.countBy({ discountId });
    const uniqueUsers = await this.couponUsageRepository
      .createQueryBuilder('usage')
      .select('COUNT(DISTINCT usage.user_id)', 'count')
      .where('usage.discount_id = :discountId', { discountId })
      .getRawOne<{ count: string }>();

    return {
      totalUsage,
      uniqueUsers: Number(uniqueUsers?.count ?? 0),
    };
  }

  private normalizeDiscountCode(value: string) {
    return value.trim().toUpperCase();
  }

  private async ensureDiscountCodeUnique(
    discountCode: string,
    excludeDiscountId?: string,
  ) {
    const normalized = this.normalizeDiscountCode(discountCode);
    const existing = await this.discountsRepository.findOneBy({
      discountCode: normalized,
    });
    if (existing && existing.discountId !== excludeDiscountId) {
      throw new ConflictException('Discount code already exists');
    }
  }

  private validateDiscountDates(
    startAt: string | Date,
    expireDate: string | Date,
  ) {
    const start = startAt instanceof Date ? startAt : new Date(startAt);
    const expire =
      expireDate instanceof Date ? expireDate : new Date(expireDate);
    if (start.getTime() >= expire.getTime()) {
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
        payload.categoryIds.map((id) => ({ categoryId: id })),
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
        payload.productIds.map((id) => ({ productId: id })),
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
    await Promise.all([
      this.discountCategoriesRepository.delete({ discountId }),
      this.discountProductsRepository.delete({ discountId }),
    ]);

    if (
      payload.appliesTo === DiscountApplyTarget.CATEGORY &&
      payload.categoryIds?.length
    ) {
      const entities = payload.categoryIds.map((categoryId) =>
        this.discountCategoriesRepository.create({ discountId, categoryId }),
      );
      await this.discountCategoriesRepository.save(entities);
    }

    if (
      payload.appliesTo === DiscountApplyTarget.PRODUCT &&
      payload.productIds?.length
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
    return mappings.map((m) => m.categoryId);
  }

  private async findDiscountProductIds(discountId: string) {
    const mappings = await this.discountProductsRepository.find({
      where: { discountId },
      order: { productId: 'ASC' },
    });
    return mappings.map((m) => m.productId);
  }
}
