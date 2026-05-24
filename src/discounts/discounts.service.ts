import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { CategoryEntity } from '../categories/entities/category.entity';
import { ProductEntity } from '../products/entities/product.entity';
import { CreateDiscountDto } from './dto/create-discount.dto';
import { QueryAvailableCouponsDto } from './dto/query-available-coupons.dto';
import { UpdateDiscountDto } from './dto/update-discount.dto';
import { ValidateCouponDto } from './dto/validate-coupon.dto';
import { CouponUsageEntity } from './entities/coupon-usage.entity';
import { DiscountCategoryEntity } from './entities/discount-category.entity';
import { DiscountProductEntity } from './entities/discount-product.entity';
import { SavedVoucherEntity } from './entities/saved-voucher.entity';
import {
  DISCOUNT_APPROVAL_THRESHOLD_FIXED,
  DISCOUNT_APPROVAL_THRESHOLD_PCT,
  DiscountApplyTarget,
  DiscountApprovalStatus,
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
    @InjectRepository(SavedVoucherEntity)
    private readonly savedVoucherRepository: Repository<SavedVoucherEntity>,
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
    this.validateDiscountValue(
      createDiscountDto.discountType,
      createDiscountDto.discountValue,
      createDiscountDto.maxDiscountAmount,
    );
    this.validateNonNegativeMoney(
      createDiscountDto.minOrderValue ?? '0',
      'Min order value',
    );
    await this.validateDiscountTargets(createDiscountDto);

    // Approval logic: nếu giảm > 30% (PERCENT) hoặc > 1tr VND (FIXED) → cần duyệt
    const needApproval = this.discountNeedsApproval(
      createDiscountDto.discountType,
      createDiscountDto.discountValue,
    );

    const discount = this.discountsRepository.create({
      discountCode: this.normalizeDiscountCode(createDiscountDto.discountCode),
      discountName: createDiscountDto.discountName,
      discountType: createDiscountDto.discountType,
      appliesTo: createDiscountDto.appliesTo ?? DiscountApplyTarget.ORDER,
      startAt: new Date(createDiscountDto.startAt),
      expireDate: new Date(createDiscountDto.expireDate),
      userId: createDiscountDto.userId ?? null,
      discountDescription: createDiscountDto.discountDescription ?? null,
      discountValue: this.normalizeMoneyString(createDiscountDto.discountValue),
      // Nếu cần duyệt: tự động deactivate đến khi được duyệt
      isActive: needApproval ? false : (createDiscountDto.isActive ?? true),
      approvalStatus: needApproval
        ? DiscountApprovalStatus.PENDING_APPROVAL
        : DiscountApprovalStatus.NOT_REQUIRED,
      usageLimit: createDiscountDto.usageLimit ?? null,
      usedCount: 0,
      minOrderValue: this.normalizeMoneyString(
        createDiscountDto.minOrderValue ?? '0',
      ),
      maxDiscountAmount:
        createDiscountDto.maxDiscountAmount !== undefined
          ? this.normalizeMoneyString(createDiscountDto.maxDiscountAmount)
          : null,
    });

    const saved = await this.discountsRepository.save(discount);
    await this.syncDiscountTargets(saved.discountId, createDiscountDto);

    return this.findOne(saved.discountId);
  }

  private discountNeedsApproval(type: DiscountType, value: string | number): boolean {
    const v = Number(value);
    if (type === DiscountType.PERCENT) return v > DISCOUNT_APPROVAL_THRESHOLD_PCT;
    if (type === DiscountType.FIXED) return v > DISCOUNT_APPROVAL_THRESHOLD_FIXED;
    return false;
  }

  /**
   * Admin duyệt discount giảm sâu (cần permission manage_discounts).
   * approvedBy: id của admin duyệt.
   */
  async approveDiscount(
    discountId: string,
    approvedBy: string,
    note?: string,
  ) {
    const discount = await this.findOne(discountId);
    if (discount.approvalStatus !== DiscountApprovalStatus.PENDING_APPROVAL) {
      throw new BadRequestException(
        'Chỉ có thể duyệt discount đang ở trạng thái PENDING_APPROVAL',
      );
    }
    discount.approvalStatus = DiscountApprovalStatus.APPROVED;
    discount.approvedBy = approvedBy;
    discount.approvedAt = new Date();
    discount.approvalNote = note ?? null;
    discount.isActive = true; // tự active sau khi duyệt
    await this.discountsRepository.save(discount);
    return this.findOne(discountId);
  }

  /**
   * Admin từ chối discount giảm sâu.
   */
  async rejectDiscount(
    discountId: string,
    rejectedBy: string,
    note?: string,
  ) {
    const discount = await this.findOne(discountId);
    if (discount.approvalStatus !== DiscountApprovalStatus.PENDING_APPROVAL) {
      throw new BadRequestException(
        'Chỉ có thể từ chối discount đang ở trạng thái PENDING_APPROVAL',
      );
    }
    discount.approvalStatus = DiscountApprovalStatus.REJECTED;
    discount.approvedBy = rejectedBy;
    discount.approvedAt = new Date();
    discount.approvalNote = note ?? null;
    discount.isActive = false;
    await this.discountsRepository.save(discount);
    return this.findOne(discountId);
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
    this.validateDiscountValue(
      updateDiscountDto.discountType ?? discount.discountType,
      updateDiscountDto.discountValue ?? discount.discountValue,
      updateDiscountDto.maxDiscountAmount !== undefined
        ? updateDiscountDto.maxDiscountAmount
        : discount.maxDiscountAmount,
    );
    if (updateDiscountDto.minOrderValue !== undefined) {
      this.validateNonNegativeMoney(
        updateDiscountDto.minOrderValue,
        'Min order value',
      );
    }
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
    const valueChanged =
      updateDiscountDto.discountType !== undefined ||
      updateDiscountDto.discountValue !== undefined;
    discount.discountValue =
      updateDiscountDto.discountValue !== undefined
        ? this.normalizeMoneyString(updateDiscountDto.discountValue)
        : discount.discountValue;
    discount.isActive = updateDiscountDto.isActive ?? discount.isActive;
    discount.usageLimit =
      updateDiscountDto.usageLimit !== undefined
        ? updateDiscountDto.usageLimit
        : discount.usageLimit;
    discount.minOrderValue =
      updateDiscountDto.minOrderValue !== undefined
        ? this.normalizeMoneyString(updateDiscountDto.minOrderValue)
        : discount.minOrderValue;
    discount.maxDiscountAmount =
      updateDiscountDto.maxDiscountAmount !== undefined
        ? updateDiscountDto.maxDiscountAmount
          ? this.normalizeMoneyString(updateDiscountDto.maxDiscountAmount)
          : null
        : discount.maxDiscountAmount;

    if (
      valueChanged &&
      this.discountNeedsApproval(discount.discountType, discount.discountValue)
    ) {
      discount.approvalStatus = DiscountApprovalStatus.PENDING_APPROVAL;
      discount.approvedBy = null;
      discount.approvedAt = null;
      discount.approvalNote = null;
      discount.isActive = false;
    }

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
    const usageCount = await this.couponUsageRepository.countBy({ discountId });
    if (usageCount > 0) {
      discount.isActive = false;
      await this.discountsRepository.save(discount);
      return {
        success: true,
        archived: true,
        message: 'Discount has usage history and was deactivated instead',
      };
    }
    await this.discountsRepository.remove(discount);
    return { success: true };
  }

  async toggleActive(discountId: string) {
    const discount = await this.discountsRepository.findOneBy({ discountId });
    if (!discount) {
      throw new NotFoundException('Discount not found');
    }
    if (!discount.isActive && !this.isDiscountApprovedForUse(discount)) {
      throw new BadRequestException(
        'Discount must be approved before it can be activated',
      );
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
        const approvalOk = this.isDiscountApprovedForUse(d);
        return withinRange && hasRemaining && d.userId === null && approvalOk;
      })
      .map((d) => this.toVoucherPayload(d, { isSaved: false }));
  }

  async findAvailableCouponsForUser(
    userId: string,
    dto: QueryAvailableCouponsDto,
  ) {
    const now = new Date();
    const orderValue = Number(dto.orderValue ?? 0);
    const discounts = await this.discountsRepository.find({
      where: { isActive: true },
      order: { expireDate: 'ASC', createdAt: 'DESC' },
    });

    const visibleDiscounts = discounts.filter((discount) => {
      const withinRange =
        discount.startAt.getTime() <= now.getTime() &&
        discount.expireDate.getTime() >= now.getTime();
      const hasRemaining =
        discount.usageLimit === null ||
        discount.usedCount < discount.usageLimit;
      const visibleForUser =
        discount.userId === null || discount.userId === userId;
      const approvalOk = [
        DiscountApprovalStatus.NOT_REQUIRED,
        DiscountApprovalStatus.APPROVED,
      ].includes(discount.approvalStatus);

      return withinRange && hasRemaining && visibleForUser && approvalOk;
    });

    const [usageRows, savedRows] = visibleDiscounts.length
      ? await Promise.all([
          this.couponUsageRepository.findBy(
            visibleDiscounts.map((discount) => ({
              discountId: discount.discountId,
              userId,
            })),
          ),
          this.savedVoucherRepository.findBy(
            visibleDiscounts.map((discount) => ({
              discountId: discount.discountId,
              userId,
            })),
          ),
        ])
      : [[], []];
    const usedDiscountIds = new Set(
      usageRows.map((usage) => usage.discountId),
    );
    const savedDiscountIds = new Set(
      savedRows.map((saved) => saved.discountId),
    );

    const eligibleSubtotals = await this.calculateEligibleSubtotals(
      visibleDiscounts,
      dto.items,
      dto.productIds,
      orderValue,
    );

    return visibleDiscounts.map((discount) => {
      const minOrderValue = Number(discount.minOrderValue);
      const isUsed = usedDiscountIds.has(discount.discountId);
      const eligibleSubtotal =
        eligibleSubtotals.get(discount.discountId) ?? orderValue;
      const appliesToCart = eligibleSubtotal > 0;
      const missingAmount = Math.max(0, minOrderValue - eligibleSubtotal);
      const eligible = !isUsed && appliesToCart && missingAmount <= 0;
      const discountAmount =
        eligible && eligibleSubtotal > 0
          ? this.calculateDiscountAmount(discount, eligibleSubtotal)
          : 0;

      return {
        ...this.toVoucherPayload(discount, {
          isSaved: savedDiscountIds.has(discount.discountId),
        }),
        usageLimit: discount.usageLimit,
        usedCount: discount.usedCount,
        eligible,
        isUsed,
        missingAmount: missingAmount.toFixed(2),
        discountAmount: discountAmount.toFixed(2),
        finalPrice: Math.max(0, orderValue - discountAmount).toFixed(2),
        reason: isUsed
          ? 'Bạn đã dùng voucher này'
          : missingAmount > 0
            ? `Cần mua thêm ${missingAmount.toFixed(0)}đ để dùng voucher`
            : 'Có thể áp dụng cho giỏ hàng hiện tại',
      };
    });
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

    if (!this.isDiscountApprovedForUse(discount)) {
      throw new BadRequestException('Discount code is not approved for use');
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
    const eligibleSubtotal =
      (
        await this.calculateEligibleSubtotals(
          [discount],
          dto.items,
          dto.productIds,
          orderValue,
        )
      ).get(discount.discountId) ?? orderValue;

    if (eligibleSubtotal <= 0) {
      throw new BadRequestException(
        'No products in cart qualify for this discount',
      );
    }

    if (eligibleSubtotal < Number(discount.minOrderValue)) {
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

    const discountAmount = this.calculateDiscountAmount(
      discount,
      eligibleSubtotal,
    );
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

  async saveVoucher(userId: string, discountId: string) {
    const discount = await this.discountsRepository.findOneBy({ discountId });
    if (!discount || !this.isDiscountClaimableByUser(discount, userId)) {
      throw new NotFoundException('Voucher not found or unavailable');
    }

    const existing = await this.savedVoucherRepository.findOneBy({
      userId,
      discountId,
    });
    if (existing) {
      return {
        saved: true,
        savedAt: existing.savedAt,
        voucher: this.toVoucherPayload(discount, { isSaved: true }),
      };
    }

    const saved = await this.savedVoucherRepository.save(
      this.savedVoucherRepository.create({ userId, discountId }),
    );

    return {
      saved: true,
      savedAt: saved.savedAt,
      voucher: this.toVoucherPayload(discount, { isSaved: true }),
    };
  }

  async getSavedVouchers(userId: string) {
    const rows = await this.savedVoucherRepository.find({
      where: { userId },
      order: { savedAt: 'DESC' },
    });
    const discountIds = rows.map((row) => row.discountId);
    const discounts = discountIds.length
      ? await this.discountsRepository.findBy(
          discountIds.map((discountId) => ({ discountId })),
        )
      : [];
    const discountMap = new Map(
      discounts.map((discount) => [discount.discountId, discount]),
    );

    return rows
      .map((row) => {
        const discount = discountMap.get(row.discountId);
        if (!discount) return null;
        return {
          savedVoucherId: row.savedVoucherId,
          savedAt: row.savedAt,
          ...this.toVoucherPayload(discount, { isSaved: true }),
          isAvailable: this.isDiscountClaimableByUser(discount, userId),
        };
      })
      .filter(Boolean);
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
        d.expireDate.getTime() >= now.getTime() &&
        this.isDiscountApprovedForUse(d),
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
        d.expireDate.getTime() >= now.getTime() &&
        this.isDiscountApprovedForUse(d),
    );
  }

  // ─── PRIVATE HELPERS ─────────────────────────────────────────────────────────

  private toVoucherPayload(
    discount: DiscountEntity,
    options: { isSaved?: boolean } = {},
  ) {
    return {
      id: discount.discountId,
      code: discount.discountCode,
      name: discount.discountName,
      description: discount.discountDescription,
      type: discount.discountType,
      value: discount.discountValue,
      appliesTo: discount.appliesTo,
      minOrderValue: discount.minOrderValue,
      maxDiscountAmount: discount.maxDiscountAmount,
      expiresAt: discount.expireDate,
      isPrivate: discount.userId !== null,
      usageLimit: discount.usageLimit,
      usedCount: discount.usedCount,
      remainingUses: this.getRemainingUses(discount),
      isSaved: options.isSaved ?? false,
    };
  }

  private getRemainingUses(discount: DiscountEntity) {
    if (discount.usageLimit === null) return null;
    return Math.max(0, discount.usageLimit - discount.usedCount);
  }

  private isDiscountApprovedForUse(discount: DiscountEntity) {
    return [
      DiscountApprovalStatus.NOT_REQUIRED,
      DiscountApprovalStatus.APPROVED,
    ].includes(discount.approvalStatus);
  }

  private isDiscountClaimableByUser(discount: DiscountEntity, userId: string) {
    const now = Date.now();
    return (
      discount.isActive &&
      discount.startAt.getTime() <= now &&
      discount.expireDate.getTime() >= now &&
      this.getRemainingUses(discount) !== 0 &&
      (discount.userId === null || discount.userId === userId) &&
      this.isDiscountApprovedForUse(discount)
    );
  }

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

  private async calculateEligibleSubtotals(
    discounts: DiscountEntity[],
    items:
      | Array<{ productId: string; quantity: string; unitPrice: string }>
      | undefined,
    productIds: string[] | undefined,
    orderValue: number,
  ) {
    const result = new Map<string, number>();
    const lineItems =
      items?.map((item) => ({
        productId: item.productId,
        quantity: Math.max(0, Number(item.quantity)),
        unitPrice: Math.max(0, Number(item.unitPrice)),
      })) ?? [];
    const ids = [
      ...new Set([
        ...lineItems.map((item) => item.productId),
        ...(productIds ?? []),
      ]),
    ];

    const products = ids.length
      ? await this.productsRepository.find({
          where: { productId: In(ids) },
          select: ['productId', 'categoryId'],
        })
      : [];
    const categoryByProductId = new Map(
      products.map((product) => [product.productId, product.categoryId]),
    );

    for (const discount of discounts) {
      if (discount.appliesTo === DiscountApplyTarget.ORDER) {
        result.set(discount.discountId, orderValue);
        continue;
      }

      if (discount.appliesTo === DiscountApplyTarget.PRODUCT) {
        const mappings = await this.discountProductsRepository.find({
          where: { discountId: discount.discountId },
        });
        const applicableProductIds = new Set(
          mappings.map((mapping) => mapping.productId),
        );
        const hasApplicableProduct = ids.some((id) =>
          applicableProductIds.has(id),
        );
        const subtotal = lineItems.length
          ? lineItems
              .filter((line) => applicableProductIds.has(line.productId))
              .reduce(
                (sum, line) => sum + line.quantity * line.unitPrice,
                0,
              )
          : hasApplicableProduct
            ? orderValue
            : 0;
        result.set(discount.discountId, subtotal);
        continue;
      }

      const mappings = await this.discountCategoriesRepository.find({
        where: { discountId: discount.discountId },
      });
      const applicableCategoryIds = new Set(
        mappings.map((mapping) => String(mapping.categoryId)),
      );
      const hasApplicableCategory = ids.some((id) =>
        applicableCategoryIds.has(String(categoryByProductId.get(id))),
      );
      const subtotal = lineItems.length
        ? lineItems
            .filter((line) =>
              applicableCategoryIds.has(
                String(categoryByProductId.get(line.productId)),
              ),
            )
            .reduce((sum, line) => sum + line.quantity * line.unitPrice, 0)
        : hasApplicableCategory
          ? orderValue
          : 0;
      result.set(discount.discountId, subtotal);
    }

    return result;
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

  private normalizeMoneyString(value: string | number) {
    const num = Number(value);
    if (!Number.isFinite(num)) {
      throw new BadRequestException('Money value must be numeric');
    }
    return num.toFixed(2);
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

  private validateDiscountValue(
    type: DiscountType | string,
    value: string | number,
    maxDiscountAmount?: string | number | null,
  ) {
    const numValue = Number(value);
    if (isNaN(numValue) || numValue <= 0) {
      throw new BadRequestException('Discount value must be greater than 0');
    }
    if (type === DiscountType.PERCENT && numValue > 100) {
      throw new BadRequestException('Percent discount cannot exceed 100%');
    }
    if (maxDiscountAmount != null) {
      const numMax = Number(maxDiscountAmount);
      if (isNaN(numMax) || numMax <= 0) {
        throw new BadRequestException('Max discount amount must be greater than 0');
      }
    }
  }

  private validateNonNegativeMoney(value: string | number, label: string) {
    const numValue = Number(value);
    if (isNaN(numValue) || numValue < 0) {
      throw new BadRequestException(`${label} must be greater than or equal 0`);
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
