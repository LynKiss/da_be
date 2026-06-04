import { createHash, createHmac, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, LessThan, Repository } from 'typeorm';
import { WarehouseEntity } from '../warehouses/entities/warehouse.entity';
import { WarehouseStockEntity } from '../warehouses/entities/warehouse-stock.entity';
import { CartItemEntity } from '../carts/entities/cart-item.entity';
import { ShoppingCartEntity } from '../carts/entities/shopping-cart.entity';
import { DiscountCategoryEntity } from '../discounts/entities/discount-category.entity';
import {
  DiscountApplyTarget,
  DiscountApprovalStatus,
  DiscountEntity,
  DiscountType,
} from '../discounts/entities/discount.entity';
import { CouponUsageEntity } from '../discounts/entities/coupon-usage.entity';
import { DiscountProductEntity } from '../discounts/entities/discount-product.entity';
import {
  InventoryTransactionEntity,
  InventoryTransactionType,
} from '../products/entities/inventory-transaction.entity';
import { ProductImageEntity } from '../products/entities/product-image.entity';
import { ProductEntity } from '../products/entities/product.entity';
import { ProductBatchService } from '../products/product-batch.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OrdersAdminPublisher } from './orders-admin.publisher';
import { SettingsService } from '../settings/settings.service';
import type { IUser } from '../users/users.interface';
import { UserEntity } from '../users/entities/user.entity';
import { withDeadlockRetry } from '../common/transaction.util';
import {
  buildVnpayPaymentQuery,
  verifyMomoSignature,
  verifyVnpaySignature,
  verifyZaloPayCallback,
} from '../common/payment-signature.util';
import { CreateReturnDto } from './dto/create-return.dto';
import { CreateCancelPaidRefundDto } from './dto/create-cancel-paid-refund.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { InitiatePaymentDto } from './dto/initiate-payment.dto';
import { PaymentCallbackDto } from './dto/payment-callback.dto';
import { QueryOrdersDto } from './dto/query-orders.dto';
import { UpdateOrderTrackingLiveDto } from './dto/update-order-tracking-live.dto';
import { UpdateOrderTrackingManualDto } from './dto/update-order-tracking-manual.dto';
import { UpdateOrderTrackingModeDto } from './dto/update-order-tracking-mode.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { UpdateReturnStatusDto } from './dto/update-return-status.dto';
import { UpdateOrderRefundStatusDto } from './dto/update-order-refund-status.dto';
import { DeliveryMethodEntity } from './entities/delivery-method.entity';
import { DeliveryMethodAreaEntity } from './entities/delivery-method-area.entity';
import { OrderItemEntity } from './entities/order-item.entity';
import {
  OrderTrackingEntity,
  OrderTrackingMode,
} from './entities/order-tracking.entity';
import {
  OrderEntity,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
} from './entities/order.entity';
import { OrderStatusHistoryEntity } from './entities/order-status-history.entity';
import {
  OrderRefundEntity,
  OrderRefundReason,
  OrderRefundStatus,
} from './entities/order-refund.entity';
import {
  PaymentTransactionEntity,
  PaymentTransactionStatus,
} from './entities/payment-transaction.entity';
import {
  ReturnEntity,
  ReturnInspectionStatus,
  ReturnStatus,
} from './entities/return.entity';
import { ShippingAddressEntity } from './entities/shipping-address.entity';
import { MembershipService } from '../membership/membership.service';
import { CustomerCreditLimitEntity } from '../credit-limits/entities/customer-credit-limit.entity';
import { quoteDeliveryMethod } from './delivery-method.util';
import {
  FulfillmentErrorCode,
  inactiveDeliveryMethod,
  invalidFulfillmentInput,
} from './fulfillment-error';

const RETURN_WINDOW_DAYS = 7;
const RETURN_WINDOW_MS = RETURN_WINDOW_DAYS * 24 * 60 * 60 * 1000;

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);
  private readonly liveTrackingFreshnessMs = 2 * 60 * 1000;
  private readonly stalePaymentTtlMs = 30 * 60 * 1000; // 30 phút

  constructor(
    @InjectRepository(DeliveryMethodEntity)
    private readonly deliveryMethodsRepository: Repository<DeliveryMethodEntity>,
    @InjectRepository(DeliveryMethodAreaEntity)
    private readonly deliveryMethodAreasRepository: Repository<DeliveryMethodAreaEntity>,
    @InjectRepository(ShippingAddressEntity)
    private readonly shippingAddressesRepository: Repository<ShippingAddressEntity>,
    @InjectRepository(OrderEntity)
    private readonly ordersRepository: Repository<OrderEntity>,
    @InjectRepository(OrderTrackingEntity)
    private readonly orderTrackingRepository: Repository<OrderTrackingEntity>,
    @InjectRepository(OrderItemEntity)
    private readonly orderItemsRepository: Repository<OrderItemEntity>,
    @InjectRepository(OrderStatusHistoryEntity)
    private readonly orderStatusHistoryRepository: Repository<OrderStatusHistoryEntity>,
    @InjectRepository(ShoppingCartEntity)
    private readonly cartsRepository: Repository<ShoppingCartEntity>,
    @InjectRepository(CartItemEntity)
    private readonly cartItemsRepository: Repository<CartItemEntity>,
    @InjectRepository(ProductEntity)
    private readonly productsRepository: Repository<ProductEntity>,
    @InjectRepository(ProductImageEntity)
    private readonly productImagesRepository: Repository<ProductImageEntity>,
    @InjectRepository(InventoryTransactionEntity)
    private readonly inventoryTransactionsRepository: Repository<InventoryTransactionEntity>,
    @InjectRepository(UserEntity)
    private readonly usersRepository: Repository<UserEntity>,
    @InjectRepository(DiscountEntity)
    private readonly discountsRepository: Repository<DiscountEntity>,
    @InjectRepository(DiscountCategoryEntity)
    private readonly discountCategoriesRepository: Repository<DiscountCategoryEntity>,
    @InjectRepository(DiscountProductEntity)
    private readonly discountProductsRepository: Repository<DiscountProductEntity>,
    @InjectRepository(CouponUsageEntity)
    private readonly couponUsageRepository: Repository<CouponUsageEntity>,
    @InjectRepository(ReturnEntity)
    private readonly returnsRepository: Repository<ReturnEntity>,
    @InjectRepository(OrderRefundEntity)
    private readonly orderRefundsRepository: Repository<OrderRefundEntity>,
    @InjectRepository(PaymentTransactionEntity)
    private readonly paymentTransactionsRepository: Repository<PaymentTransactionEntity>,
    @InjectRepository(CustomerCreditLimitEntity)
    private readonly creditLimitRepository: Repository<CustomerCreditLimitEntity>,
    private readonly notificationsService: NotificationsService,
    private readonly ordersAdminPublisher: OrdersAdminPublisher,
    private readonly settingsService: SettingsService,
    private readonly membershipService: MembershipService,
    private readonly batchService: ProductBatchService,
  ) {}

  private async syncDefaultWarehouseStock(
    em: EntityManager,
    productId: string,
    qtyDelta: number,
  ): Promise<void> {
    if (qtyDelta === 0) return;
    const warehouse = await em.findOne(WarehouseEntity, {
      where: { isDefault: true },
    });
    if (!warehouse) return;
    const stock = await em.findOne(WarehouseStockEntity, {
      where: { warehouseId: warehouse.warehouseId, productId },
    });
    if (stock) {
      stock.quantity = Math.max(0, stock.quantity + qtyDelta);
      await em.save(WarehouseStockEntity, stock);
    } else if (qtyDelta > 0) {
      await em.save(
        WarehouseStockEntity,
        em.create(WarehouseStockEntity, {
          warehouseId: warehouse.warehouseId,
          productId,
          quantity: qtyDelta,
        }),
      );
    }
  }

  private async ensureUserExists(userId: string) {
    const user = await this.usersRepository.findOneBy({ userId });
    if (!user) {
      throw new UnauthorizedException('Nguoi dung khong ton tai');
    }

    return user;
  }

  private async findOwnedOrder(userId: string, orderId: string) {
    const order = await this.ordersRepository.findOneBy({ orderId, userId });
    if (!order) {
      throw new NotFoundException('Order not found');
    }

    return order;
  }

  private async findAnyOrder(orderId: string) {
    const order = await this.ordersRepository.findOneBy({ orderId });
    if (!order) {
      throw new NotFoundException('Order not found');
    }

    return order;
  }

  private hasManageOrdersPermission(currentUser: IUser) {
    return currentUser.permissions.some(
      (permission) => permission.key === 'manage_orders',
    );
  }

  private async createGuestUserRecord(
    entityManager: EntityManager,
    userId: string,
    orderId: string,
  ) {
    const compactOrderId = orderId.replace(/-/g, '');
    await entityManager.query(
      `INSERT INTO users
        (user_id, username, email, role, password_hash, provider, provider_id, is_active)
       VALUES (?, ?, ?, 'customer', NULL, 'guest', ?, 1)`,
      [
        userId,
        `guest_${compactOrderId.slice(0, 24)}`,
        `guest_${compactOrderId}@guest.local`,
        orderId,
      ],
    );
  }

  private async isGuestUserId(userId: string) {
    if (userId.startsWith('guest-')) {
      return true;
    }

    const rows = (await this.ordersRepository.manager.query(
      'SELECT provider FROM users WHERE user_id = ? LIMIT 1',
      [userId],
    )) as Array<{ provider?: string | null }>;

    return rows[0]?.provider === 'guest';
  }

  private async findAccessibleOrder(currentUser: IUser, orderId: string) {
    return this.hasManageOrdersPermission(currentUser)
      ? this.findAnyOrder(orderId)
      : this.findOwnedOrder(currentUser._id, orderId);
  }

  private async findOrCreateOrderTracking(orderId: string) {
    const existing = await this.orderTrackingRepository.findOneBy({ orderId });
    if (existing) {
      return existing;
    }

    const created = this.orderTrackingRepository.create({
      orderId,
      mode: OrderTrackingMode.AUTO_FALLBACK,
      manualLatitude: null,
      manualLongitude: null,
      manualNote: null,
      manualUpdatedAt: null,
      manualUpdatedBy: null,
      gpsLatitude: null,
      gpsLongitude: null,
      gpsHeading: null,
      gpsSpeedKph: null,
      gpsProvider: null,
      gpsUpdatedAt: null,
    });

    return this.orderTrackingRepository.save(created);
  }

  private toNullableNumber(value: string | number | null | undefined) {
    if (value === null || value === undefined || value === '') {
      return null;
    }

    const next = Number(value);
    return Number.isFinite(next) ? next : null;
  }

  private mapTrackingPoint(input: {
    latitude: string | null;
    longitude: string | null;
    updatedAt: Date | null;
    note?: string | null;
    updatedBy?: string | null;
    heading?: string | null;
    speedKph?: string | null;
    provider?: string | null;
  }) {
    const latitude = this.toNullableNumber(input.latitude);
    const longitude = this.toNullableNumber(input.longitude);

    if (latitude === null || longitude === null) {
      return null;
    }

    return {
      latitude,
      longitude,
      updatedAt: input.updatedAt,
      note: input.note ?? null,
      updatedBy: input.updatedBy ?? null,
      heading: this.toNullableNumber(input.heading),
      speedKph: this.toNullableNumber(input.speedKph),
      provider: input.provider ?? null,
    };
  }

  private mapOrderTracking(tracking: OrderTrackingEntity) {
    const manualLocation = this.mapTrackingPoint({
      latitude: tracking.manualLatitude,
      longitude: tracking.manualLongitude,
      updatedAt: tracking.manualUpdatedAt,
      note: tracking.manualNote,
      updatedBy: tracking.manualUpdatedBy,
    });
    const gpsLocation = this.mapTrackingPoint({
      latitude: tracking.gpsLatitude,
      longitude: tracking.gpsLongitude,
      updatedAt: tracking.gpsUpdatedAt,
      heading: tracking.gpsHeading,
      speedKph: tracking.gpsSpeedKph,
      provider: tracking.gpsProvider,
    });

    const gpsSignalFresh = Boolean(
      gpsLocation &&
        tracking.gpsUpdatedAt &&
        Date.now() - tracking.gpsUpdatedAt.getTime() <=
          this.liveTrackingFreshnessMs,
    );

    let activeSource: 'manual' | 'gps' | 'none' = 'none';
    let activeLocation: ReturnType<OrdersService['mapTrackingPoint']> = null;

    if (tracking.mode === OrderTrackingMode.DEMO) {
      activeSource = manualLocation ? 'manual' : 'none';
      activeLocation = manualLocation;
    } else if (tracking.mode === OrderTrackingMode.LIVE) {
      activeSource = gpsLocation ? 'gps' : 'none';
      activeLocation = gpsLocation;
    } else if (gpsSignalFresh && gpsLocation) {
      activeSource = 'gps';
      activeLocation = gpsLocation;
    } else if (manualLocation) {
      activeSource = 'manual';
      activeLocation = manualLocation;
    } else if (gpsLocation) {
      activeSource = 'gps';
      activeLocation = gpsLocation;
    }

    return {
      orderId: tracking.orderId,
      mode: tracking.mode,
      gpsSignalFresh,
      activeSource,
      activeLocation,
      manualLocation,
      gpsLocation,
      updatedAt: tracking.updatedAt,
    };
  }

  private isOnlinePaymentMethod(method: PaymentMethod) {
    return [
      PaymentMethod.MOMO,
      PaymentMethod.VNPAY,
      PaymentMethod.ZALOPAY,
    ].includes(method);
  }

  private getPaymentDeadline(order: OrderEntity) {
    if (!this.isOnlinePaymentMethod(order.paymentMethod)) {
      return null;
    }
    return new Date(order.createdAt.getTime() + this.stalePaymentTtlMs);
  }

  private getPaymentRetryInfo(order: OrderEntity) {
    const paymentDeadline = this.getPaymentDeadline(order);
    const now = Date.now();
    const paymentTimeRemainingSeconds = paymentDeadline
      ? Math.max(0, Math.floor((paymentDeadline.getTime() - now) / 1000))
      : null;
    const hasCollectedPayment = [
      PaymentStatus.PAID,
      PaymentStatus.PARTIAL_REFUNDED,
      PaymentStatus.REFUNDED,
    ].includes(order.paymentStatus);
    const isClosed = [
      OrderStatus.CANCELLED,
      OrderStatus.RETURNED,
      OrderStatus.DELIVERED,
      OrderStatus.PARTIAL_DELIVERED,
      OrderStatus.PARTIAL_RETURNED,
      OrderStatus.SHIPPING,
      OrderStatus.PROCESSING,
    ].includes(order.orderStatus);
    const retryableStatus = [OrderStatus.PENDING, OrderStatus.BACKORDERED].includes(
      order.orderStatus,
    );
    const retryablePaymentStatus = [
      PaymentStatus.UNPAID,
      PaymentStatus.FAILED,
    ].includes(order.paymentStatus);
    const expired = paymentDeadline ? paymentDeadline.getTime() <= now : false;
    let paymentBlockedReason: string | null = null;

    if (!this.isOnlinePaymentMethod(order.paymentMethod)) {
      paymentBlockedReason = 'UNSUPPORTED_PAYMENT_METHOD';
    } else if (hasCollectedPayment) {
      paymentBlockedReason = 'ALREADY_PAID';
    } else if (isClosed) {
      paymentBlockedReason = 'ORDER_CANCELLED';
    } else if (expired) {
      paymentBlockedReason = 'PAYMENT_EXPIRED';
    }

    const canRetryPayment =
      !paymentBlockedReason && retryableStatus && retryablePaymentStatus;
    const canCancelUnpaid =
      !hasCollectedPayment &&
      [OrderStatus.PENDING, OrderStatus.CONFIRMED, OrderStatus.BACKORDERED].includes(
        order.orderStatus,
      );

    return {
      paymentDeadline,
      paymentTimeRemainingSeconds,
      canRetryPayment,
      canCancelUnpaid,
      paymentBlockedReason,
    };
  }

  private isTerminalOrderStatus(status: OrderStatus) {
    return [OrderStatus.CANCELLED, OrderStatus.RETURNED].includes(status);
  }

  private assertOrderCanAcceptPayment(order: OrderEntity) {
    if (this.isTerminalOrderStatus(order.orderStatus)) {
      throw new BadRequestException({
        message:
          'Order is already closed and cannot accept a payment confirmation.',
        error: 'PAYMENT_FOR_CLOSED_ORDER_REQUIRES_RECONCILIATION',
      });
    }
  }

  private async createLatePaymentRefundIfNeeded(params: {
    order: OrderEntity;
    amount: number;
    provider: PaymentMethod;
    transactionRef: string;
    note?: string;
  }) {
    const { order, amount, provider, transactionRef, note } = params;
    if (!Number.isFinite(amount) || amount <= 0) {
      return null;
    }

    const existingOpenRefund = await this.orderRefundsRepository.findOne({
      where: {
        orderId: order.orderId,
        reason: OrderRefundReason.MANUAL_ADJUSTMENT,
        refundStatus: In([
          OrderRefundStatus.PENDING,
          OrderRefundStatus.APPROVED,
        ]),
      },
    });
    if (existingOpenRefund) {
      return existingOpenRefund;
    }

    const refund = this.orderRefundsRepository.create({
      orderId: order.orderId,
      returnId: null,
      reason: OrderRefundReason.MANUAL_ADJUSTMENT,
      amount: this.toMoney(amount),
      refundStatus: OrderRefundStatus.PENDING,
      paymentProvider: provider,
      manualReference: transactionRef,
      createdBy: null,
      note:
        note ??
        `Late payment arrived after order was closed. Provider ref: ${transactionRef}`,
    });
    return this.orderRefundsRepository.save(refund);
  }

  private async ensurePaymentMethodEnabled(method: PaymentMethod) {
    if (method === PaymentMethod.PAYPAL) {
      throw new BadRequestException('Payment method is not supported');
    }
    if (method === PaymentMethod.CREDIT) {
      return;
    }

    const isActive = await this.settingsService.isPaymentMethodActive(method);
    if (!isActive) {
      throw new BadRequestException('Payment method is currently disabled');
    }
  }

  private validateReturnStatusTransition(
    currentStatus: ReturnStatus,
    nextStatus: ReturnStatus,
  ) {
    const allowedTransitions: Record<ReturnStatus, ReturnStatus[]> = {
      [ReturnStatus.REQUESTED]: [ReturnStatus.APPROVED, ReturnStatus.REJECTED],
      [ReturnStatus.APPROVED]: [ReturnStatus.RECEIVED, ReturnStatus.REJECTED],
      [ReturnStatus.REJECTED]: [],
      // Physical returns must be inspected before money is closed.
      [ReturnStatus.RECEIVED]: [ReturnStatus.INSPECTED],
      [ReturnStatus.INSPECTED]: [ReturnStatus.REFUNDED],
      [ReturnStatus.REFUNDED]: [],
    };

    return allowedTransitions[currentStatus].includes(nextStatus);
  }

  private buildAddressSnapshot(address: ShippingAddressEntity) {
    return [
      address.addressLine,
      address.ward,
      address.district,
      address.province,
    ]
      .filter((value) => value && value.trim().length > 0)
      .join(', ');
  }

  /**
   * Legacy checkout is unreachable from the current controller.
   * Keep this helper scoped to that dead path until the legacy method is deleted.
   */
  private calculateLegacyDeliveryCost(
    deliveryMethod: DeliveryMethodEntity,
    subtotalAmount: number,
  ) {
    if (deliveryMethod.isPickup) {
      return 0;
    }

    const freeShippingThreshold = Number(
      deliveryMethod.freeShippingThreshold ?? 0,
    );
    if (freeShippingThreshold > 0 && subtotalAmount >= freeShippingThreshold) {
      return 0;
    }

    return Number(deliveryMethod.basePrice);
  }

  private async quoteMethodForOrder(
    deliveryMethod: DeliveryMethodEntity,
    subtotalAmount: number,
    location?: { province?: string | null; district?: string | null },
  ) {
    const areas = await this.deliveryMethodAreasRepository.find({
      where: { deliveryId: deliveryMethod.deliveryId },
    });
    return quoteDeliveryMethod(deliveryMethod, areas, subtotalAmount, location);
  }

  private async assertDeliveryMethodEligible(
    deliveryMethod: DeliveryMethodEntity,
    subtotalAmount: number,
    location?: { province?: string | null; district?: string | null },
  ) {
    const quote = await this.quoteMethodForOrder(
      deliveryMethod,
      subtotalAmount,
      location,
    );
    if (!quote.minimumOrderMet) {
      throw invalidFulfillmentInput(
        FulfillmentErrorCode.DELIVERY_MIN_ORDER_NOT_MET,
        `Đơn hàng chưa đạt giá trị tối thiểu để chọn ${deliveryMethod.name}`,
      );
    }
    if (!quote.areaMatched) {
      throw invalidFulfillmentInput(
        FulfillmentErrorCode.DELIVERY_OUT_OF_AREA,
        `${deliveryMethod.name} không áp dụng cho khu vực nhận hàng này`,
      );
    }
    return quote;
  }

  private calculateDiscountAmount(
    discount: DiscountEntity,
    subtotalAmount: number,
  ) {
    const rawDiscount =
      discount.discountType === DiscountType.PERCENT
        ? (subtotalAmount * Number(discount.discountValue)) / 100
        : Number(discount.discountValue);

    const maxDiscountAmount = discount.maxDiscountAmount
      ? Number(discount.maxDiscountAmount)
      : null;

    const finalDiscount =
      maxDiscountAmount !== null
        ? Math.min(rawDiscount, maxDiscountAmount)
        : rawDiscount;

    return Math.max(0, Math.min(finalDiscount, subtotalAmount));
  }

  private getEffectivePrice(product: ProductEntity) {
    const sale =
      product.productPriceSale != null ? Number(product.productPriceSale) : null;
    return sale != null && sale > 0
      ? product.productPriceSale!
      : product.productPrice;
  }

  private toMoney(value: string | number | null | undefined) {
    return Number(value ?? 0).toFixed(2);
  }

  private toCents(value: string | number | null | undefined) {
    return Math.round(Number(value ?? 0) * 100);
  }

  private fromCents(value: number) {
    return (value / 100).toFixed(2);
  }

  private allocateFinancialSnapshots(
    lines: Array<{ key: string; grossAmount: number }>,
    discountAmount: number,
  ) {
    const grossCents = lines.map((line) => ({
      key: line.key,
      gross: Math.max(0, this.toCents(line.grossAmount)),
    }));
    const totalGross = grossCents.reduce((sum, line) => sum + line.gross, 0);
    const cappedDiscount = Math.min(
      Math.max(0, this.toCents(discountAmount)),
      totalGross,
    );
    let remainingDiscount = cappedDiscount;
    const snapshots = new Map<
      string,
      { grossLineTotal: string; discountAllocated: string; netLineTotal: string }
    >();

    grossCents.forEach((line, index) => {
      const allocated =
        index === grossCents.length - 1 || totalGross === 0
          ? remainingDiscount
          : Math.min(
              remainingDiscount,
              Math.round((cappedDiscount * line.gross) / totalGross),
            );
      remainingDiscount -= allocated;
      snapshots.set(line.key, {
        grossLineTotal: this.fromCents(line.gross),
        discountAllocated: this.fromCents(allocated),
        netLineTotal: this.fromCents(Math.max(0, line.gross - allocated)),
      });
    });

    return snapshots;
  }

  private getOrderItemGrossAmount(item: OrderItemEntity) {
    const snapshot = Number(item.grossLineTotal ?? 0);
    return snapshot > 0 ? snapshot : Number(item.lineTotal ?? 0);
  }

  private getOrderItemNetAmount(item: OrderItemEntity) {
    const snapshot = Number(item.netLineTotal ?? 0);
    if (snapshot > 0 || this.getOrderItemGrossAmount(item) === 0) {
      return snapshot;
    }

    return Math.max(
      0,
      this.getOrderItemGrossAmount(item) - Number(item.discountAllocated ?? 0),
    );
  }

  private getRefundableAmountForQuantity(
    item: OrderItemEntity,
    quantity: number,
  ) {
    if (quantity <= 0 || item.quantity <= 0) {
      return 0;
    }

    return Math.round(
      (this.getOrderItemNetAmount(item) * quantity * 100) / item.quantity,
    ) / 100;
  }

  private getReturnableQuantityBase(order: OrderEntity, item: OrderItemEntity) {
    if (
      [OrderStatus.PARTIAL_DELIVERED, OrderStatus.PARTIAL_RETURNED].includes(
        order.orderStatus,
      )
    ) {
      return Math.max(0, Number(item.quantityDelivered ?? 0));
    }

    return Math.max(0, Number(item.quantity ?? 0));
  }

  private getReturnStatusLabel(status: string) {
    const map: Record<string, string> = {
      requested: 'Đã gửi yêu cầu',
      approved: 'Đã duyệt',
      received: 'Đã nhận hàng trả về',
      inspected: 'Đã kiểm tra hàng',
      refunded: 'Đã hoàn tiền',
      rejected: 'Từ chối',
    };
    return map[String(status).toLowerCase()] ?? status;
  }

  private getReturnReasonLabel(reason?: string | null) {
    const normalized = String(reason ?? '').toLowerCase();
    const labels: Record<string, string> = {
      wrong_item: 'Nhận sai sản phẩm',
      damaged: 'Sản phẩm lỗi hoặc hư hỏng',
      defective: 'Sản phẩm lỗi hoặc hư hỏng',
      not_as_described: 'Không đúng mô tả',
      changed_mind: 'Không còn nhu cầu',
      other: 'Lý do khác',
    };
    return labels[normalized] ?? reason ?? 'Lý do khác';
  }

  private getReturnInspectionStatusLabel(status?: string | null) {
    const labels: Record<string, string> = {
      pending: 'Chờ kiểm tra',
      usable: 'Hàng đạt, nhập lại kho',
      damaged: 'Hàng hỏng',
      return_to_supplier: 'Trả nhà cung cấp',
    };
    return status ? labels[String(status).toLowerCase()] ?? status : null;
  }

  private async getOrderReturnWindow(order: OrderEntity) {
    const returnableStatuses = [
      OrderStatus.DELIVERED,
      OrderStatus.PARTIAL_DELIVERED,
      OrderStatus.PARTIAL_RETURNED,
    ];
    if (!returnableStatuses.includes(order.orderStatus)) {
      return {
        returnWindowDays: RETURN_WINDOW_DAYS,
        deliveredAt: null as string | null,
        returnDeadline: null as string | null,
        canCreateReturn: false,
        returnBlockedReason: 'RETURN_NOT_DELIVERED_YET',
      };
    }

    const deliveredHistory =
      typeof this.orderStatusHistoryRepository.findOne === 'function'
        ? await this.orderStatusHistoryRepository.findOne({
            where: {
              orderId: order.orderId,
              newStatus: In([
                OrderStatus.DELIVERED,
                OrderStatus.PARTIAL_DELIVERED,
              ]),
            },
            order: { createdAt: 'ASC', historyId: 'ASC' },
          })
        : null;
    const deliveredAt =
      deliveredHistory?.createdAt ?? order.updatedAt ?? order.createdAt ?? new Date();
    const deadline = new Date(deliveredAt.getTime() + RETURN_WINDOW_MS);
    const expired = deadline.getTime() < Date.now();
    return {
      returnWindowDays: RETURN_WINDOW_DAYS,
      deliveredAt: deliveredAt.toISOString(),
      returnDeadline: deadline.toISOString(),
      canCreateReturn: !expired,
      returnBlockedReason: expired ? 'RETURN_WINDOW_EXPIRED' : null,
    };
  }

  private async getReservedReturnQuantity(
    orderItemId: string,
    exceptReturnId?: string,
  ) {
    const reservedStatuses: ReturnStatus[] = [
      ReturnStatus.REQUESTED,
      ReturnStatus.APPROVED,
      ReturnStatus.RECEIVED,
      ReturnStatus.INSPECTED,
      ReturnStatus.REFUNDED,
    ];
    const returns = await this.returnsRepository.find({
      where: reservedStatuses.map((returnStatus) => ({
        orderItemId,
        returnStatus,
      })),
    });

    return returns
      .filter((item) => !exceptReturnId || item.returnId !== exceptReturnId)
      .reduce((sum, item) => sum + Number(item.returnQuantity ?? 0), 0);
  }

  private getCartStockIssue(
    quantity: number,
    product?: ProductEntity | null,
  ) {
    if (!product || !product.isShow) {
      return 'unavailable';
    }
    if (product.quantityAvailable <= 0) {
      return 'out_of_stock';
    }
    if (quantity > product.quantityAvailable) {
      return 'insufficient_stock';
    }
    return null;
  }

  private buildCartHash(
    items: Array<{
      productId: string;
      quantity: number;
      unitPrice: string;
      isUnavailable: boolean;
      stockIssue: string | null;
    }>,
  ) {
    const stableItems = items
      .map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: this.toMoney(item.unitPrice),
        isUnavailable: item.isUnavailable,
        stockIssue: item.stockIssue,
      }))
      .sort((a, b) => a.productId.localeCompare(b.productId));

    return createHash('sha256')
      .update(JSON.stringify(stableItems))
      .digest('hex');
  }

  private throwCartChanged(message?: string): never {
    throw new ConflictException({
      message:
        message ??
        'Giỏ hàng đã thay đổi. Vui lòng kiểm tra lại giá và tồn kho trước khi đặt hàng.',
      error: 'CART_CHANGED',
    });
  }

  private normalizeDiscountCode(value: string) {
    return value.trim().toUpperCase();
  }

  private isDiscountApprovedForUse(discount: DiscountEntity) {
    return [
      DiscountApprovalStatus.NOT_REQUIRED,
      DiscountApprovalStatus.APPROVED,
    ].includes(discount.approvalStatus);
  }

  private async validateDiscountForCheckout(
    userId: string,
    discountCode: string | undefined,
    subtotalAmount: number,
    cartItems: CartItemEntity[],
    productsById: Map<string, ProductEntity>,
    entityManager?: EntityManager,
  ) {
    if (!discountCode) {
      return null;
    }

    const discountRepository = entityManager
      ? entityManager.getRepository(DiscountEntity)
      : this.discountsRepository;
    const couponUsageRepository = entityManager
      ? entityManager.getRepository(CouponUsageEntity)
      : this.couponUsageRepository;
    const discountCategoriesRepository = entityManager
      ? entityManager.getRepository(DiscountCategoryEntity)
      : this.discountCategoriesRepository;
    const discountProductsRepository = entityManager
      ? entityManager.getRepository(DiscountProductEntity)
      : this.discountProductsRepository;

    const discount = await discountRepository.findOne({
      where: { discountCode: this.normalizeDiscountCode(discountCode) },
      ...(entityManager ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });

    if (!discount || !discount.isActive) {
      throw new NotFoundException('Discount code not found');
    }

    if (!this.isDiscountApprovedForUse(discount)) {
      throw new BadRequestException('Discount code is not approved for use');
    }

    const now = new Date();
    if (discount.startAt > now || discount.expireDate < now) {
      throw new BadRequestException('Discount code is expired or not active');
    }

    if (discount.userId && discount.userId !== userId) {
      throw new BadRequestException(
        'Discount code is not available for this user',
      );
    }

    let eligibleSubtotal = subtotalAmount;

    if (discount.appliesTo === DiscountApplyTarget.CATEGORY) {
      const categoryMappings = await discountCategoriesRepository.find({
        where: { discountId: discount.discountId },
      });
      const categoryIds = new Set(
        categoryMappings.map((item) => item.categoryId),
      );
      eligibleSubtotal = cartItems.reduce((sum, item) => {
        const product = productsById.get(item.productId);
        if (!product || !categoryIds.has(product.categoryId)) {
          return sum;
        }

        return sum + Number(this.getEffectivePrice(product)) * item.quantity;
      }, 0);
    }

    if (discount.appliesTo === DiscountApplyTarget.PRODUCT) {
      const productMappings = await discountProductsRepository.find({
        where: { discountId: discount.discountId },
      });
      const productIds = new Set(productMappings.map((item) => item.productId));
      eligibleSubtotal = cartItems.reduce((sum, item) => {
        const product = productsById.get(item.productId);
        if (!product || !productIds.has(item.productId)) {
          return sum;
        }

        return sum + Number(this.getEffectivePrice(product)) * item.quantity;
      }, 0);
    }

    if (eligibleSubtotal <= 0) {
      throw new BadRequestException(
        'Discount code does not apply to cart items',
      );
    }

    if (eligibleSubtotal < Number(discount.minOrderValue)) {
      throw new BadRequestException(
        'Order does not meet discount minimum value',
      );
    }

    if (
      discount.usageLimit !== null &&
      discount.usedCount >= discount.usageLimit
    ) {
      throw new BadRequestException('Discount code usage limit reached');
    }

    const existingUsage = await couponUsageRepository.findOne({
      where: {
        discountId: discount.discountId,
        userId,
      },
    });

    if (existingUsage) {
      throw new BadRequestException('You have already used this discount code');
    }

    return {
      discount,
      eligibleSubtotal,
    };
  }

  private async recordDiscountUsageInTx(
    entityManager: EntityManager,
    discount: DiscountEntity | null,
    userId: string,
    orderId: string,
  ) {
    if (!discount) return;
    const couponUsageRepository = entityManager.getRepository(CouponUsageEntity);

    // FIX HIGH (race condition): tăng used_count ATOMIC + có điều kiện.
    // UPDATE ... WHERE used_count < usage_limit → nếu 0 dòng bị ảnh hưởng nghĩa là
    // đã chạm trần (do request đồng thời khác vừa dùng hết) → chặn, không cho vượt.
    const result = await entityManager
      .createQueryBuilder()
      .update(DiscountEntity)
      .set({ usedCount: () => 'used_count + 1' })
      .where('discount_id = :id', { id: discount.discountId })
      .andWhere('(usage_limit IS NULL OR used_count < usage_limit)')
      .execute();

    if (!result.affected || result.affected === 0) {
      throw new BadRequestException(
        'Mã giảm giá đã hết lượt sử dụng. Vui lòng bỏ mã và thử lại.',
      );
    }

    await couponUsageRepository.save(
      couponUsageRepository.create({
        discountId: discount.discountId,
        userId,
        orderId,
      }),
    );
  }

  private async buildOrderDetail(order: OrderEntity) {
    const [items, history, refunds, rawReturns, returnWindow] = await Promise.all([
      this.orderItemsRepository.find({
        where: { orderId: order.orderId },
        order: { createdAt: 'ASC', orderItemId: 'ASC' },
      }),
      this.orderStatusHistoryRepository.find({
        where: { orderId: order.orderId },
        order: { createdAt: 'ASC', historyId: 'ASC' },
      }),
      this.orderRefundsRepository.find({
        where: { orderId: order.orderId },
        order: { createdAt: 'DESC', refundId: 'DESC' },
      }),
      this.returnsRepository.find({
        where: { orderId: order.orderId },
        order: { createdAt: 'DESC', returnId: 'DESC' },
      }),
      this.getOrderReturnWindow(order),
    ]);
    const returns = rawReturns ?? [];

    const changedByIds = [
      ...new Set(history.map((e) => e.changedBy).filter(Boolean)),
    ] as string[];
    const usersMap = new Map<string, string>();
    if (changedByIds.length > 0) {
      const users = await this.usersRepository.find({
        where: { userId: In(changedByIds) },
        select: ['userId', 'username'],
      });
      for (const u of users) usersMap.set(u.userId, u.username);
    }

    const returnedQuantityByItem = new Map<string, number>();
    for (const request of returns) {
      if (request.returnStatus === ReturnStatus.REJECTED) continue;
      returnedQuantityByItem.set(
        request.orderItemId,
        (returnedQuantityByItem.get(request.orderItemId) ?? 0) +
          Number(request.returnQuantity ?? 0),
      );
    }

    return {
      id: order.orderId,
      status: order.orderStatus,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      ...this.getPaymentRetryInfo(order),
      shippingAddressId: order.shippingAddressId,
      deliveryId: order.deliveryId,
      subtotalAmount: order.subtotalAmount,
      discountAmount: order.discountAmount,
      deliveryCost: order.deliveryCost,
      fulfillmentType: order.fulfillmentType,
      deliveryMethodName: order.deliveryMethodNameSnapshot,
      freeShippingApplied: order.freeShippingApplied,
      pickupContactName: order.pickupContactName,
      pickupContactPhone: order.pickupContactPhone,
      totalPayment: order.totalPayment,
      totalQuantity: order.totalQuantity,
      note: order.note,
      fullName: order.fullName,
      phone: order.phone,
      address: order.address,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      returnWindowDays: returnWindow.returnWindowDays,
      returnDeadline: returnWindow.returnDeadline,
      canCreateReturn: returnWindow.canCreateReturn,
      returnBlockedReason: returnWindow.returnBlockedReason,
      items: items.map((item) => {
        const returnedQuantity = returnedQuantityByItem.get(item.orderItemId) ?? 0;
        const base = this.getReturnableQuantityBase(order, item);
        const returnableQuantity = returnWindow.canCreateReturn
          ? Math.max(0, base - returnedQuantity)
          : 0;
        return {
          id: item.orderItemId,
          productId: item.productId,
          productName: item.productName,
          quantity: item.quantity,
          quantityDelivered: item.quantityDelivered,
          returnedQuantity,
          returnableQuantity,
          returnWindowDays: returnWindow.returnWindowDays,
          returnDeadline: returnWindow.returnDeadline,
          canCreateReturn: returnWindow.canCreateReturn,
          returnBlockedReason: returnWindow.returnBlockedReason,
          unitPrice: item.unitPrice,
          lineTotal: item.lineTotal,
          grossLineTotal: item.grossLineTotal,
          discountAllocated: item.discountAllocated,
          netLineTotal: item.netLineTotal,
        };
      }),
      history: history.map((entry) => ({
        id: entry.historyId,
        oldStatus: entry.oldStatus,
        newStatus: entry.newStatus,
        changedBy: entry.changedBy
          ? (usersMap.get(entry.changedBy) ?? 'admin')
          : null,
        note: entry.note,
        createdAt: entry.createdAt,
      })),
      refunds: (refunds ?? []).map((refund) => ({
        refundId: refund.refundId,
        returnId: refund.returnId,
        reason: refund.reason,
        amount: refund.amount,
        refundStatus: refund.refundStatus,
        paymentProvider: refund.paymentProvider,
        manualReference: refund.manualReference,
        note: refund.note,
        createdAt: refund.createdAt,
      })),
      returns: returns.map((request) => ({
        id: request.returnId,
        orderId: request.orderId,
        orderItemId: request.orderItemId,
        returnQuantity: request.returnQuantity,
        reason: request.reason,
        description: request.description,
        status: request.returnStatus,
        statusLabel: this.getReturnStatusLabel(request.returnStatus),
        inspectionStatus: request.inspectionStatus,
        refundAmount: request.refundAmount,
        createdAt: request.createdAt,
        returnWindowDays: returnWindow.returnWindowDays,
        returnDeadline: returnWindow.returnDeadline,
      })),
    };
  }

  async getOrderStats(): Promise<Record<string, number>> {
    const rows = await this.ordersRepository
      .createQueryBuilder('o')
      .select('o.orderStatus', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('o.orderStatus')
      .getRawMany<{ status: string; count: string }>();
    return Object.fromEntries(rows.map((r) => [r.status, Number(r.count)]));
  }

  private toOrderSummary(order: OrderEntity) {
    return {
      id: order.orderId,
      userId: order.userId,
      status: order.orderStatus,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      ...this.getPaymentRetryInfo(order),
      fulfillmentType: order.fulfillmentType,
      deliveryMethodName: order.deliveryMethodNameSnapshot,
      totalPayment: order.totalPayment,
      totalQuantity: order.totalQuantity,
      fullName: order.fullName,
      phone: order.phone,
      address: order.address,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    };
  }

  private async notifyAdminsAboutNewOrder(order: OrderEntity) {
    await this.notificationsService.sendAdminOrderCreatedNotification({
      orderId: order.orderId,
      fullName: order.fullName,
      phone: order.phone,
      totalPayment: order.totalPayment,
    });
    this.ordersAdminPublisher.emitNewOrder(order);
  }

  private isValidAdminStatusTransition(
    currentStatus: OrderStatus,
    nextStatus: OrderStatus,
  ) {
    const allowedTransitions: Record<OrderStatus, OrderStatus[]> = {
      [OrderStatus.BACKORDERED]: [OrderStatus.PENDING, OrderStatus.CANCELLED],
      [OrderStatus.PENDING]: [OrderStatus.CONFIRMED, OrderStatus.CANCELLED],
      [OrderStatus.CONFIRMED]: [OrderStatus.PROCESSING, OrderStatus.CANCELLED],
      [OrderStatus.PROCESSING]: [OrderStatus.SHIPPING, OrderStatus.DELIVERED, OrderStatus.CANCELLED],
      [OrderStatus.SHIPPING]: [
        OrderStatus.DELIVERED,
        OrderStatus.PARTIAL_DELIVERED,
        OrderStatus.RETURNED,
      ],
      [OrderStatus.PARTIAL_DELIVERED]: [
        OrderStatus.RETURNED,
        OrderStatus.PARTIAL_RETURNED,
      ],
      [OrderStatus.DELIVERED]: [
        OrderStatus.RETURNED,
        OrderStatus.PARTIAL_RETURNED,
      ],
      [OrderStatus.PARTIAL_RETURNED]: [OrderStatus.RETURNED],
      [OrderStatus.CANCELLED]: [],
      [OrderStatus.RETURNED]: [],
    };

    return allowedTransitions[currentStatus].includes(nextStatus);
  }

  private async restockOrderItems(
    orderId: string,
    productRepository: Repository<ProductEntity>,
    orderItemsRepository: Repository<OrderItemEntity>,
    entityManager?: EntityManager,
  ) {
    const items = await orderItemsRepository.find({
      where: { orderId },
    });

    for (const item of items) {
      // Lock pessimistic khi restock — tránh race condition khi cancel song song
      const product = await productRepository.findOne({
        where: { productId: item.productId },
        lock: entityManager ? { mode: 'pessimistic_write' } : undefined,
      });

      if (product) {
        product.quantityAvailable += item.quantity;
        product.quantityReserved = Math.max(
          0,
          (product.quantityReserved ?? 0) - item.quantity,
        );
        await productRepository.save(product);

        if (entityManager) {
          // Hoàn lại từng batch theo lịch sử consumption (idempotent — query NET)
          await this.restoreBatchesFromOrder(
            entityManager,
            orderId,
            item.productId,
            item.quantity,
          );
          await this.syncDefaultWarehouseStock(
            entityManager,
            item.productId,
            item.quantity,
          );
        }
      }
    }
  }

  /**
   * Hoàn batch theo lịch sử consumption của order.
   *
   * - Truy vấn NET consumption (export - return_in) cho cặp (orderId, productId)
   * - Hoàn dần qty cần restock vào các batch theo thứ tự LIFO (consume mới nhất hoàn trước)
   * - Log RETURN_IN inventory_transaction với batchId
   * - Idempotent: nếu đã hoàn rồi (NET = 0) thì không làm gì
   *
   * Trường hợp legacy (không có batch_id trong txn) → bỏ qua, restock đã được làm
   * ở caller bằng quantityAvailable += qty.
   */
  private async restoreBatchesFromOrder(
    em: EntityManager,
    orderId: string,
    productId: string,
    qtyToRestore: number,
  ): Promise<void> {
    if (qtyToRestore <= 0) return;

    const netMap = await this.batchService.getOrderBatchConsumption(em, orderId, productId);
    if (netMap.size === 0) return; // legacy order, không có batch info

    // Sort theo NET descending để hoàn từ batch còn consumed nhiều nhất
    const sorted = Array.from(netMap.entries())
      .filter(([_, net]) => net > 0)
      .sort((a, b) => b[1] - a[1]);

    let remaining = qtyToRestore;
    for (const [batchId, net] of sorted) {
      if (remaining <= 0) break;
      const restore = Math.min(net, remaining);
      await this.batchService.restoreInTx(em, batchId, restore);

      await em.save(
        InventoryTransactionEntity,
        em.create(InventoryTransactionEntity, {
          productId,
          performedBy: null,
          transactionType: InventoryTransactionType.RETURN_IN,
          quantityChange: restore,
          referenceType: 'ORDER',
          referenceId: orderId,
          batchId,
          note: `Restock batch by order ${orderId}`,
          relatedOrderId: orderId,
        }),
      );
      remaining -= restore;
    }
    // Nếu remaining > 0 mà hết batch → có thể là partial-batch legacy mix,
    // tổng quantityAvailable đã được cộng nên không thiếu, chỉ là batch detail không đủ.
  }

  /**
   * Khi đơn DELIVERED — không restock, chỉ giải phóng quantityReserved
   * (hàng đã thực sự rời kho, không trả về stock).
   */
  private async releaseReservedOnDelivered(
    orderId: string,
    productRepository: Repository<ProductEntity>,
    orderItemsRepository: Repository<OrderItemEntity>,
  ) {
    const items = await orderItemsRepository.find({ where: { orderId } });
    for (const item of items) {
      const product = await productRepository.findOne({
        where: { productId: item.productId },
        lock: { mode: 'pessimistic_write' },
      });
      if (product) {
        product.quantityReserved = Math.max(
          0,
          (product.quantityReserved ?? 0) - item.quantity,
        );
        await productRepository.save(product);
      }
      // Giao đủ → đánh dấu đã giao toàn bộ số lượng (để hóa đơn/báo cáo hiển thị đúng "đã giao N/N")
      if (Number(item.quantityDelivered ?? 0) < item.quantity) {
        item.quantityDelivered = item.quantity;
        await orderItemsRepository.save(item);
      }
    }
  }

  private async revertDiscountUsage(
    order: OrderEntity,
    discountRepository: Repository<DiscountEntity>,
    couponUsageRepository: Repository<CouponUsageEntity>,
  ) {
    if (!order.discountId) {
      return;
    }

    const discount = await discountRepository.findOneBy({
      discountId: order.discountId,
    });

    if (discount) {
      discount.usedCount = Math.max(0, discount.usedCount - 1);
      await discountRepository.save(discount);
    }

    await couponUsageRepository.delete({ orderId: order.orderId });
  }

  /**
   * Đặt hàng cho khách vãng lai (không cần đăng ký tài khoản).
   *
   * Khác createOrder thường:
   * 1. Không cần userId — guest cung cấp thông tin shipping trực tiếp
   * 2. Tạo userId tạm dạng `guest-<uuid>` chỉ để thoả mãn FK constraint
   * 3. Không lấy giá từ cart (vì không có cart) — lấy giá hiện tại từ products
   * 4. Không support discount code (đơn giản hơn) — có thể bổ sung sau
   * 5. Vẫn dùng pessimistic lock + idempotency + reservation pattern
   */
  async createGuestOrder(dto: import('./dto/create-guest-order.dto').CreateGuestOrderDto, idempotencyKey?: string) {
    await this.ensurePaymentMethodEnabled(dto.paymentMethod);

    if (dto.discountCode) {
      throw new BadRequestException(
        'Guest checkout does not support voucher. Please log in to use vouchers.',
      );
    }

    if (idempotencyKey) {
      const existing = await this.ordersRepository.findOne({
        where: { idempotencyKey },
      });
      if (existing) {
        return this.buildOrderDetail(await this.findAnyOrder(existing.orderId));
      }
    }

    const deliveryMethod = await this.deliveryMethodsRepository.findOneBy({
      deliveryId: dto.deliveryId,
    });
    if (!deliveryMethod || !deliveryMethod.isActive) {
      throw inactiveDeliveryMethod();
    }
    if (deliveryMethod.isPickup && !dto.pickupContact) {
      throw invalidFulfillmentInput(
        FulfillmentErrorCode.PICKUP_CONTACT_REQUIRED,
        'Nhận tại cửa hàng cần tên người nhận và số điện thoại liên hệ',
      );
    }
    if (!deliveryMethod.isPickup && !dto.shipping) {
      throw invalidFulfillmentInput(
        FulfillmentErrorCode.SHIPPING_ADDRESS_REQUIRED,
        'Giao hàng cần địa chỉ nhận hàng',
      );
    }

    const productIds = [...new Set(dto.items.map((it) => it.productId))];
    const products = await this.productsRepository.findBy(
      productIds.map((productId) => ({ productId })),
    );
    const productsById = new Map(
      products.map((product) => [product.productId, product]),
    );

    let subtotalAmount = 0;
    let totalQuantity = 0;
    let isBackorder = false;

    for (const item of dto.items) {
      const product = productsById.get(item.productId);
      if (!product || !product.isShow) {
        throw new BadRequestException('Sản phẩm không khả dụng');
      }
      if (item.quantity > product.quantityAvailable) {
        if (!dto.allowBackorder) {
          throw new BadRequestException(
            `Sản phẩm ${product.productName} không đủ tồn kho`,
          );
        }
        isBackorder = true;
      }
      const price =
        Number(product.productPriceSale ?? 0) > 0
          ? Number(product.productPriceSale)
          : Number(product.productPrice);
      subtotalAmount += price * item.quantity;
      totalQuantity += item.quantity;
    }

    const deliveryQuote = await this.assertDeliveryMethodEligible(
      deliveryMethod,
      subtotalAmount,
      {
        province: dto.shipping?.province,
        district: dto.shipping?.district,
      },
    );
    const deliveryCost = deliveryQuote.shippingFee;
    const totalPayment = subtotalAmount + deliveryCost;
    const orderId = randomUUID();
    const guestUserId = randomUUID();
    const addressSnapshot = deliveryMethod.isPickup
      ? `Nhận tại cửa hàng - ${deliveryMethod.name}`
      : [
          dto.shipping?.addressLine,
          dto.shipping?.ward,
          dto.shipping?.district,
          dto.shipping?.province,
        ]
          .filter(Boolean)
          .join(', ');
    const recipientName = deliveryMethod.isPickup
      ? dto.pickupContact!.recipientName
      : dto.shipping!.recipientName;
    const recipientPhone = deliveryMethod.isPickup
      ? dto.pickupContact!.phone
      : dto.shipping!.phone;

    await withDeadlockRetry(() =>
      this.ordersRepository.manager.transaction(async (entityManager) => {
        const trxOrders = entityManager.getRepository(OrderEntity);
        const trxItems = entityManager.getRepository(OrderItemEntity);
        const trxHistory = entityManager.getRepository(OrderStatusHistoryEntity);
        const trxProducts = entityManager.getRepository(ProductEntity);
        const trxInvTx = entityManager.getRepository(InventoryTransactionEntity);

        if (idempotencyKey) {
          const dup = await trxOrders.findOne({ where: { idempotencyKey } });
          if (dup) return;
        }

        await this.createGuestUserRecord(entityManager, guestUserId, orderId);

        const order = trxOrders.create({
          orderId,
          userId: guestUserId,
          shippingAddressId: null,
          deliveryId: deliveryMethod.deliveryId,
          discountId: null,
          orderStatus: isBackorder ? OrderStatus.BACKORDERED : OrderStatus.PENDING,
          paymentMethod: dto.paymentMethod,
          paymentStatus: PaymentStatus.UNPAID,
          subtotalAmount: subtotalAmount.toFixed(2),
          discountAmount: '0.00',
          deliveryCost: deliveryCost.toFixed(2),
          fulfillmentType: deliveryQuote.type,
          deliveryMethodNameSnapshot: deliveryMethod.name,
          freeShippingApplied: deliveryQuote.freeShippingApplied,
          pickupContactName: deliveryMethod.isPickup
            ? dto.pickupContact!.recipientName
            : null,
          pickupContactPhone: deliveryMethod.isPickup
            ? dto.pickupContact!.phone
            : null,
          totalPayment: totalPayment.toFixed(2),
          totalQuantity,
          note:
            (dto.note ? `${dto.note}\n` : '') +
            `[GUEST] ${dto.shipping?.email ?? ''}`.trim(),
          fullName: recipientName,
          phone: recipientPhone,
          address: addressSnapshot,
          idempotencyKey: idempotencyKey ?? null,
        });
        await trxOrders.save(order);

        for (const item of dto.items) {
          const product = await trxProducts.findOne({
            where: { productId: item.productId },
            lock: { mode: 'pessimistic_write' },
          });
          if (!product) {
            throw new BadRequestException('Sản phẩm không tồn tại');
          }
          const isLineBackorder = item.quantity > product.quantityAvailable;
          if (isLineBackorder && !dto.allowBackorder) {
            throw new BadRequestException(
              `Sản phẩm ${product.productName} không đủ tồn kho`,
            );
          }

          const unitPrice =
            Number(product.productPriceSale ?? 0) > 0
              ? product.productPriceSale!
              : product.productPrice;
          const lineTotal = Number(unitPrice) * item.quantity;

          const orderItem = trxItems.create({
            orderId,
            productId: item.productId,
            productName: product.productName,
            quantity: item.quantity,
            unitPrice,
            lineTotal: lineTotal.toFixed(2),
            grossLineTotal: lineTotal.toFixed(2),
            discountAllocated: '0.00',
            netLineTotal: lineTotal.toFixed(2),
          });
          await trxItems.save(orderItem);

          if (isLineBackorder) continue;

          const qtyBefore = product.quantityAvailable;
          const batchPick = await this.batchService
            .consumeInTx(entityManager, product.productId, item.quantity)
            .catch(async (err) => {
              const hasAnyBatch = await entityManager
                .createQueryBuilder()
                .select('1')
                .from('product_batches', 'b')
                .where('b.product_id = :pid', { pid: product.productId })
                .limit(1)
                .getRawOne();
              if (hasAnyBatch) throw err;
              return null;
            });
          product.quantityAvailable -= item.quantity;
          product.quantityReserved =
            (product.quantityReserved ?? 0) + item.quantity;
          await trxProducts.save(product);

          if (batchPick?.success) {
            let runningBefore = qtyBefore;
            for (const line of batchPick.lines) {
              await trxInvTx.save(
                trxInvTx.create({
                  productId: item.productId,
                  performedBy: null,
                  transactionType: InventoryTransactionType.EXPORT,
                  quantityChange: -line.qty,
                  quantityBefore: runningBefore,
                  quantityAfter: runningBefore - line.qty,
                  referenceType: 'ORDER',
                  referenceId: orderId,
                  batchId: line.batchId,
                  unitCostAtTime: line.unitCost.toFixed(4),
                  note: `Guest order checkout - batch ${line.batchCode}`,
                  relatedOrderId: orderId,
                }),
              );
              runningBefore -= line.qty;
            }
          } else {
            await trxInvTx.save(
              trxInvTx.create({
                productId: item.productId,
                performedBy: null,
                transactionType: InventoryTransactionType.EXPORT,
                quantityChange: -item.quantity,
                quantityBefore: qtyBefore,
                quantityAfter: product.quantityAvailable,
                referenceType: 'ORDER',
                referenceId: orderId,
                unitCostAtTime: product.avgCost ?? null,
                note: 'Guest order checkout (legacy - no batch)',
                relatedOrderId: orderId,
              }),
            );
          }
          await this.syncDefaultWarehouseStock(
            entityManager,
            item.productId,
            -item.quantity,
          );
        }

        await trxHistory.save(
          trxHistory.create({
            orderId,
            oldStatus: null,
            newStatus: isBackorder ? OrderStatus.BACKORDERED : OrderStatus.PENDING,
            changedBy: null,
            note: 'Guest order created',
          }),
        );
      }),
    );

    const created = await this.findAnyOrder(orderId);
    await this.notifyAdminsAboutNewOrder(created);
    return this.buildOrderDetail(created);
  }

  /**
   * Tra cứu đơn guest bằng orderId + phone (verify nhẹ — anyone biết cả 2 sẽ xem được).
   */
  async findGuestOrder(orderId: string, phone: string) {
    if (!phone || !orderId) {
      throw new BadRequestException('Cần cung cấp orderId và phone');
    }
    const order = await this.ordersRepository.findOne({
      where: { orderId },
    });
    if (!order) throw new NotFoundException('Không tìm thấy đơn hàng');
    if (!(await this.isGuestUserId(order.userId))) {
      throw new UnauthorizedException('Đơn này thuộc tài khoản đăng ký, hãy đăng nhập để xem');
    }
    if (order.phone.replace(/\s+/g, '') !== phone.replace(/\s+/g, '')) {
      throw new UnauthorizedException('Số điện thoại không khớp');
    }
    return this.buildOrderDetail(order);
  }

  async createOrder(
    userId: string,
    createOrderDto: CreateOrderDto,
    idempotencyKey?: string,
  ) {
    const currentUser = await this.ensureUserExists(userId);
    await this.ensurePaymentMethodEnabled(createOrderDto.paymentMethod);
    const allowBackorder = Boolean(createOrderDto.allowBackorder);

    if (allowBackorder && !currentUser.isWholesale) {
      throw new BadRequestException(
        'Backorder chỉ dành cho khách sỉ/B2B đã được cấu hình.',
      );
    }

    if (idempotencyKey) {
      const existing = await this.ordersRepository.findOne({
        where: { idempotencyKey, userId },
      });
      if (existing) {
        return this.buildOrderDetail(
          await this.findOwnedOrder(userId, existing.orderId),
        );
      }
    }

    const cart = await this.cartsRepository.findOneBy({ userId });
    if (!cart) {
      throw new BadRequestException('Cart is empty');
    }

    const [cartItems, deliveryMethod] = await Promise.all([
      this.cartItemsRepository.find({
        where: { cartId: cart.cartId },
        order: { createdAt: 'ASC', cartItemId: 'ASC' },
      }),
      this.deliveryMethodsRepository.findOneBy({
        deliveryId: createOrderDto.deliveryId,
      }),
    ]);

    if (cartItems.length === 0) {
      throw new BadRequestException('Cart is empty');
    }

    if (!deliveryMethod || !deliveryMethod.isActive) {
      throw inactiveDeliveryMethod();
    }
    if (deliveryMethod.isPickup && !createOrderDto.pickupContact) {
      throw invalidFulfillmentInput(
        FulfillmentErrorCode.PICKUP_CONTACT_REQUIRED,
        'Nhận tại cửa hàng cần tên người nhận và số điện thoại liên hệ',
      );
    }
    if (!deliveryMethod.isPickup && !createOrderDto.shippingAddressId) {
      throw invalidFulfillmentInput(
        FulfillmentErrorCode.SHIPPING_ADDRESS_REQUIRED,
        'Giao hàng cần địa chỉ nhận hàng',
      );
    }

    const shippingAddress = deliveryMethod.isPickup
      ? null
      : await this.shippingAddressesRepository.findOneBy({
          shippingAddressId: createOrderDto.shippingAddressId,
          userId,
        });
    if (!deliveryMethod.isPickup && !shippingAddress) {
      throw new NotFoundException('Shipping address not found');
    }

    if (createOrderDto.paymentMethod === PaymentMethod.CREDIT && !currentUser.isWholesale) {
      throw new BadRequestException(
        'Phương thức "Mua nợ" chỉ dành cho khách sỉ được cấp hạn mức tín dụng',
      );
    }

    const productIds = [...new Set(cartItems.map((item) => item.productId))];
    const addressSnapshot = shippingAddress
      ? this.buildAddressSnapshot(shippingAddress)
      : `Nhận tại cửa hàng - ${deliveryMethod.name}`;
    const orderId = randomUUID();
    let createdOrderId: string = orderId;
    let createdOrderWasNew = false;

    await withDeadlockRetry(() =>
      this.ordersRepository.manager.transaction(async (entityManager) => {
        const transactionalOrdersRepository =
          entityManager.getRepository(OrderEntity);
        const transactionalOrderItemsRepository =
          entityManager.getRepository(OrderItemEntity);
        const transactionalHistoryRepository = entityManager.getRepository(
          OrderStatusHistoryEntity,
        );
        const transactionalProductsRepository =
          entityManager.getRepository(ProductEntity);
        const transactionalCartItemsRepository =
          entityManager.getRepository(CartItemEntity);
        const transactionalInventoryTransactionsRepository =
          entityManager.getRepository(InventoryTransactionEntity);
        const transactionalCreditLimitRepository =
          entityManager.getRepository(CustomerCreditLimitEntity);

        if (idempotencyKey) {
          const dup = await transactionalOrdersRepository.findOne({
            where: { idempotencyKey, userId },
          });
          if (dup) {
            createdOrderId = dup.orderId;
            return;
          }
        }

        const lockedProductsById = new Map<string, ProductEntity>();
        for (const productId of [...productIds].sort()) {
          const product = await transactionalProductsRepository.findOne({
            where: { productId },
            lock: { mode: 'pessimistic_write' },
          });
          if (product) {
            lockedProductsById.set(productId, product);
          }
        }

        let subtotalAmount = 0;
        let totalQuantity = 0;
        let isBackorder = false;
        const cartHashLines: Array<{
          productId: string;
          quantity: number;
          unitPrice: string;
          isUnavailable: boolean;
          stockIssue: string | null;
        }> = [];

        for (const cartItem of cartItems) {
          const product = lockedProductsById.get(cartItem.productId);
          const isUnavailable = !product || !product.isShow;
          const stockIssue = this.getCartStockIssue(
            cartItem.quantity,
            product,
          );
          const unitPrice = product
            ? this.toMoney(this.getEffectivePrice(product))
            : this.toMoney(cartItem.priceAtAdded);

          cartHashLines.push({
            productId: cartItem.productId,
            quantity: cartItem.quantity,
            unitPrice,
            isUnavailable,
            stockIssue,
          });

          if (isUnavailable) {
            if (createOrderDto.cartHash) {
              this.throwCartChanged(
                'Một hoặc nhiều sản phẩm trong giỏ đã ngừng bán. Vui lòng kiểm tra lại giỏ hàng.',
              );
            }
            throw new BadRequestException(
              'One or more products are unavailable',
            );
          }

          if (stockIssue) {
            const productName = product?.productName ?? 'Sản phẩm';
            if (!allowBackorder) {
              if (createOrderDto.cartHash) {
                this.throwCartChanged(
                  `Sản phẩm ${productName} không đủ tồn kho. Vui lòng kiểm tra lại giỏ hàng.`,
                );
              }
              throw new BadRequestException(
                `Sản phẩm ${productName} không đủ tồn kho`,
              );
            }
            isBackorder = true;
          }

          subtotalAmount += Number(unitPrice) * cartItem.quantity;
          totalQuantity += cartItem.quantity;
        }

        if (createOrderDto.cartHash) {
          const currentCartHash = this.buildCartHash(cartHashLines);
          if (currentCartHash !== createOrderDto.cartHash) {
            this.throwCartChanged();
          }
        }

        const discountContext = await this.validateDiscountForCheckout(
          userId,
          createOrderDto.discountCode,
          subtotalAmount,
          cartItems,
          lockedProductsById,
          entityManager,
        );
        const discount = discountContext?.discount ?? null;
        const discountAmount = discountContext
          ? this.calculateDiscountAmount(
              discountContext.discount,
              discountContext.eligibleSubtotal,
            )
          : 0;
        const deliveryQuote = await this.assertDeliveryMethodEligible(
          deliveryMethod,
          subtotalAmount,
          {
            province: shippingAddress?.province,
            district: shippingAddress?.district,
          },
        );
        const deliveryCost = deliveryQuote.shippingFee;
        const totalPayment = subtotalAmount - discountAmount + deliveryCost;
        const financialSnapshots = this.allocateFinancialSnapshots(
          cartItems.map((cartItem) => {
            const product = lockedProductsById.get(cartItem.productId);
            return {
              key: String(cartItem.cartItemId),
              grossAmount:
                Number(
                  product
                    ? this.getEffectivePrice(product)
                    : cartItem.priceAtAdded,
                ) * cartItem.quantity,
            };
          }),
          discountAmount,
        );

        let creditLimit: CustomerCreditLimitEntity | null = null;
        if (createOrderDto.paymentMethod === PaymentMethod.CREDIT) {
          creditLimit = await transactionalCreditLimitRepository.findOne({
            where: { userId, isActive: true as unknown as boolean },
            lock: { mode: 'pessimistic_write' },
          });
          if (!creditLimit) {
            throw new BadRequestException(
              'Bạn chưa được cấp hạn mức tín dụng. Vui lòng liên hệ shop để được hỗ trợ',
            );
          }
          const available =
            Number(creditLimit.creditLimit) -
            Number(creditLimit.currentDebt ?? 0);
          if (totalPayment > available) {
            throw new BadRequestException(
              `Vượt hạn mức tín dụng. Hạn mức còn lại: ${Math.max(0, available).toLocaleString('vi-VN')}₫`,
            );
          }
        }

        const order = transactionalOrdersRepository.create({
          orderId,
          userId,
          shippingAddressId: shippingAddress?.shippingAddressId ?? null,
          deliveryId: deliveryMethod.deliveryId,
          discountId: discount?.discountId ?? null,
          orderStatus: isBackorder
            ? OrderStatus.BACKORDERED
            : OrderStatus.PENDING,
          paymentMethod: createOrderDto.paymentMethod,
          paymentStatus: PaymentStatus.UNPAID,
          subtotalAmount: subtotalAmount.toFixed(2),
          discountAmount: discountAmount.toFixed(2),
          deliveryCost: deliveryCost.toFixed(2),
          fulfillmentType: deliveryQuote.type,
          deliveryMethodNameSnapshot: deliveryMethod.name,
          freeShippingApplied: deliveryQuote.freeShippingApplied,
          pickupContactName: deliveryMethod.isPickup
            ? createOrderDto.pickupContact!.recipientName
            : null,
          pickupContactPhone: deliveryMethod.isPickup
            ? createOrderDto.pickupContact!.phone
            : null,
          totalPayment: totalPayment.toFixed(2),
          totalQuantity,
          note: createOrderDto.note ?? null,
          fullName: shippingAddress
            ? shippingAddress.recipientName
            : createOrderDto.pickupContact!.recipientName,
          phone: shippingAddress
            ? shippingAddress.phone
            : createOrderDto.pickupContact!.phone,
          address: addressSnapshot,
          idempotencyKey: idempotencyKey ?? null,
        });

        await transactionalOrdersRepository.save(order);

        for (const cartItem of cartItems) {
          const product = lockedProductsById.get(cartItem.productId);
          if (!product || !product.isShow) {
            this.throwCartChanged(
              'Một hoặc nhiều sản phẩm trong giỏ đã ngừng bán. Vui lòng kiểm tra lại giỏ hàng.',
            );
          }

          const isLineBackorder =
            cartItem.quantity > product.quantityAvailable;
          if (isLineBackorder && !allowBackorder) {
            this.throwCartChanged(
              `Sản phẩm ${product.productName} không đủ tồn kho. Vui lòng kiểm tra lại giỏ hàng.`,
            );
          }

          const unitPrice = this.toMoney(this.getEffectivePrice(product));
          const lineTotal = Number(unitPrice) * cartItem.quantity;
          const financialSnapshot = financialSnapshots.get(
            String(cartItem.cartItemId),
          ) ?? {
            grossLineTotal: lineTotal.toFixed(2),
            discountAllocated: '0.00',
            netLineTotal: lineTotal.toFixed(2),
          };

          const orderItem = transactionalOrderItemsRepository.create({
            orderId,
            productId: cartItem.productId,
            productName: product.productName,
            quantity: cartItem.quantity,
            unitPrice,
            lineTotal: lineTotal.toFixed(2),
            ...financialSnapshot,
          });
          await transactionalOrderItemsRepository.save(orderItem);

          if (isLineBackorder) {
            continue;
          }

          const qtyBefore = product.quantityAvailable;

          const batchPick = await this.batchService
            .consumeInTx(entityManager, product.productId, cartItem.quantity)
            .catch(async (err) => {
              const hasAnyBatch = await entityManager
                .createQueryBuilder()
                .select('1')
                .from('product_batches', 'b')
                .where('b.product_id = :pid', { pid: product.productId })
                .limit(1)
                .getRawOne();
              if (hasAnyBatch) {
                throw err;
              }
              return null;
            });

          product.quantityAvailable -= cartItem.quantity;
          product.quantityReserved =
            (product.quantityReserved ?? 0) + cartItem.quantity;
          await transactionalProductsRepository.save(product);

          if (batchPick && batchPick.success) {
            let runningBefore = qtyBefore;
            for (const line of batchPick.lines) {
              const after = runningBefore - line.qty;
              await transactionalInventoryTransactionsRepository.save(
                transactionalInventoryTransactionsRepository.create({
                  productId: product.productId,
                  performedBy: userId,
                  transactionType: InventoryTransactionType.EXPORT,
                  quantityChange: -line.qty,
                  quantityBefore: runningBefore,
                  quantityAfter: after,
                  referenceType: 'ORDER',
                  referenceId: orderId,
                  batchId: line.batchId,
                  unitCostAtTime: line.unitCost.toFixed(4),
                  note: `Export by order checkout - batch ${line.batchCode}`,
                  relatedOrderId: orderId,
                }),
              );
              runningBefore = after;
            }
          } else {
            await transactionalInventoryTransactionsRepository.save(
              transactionalInventoryTransactionsRepository.create({
                productId: product.productId,
                performedBy: userId,
                transactionType: InventoryTransactionType.EXPORT,
                quantityChange: -cartItem.quantity,
                quantityBefore: qtyBefore,
                quantityAfter: product.quantityAvailable,
                referenceType: 'ORDER',
                referenceId: orderId,
                unitCostAtTime: product.avgCost ?? null,
                note: 'Export by order checkout (legacy - no batch)',
                relatedOrderId: orderId,
              }),
            );
          }

          await this.syncDefaultWarehouseStock(
            entityManager,
            product.productId,
            -cartItem.quantity,
          );
        }

        await this.recordDiscountUsageInTx(
          entityManager,
          discount,
          userId,
          orderId,
        );

        if (creditLimit) {
          creditLimit.currentDebt = (
            Number(creditLimit.currentDebt ?? 0) + totalPayment
          ).toFixed(2);
          await transactionalCreditLimitRepository.save(creditLimit);
        }

        const history = transactionalHistoryRepository.create({
          orderId,
          oldStatus: null,
          newStatus: isBackorder
            ? OrderStatus.BACKORDERED
            : OrderStatus.PENDING,
          changedBy: userId,
          note: isBackorder
            ? 'Đơn hàng được tạo ở trạng thái chờ nhập kho'
            : 'Đơn hàng đã được tạo',
        });
        await transactionalHistoryRepository.save(history);

        await transactionalCartItemsRepository.delete({ cartId: cart.cartId });
        createdOrderWasNew = true;
      }),
    );

    if (!createdOrderWasNew) {
      return this.buildOrderDetail(
        await this.findOwnedOrder(userId, createdOrderId),
      );
    }

    const createdOrder = await this.findOwnedOrder(userId, createdOrderId);
    await this.notificationsService.sendOrderCreatedNotification(
      userId,
      createdOrderId,
    );
    await this.notifyAdminsAboutNewOrder(createdOrder);
    return this.buildOrderDetail(createdOrder);
  }

  /**
   * @deprecated Isolated dead path kept only as a short-term diff guard while
   * checkout creation uses createOrder above.
   */
  private async createOrderLegacyUnused(
    userId: string,
    createOrderDto: CreateOrderDto,
    idempotencyKey?: string,
  ) {
    const currentUser = await this.ensureUserExists(userId);
    await this.ensurePaymentMethodEnabled(createOrderDto.paymentMethod);

    if (idempotencyKey) {
      const existing = await this.ordersRepository.findOne({
        where: { idempotencyKey, userId },
      });
      if (existing) {
        return this.buildOrderDetail(
          await this.findOwnedOrder(userId, existing.orderId),
        );
      }
    }

    const cart = await this.cartsRepository.findOneBy({ userId });
    if (!cart) {
      throw new BadRequestException('Cart is empty');
    }

    const [cartItems, shippingAddress, deliveryMethod] = await Promise.all([
      this.cartItemsRepository.find({
        where: { cartId: cart.cartId },
        order: { createdAt: 'ASC', cartItemId: 'ASC' },
      }),
      this.shippingAddressesRepository.findOneBy({
        shippingAddressId: createOrderDto.shippingAddressId,
        userId,
      }),
      this.deliveryMethodsRepository.findOneBy({
        deliveryId: createOrderDto.deliveryId,
      }),
    ]);

    if (cartItems.length === 0) {
      throw new BadRequestException('Cart is empty');
    }

    if (!shippingAddress) {
      throw new NotFoundException('Shipping address not found');
    }

    if (!deliveryMethod || !deliveryMethod.isActive) {
      throw new NotFoundException('Delivery method not found');
    }

    const productIds = [...new Set(cartItems.map((item) => item.productId))];
    const products = await this.productsRepository.findBy(
      productIds.map((productId) => ({ productId })),
    );
    const productsById = new Map(
      products.map((product) => [product.productId, product]),
    );

    let subtotalAmount = 0;
    let totalQuantity = 0;
    let isBackorder = false;

    for (const cartItem of cartItems) {
      const product = productsById.get(cartItem.productId);
      if (!product || !product.isShow) {
        throw new BadRequestException('One or more products are unavailable');
      }
      // Pre-check: nếu hết hàng và KHÔNG cho backorder → reject sớm
      // (lock thật sự trong transaction phía dưới)
      if (cartItem.quantity > product.quantityAvailable) {
        if (!createOrderDto.allowBackorder) {
          throw new BadRequestException(
            `Sản phẩm ${product.productName} không đủ tồn kho`,
          );
        }
        isBackorder = true;
      }
      subtotalAmount += Number(cartItem.priceAtAdded) * cartItem.quantity;
      totalQuantity += cartItem.quantity;
    }

    const discountContext = await this.validateDiscountForCheckout(
      userId,
      createOrderDto.discountCode,
      subtotalAmount,
      cartItems,
      productsById,
    );
    const discount = discountContext?.discount ?? null;
    const discountAmount = discountContext
      ? this.calculateDiscountAmount(
          discountContext.discount,
          discountContext.eligibleSubtotal,
        )
      : 0;
    const deliveryCost = this.calculateLegacyDeliveryCost(
      deliveryMethod,
      subtotalAmount,
    );
    const totalPayment = subtotalAmount - discountAmount + deliveryCost;

    // Kiểm tra và xử lý hạn mức tín dụng cho đơn mua nợ
    let creditLimit: import('../credit-limits/entities/customer-credit-limit.entity').CustomerCreditLimitEntity | null = null;
    if (createOrderDto.paymentMethod === PaymentMethod.CREDIT) {
      if (!currentUser.isWholesale) {
        throw new BadRequestException('Phương thức "Mua nợ" chỉ dành cho khách sỉ được cấp hạn mức tín dụng');
      }
      creditLimit = await this.creditLimitRepository.findOne({ where: { userId, isActive: true as unknown as boolean } });
      if (!creditLimit) {
        throw new BadRequestException('Bạn chưa được cấp hạn mức tín dụng. Vui lòng liên hệ shop để được hỗ trợ');
      }
      const available = Number(creditLimit.creditLimit) - Number(creditLimit.currentDebt ?? 0);
      if (totalPayment > available) {
        throw new BadRequestException(
          `Vượt hạn mức tín dụng. Hạn mức còn lại: ${Math.max(0, available).toLocaleString('vi-VN')}₫`,
        );
      }
    }

    const addressSnapshot = this.buildAddressSnapshot(shippingAddress);
    const orderId = randomUUID();

    // Stock deduction inside a transaction with pessimistic_write lock per product
    // → tránh oversell khi nhiều request đồng thời cùng mua sản phẩm cuối cùng.
    // → tự retry tối đa 3 lần khi gặp deadlock MySQL.
    await withDeadlockRetry(() =>
      this.ordersRepository.manager.transaction(async (entityManager) => {
        const transactionalOrdersRepository =
          entityManager.getRepository(OrderEntity);
        const transactionalOrderItemsRepository =
          entityManager.getRepository(OrderItemEntity);
        const transactionalHistoryRepository = entityManager.getRepository(
          OrderStatusHistoryEntity,
        );
        const transactionalProductsRepository =
          entityManager.getRepository(ProductEntity);
        const transactionalCartItemsRepository =
          entityManager.getRepository(CartItemEntity);
        const transactionalInventoryTransactionsRepository =
          entityManager.getRepository(InventoryTransactionEntity);
        // Idempotency double-check inside transaction (race window protection)
        if (idempotencyKey) {
          const dup = await transactionalOrdersRepository.findOne({
            where: { idempotencyKey, userId },
          });
          if (dup) {
            return;
          }
        }

        const order = transactionalOrdersRepository.create({
          orderId,
          userId,
          shippingAddressId: shippingAddress.shippingAddressId,
          deliveryId: deliveryMethod.deliveryId,
          discountId: discount?.discountId ?? null,
          orderStatus: isBackorder
            ? OrderStatus.BACKORDERED
            : OrderStatus.PENDING,
          paymentMethod: createOrderDto.paymentMethod,
          paymentStatus: PaymentStatus.UNPAID,
          subtotalAmount: subtotalAmount.toFixed(2),
          discountAmount: discountAmount.toFixed(2),
          deliveryCost: deliveryCost.toFixed(2),
          totalPayment: totalPayment.toFixed(2),
          totalQuantity,
          note: createOrderDto.note ?? null,
          fullName: shippingAddress.recipientName,
          phone: shippingAddress.phone,
          address: addressSnapshot,
          idempotencyKey: idempotencyKey ?? null,
        });

        await transactionalOrdersRepository.save(order);

        for (const cartItem of cartItems) {
          // Lock row pessimistic — block các request khác đọc cùng product trong khi check + trừ stock
          const product = await transactionalProductsRepository.findOne({
            where: { productId: cartItem.productId },
            lock: { mode: 'pessimistic_write' },
          });
          if (!product || !product.isShow) {
            throw new BadRequestException(
              'One or more products are unavailable',
            );
          }
          // Re-check inside lock (race protection)
          const isLineBackorder =
            cartItem.quantity > product.quantityAvailable;
          if (isLineBackorder && !createOrderDto.allowBackorder) {
            throw new BadRequestException(
              `Sản phẩm ${product.productName} không đủ tồn kho`,
            );
          }

          const lineTotal = Number(cartItem.priceAtAdded) * cartItem.quantity;

          const orderItem = transactionalOrderItemsRepository.create({
            orderId,
            productId: cartItem.productId,
            productName: product.productName,
            quantity: cartItem.quantity,
            unitPrice: cartItem.priceAtAdded,
            lineTotal: lineTotal.toFixed(2),
            grossLineTotal: lineTotal.toFixed(2),
            discountAllocated: '0.00',
            netLineTotal: lineTotal.toFixed(2),
          });
          await transactionalOrderItemsRepository.save(orderItem);

          // Backorder line: KHÔNG trừ stock, KHÔNG ghi inventory transaction
          // (sẽ xử lý sau khi nhập hàng về và admin fulfill)
          if (isLineBackorder) {
            continue;
          }

          const qtyBefore = product.quantityAvailable;

          // FIFO/FEFO consumption: pick batches theo chiến lược hybrid
          // (exp_date ASC, NULL last, tie-break created_at ASC).
          // Có 2 nhánh:
          //  - Product có batch (sau khi đã migrate): consume từng batch + log txn/batch
          //  - Product KHÔNG có batch (legacy): fallback trừ quantityAvailable thuần
          //    để không break flow cũ. Migration script sẽ tạo legacy batch sau.
          const batchPick = await this.batchService.consumeInTx(
            entityManager,
            product.productId,
            cartItem.quantity,
          ).catch(async (err) => {
            // Nếu lỗi do KHÔNG có batch nào (legacy product), fallback
            const hasAnyBatch = await entityManager
              .createQueryBuilder()
              .select('1')
              .from('product_batches', 'b')
              .where('b.product_id = :pid', { pid: product.productId })
              .limit(1)
              .getRawOne();
            if (hasAnyBatch) {
              // Có batch nhưng không đủ → ném lỗi thật
              throw err;
            }
            return null; // legacy â†’ fallback
          });

          product.quantityAvailable -= cartItem.quantity;
          product.quantityReserved =
            (product.quantityReserved ?? 0) + cartItem.quantity;
          await transactionalProductsRepository.save(product);

          if (batchPick && batchPick.success) {
            // Log 1 txn per batch để truy vết FIFO chính xác
            let runningBefore = qtyBefore;
            for (const line of batchPick.lines) {
              const after = runningBefore - line.qty;
              await transactionalInventoryTransactionsRepository.save(
                transactionalInventoryTransactionsRepository.create({
                  productId: product.productId,
                  performedBy: userId,
                  transactionType: InventoryTransactionType.EXPORT,
                  quantityChange: -line.qty,
                  quantityBefore: runningBefore,
                  quantityAfter: after,
                  referenceType: 'ORDER',
                  referenceId: orderId,
                  batchId: line.batchId,
                  unitCostAtTime: line.unitCost.toFixed(4),
                  note: `Export by order checkout · lô ${line.batchCode}`,
                  relatedOrderId: orderId,
                }),
              );
              runningBefore = after;
            }
          } else {
            // Legacy fallback: log 1 txn không có batchId
            await transactionalInventoryTransactionsRepository.save(
              transactionalInventoryTransactionsRepository.create({
                productId: product.productId,
                performedBy: userId,
                transactionType: InventoryTransactionType.EXPORT,
                quantityChange: -cartItem.quantity,
                quantityBefore: qtyBefore,
                quantityAfter: product.quantityAvailable,
                referenceType: 'ORDER',
                referenceId: orderId,
                unitCostAtTime: product.avgCost ?? null,
                note: 'Export by order checkout (legacy — no batch)',
                relatedOrderId: orderId,
              }),
            );
          }

          await this.syncDefaultWarehouseStock(
            entityManager,
            product.productId,
            -cartItem.quantity,
          );
        }

        await this.recordDiscountUsageInTx(
          entityManager,
          discount,
          userId,
          orderId,
        );

        const history = transactionalHistoryRepository.create({
          orderId,
          oldStatus: null,
          newStatus: isBackorder
            ? OrderStatus.BACKORDERED
            : OrderStatus.PENDING,
          changedBy: userId,
          note: isBackorder
            ? 'Đơn hàng được tạo (đang chờ nhập kho)'
            : 'Đơn hàng đã được tạo',
        });
        await transactionalHistoryRepository.save(history);

        await transactionalCartItemsRepository.delete({ cartId: cart.cartId });
      }),
    );

    // Ghi nhận công nợ cho đơn mua nợ
    if (createOrderDto.paymentMethod === PaymentMethod.CREDIT && creditLimit) {
      await this.creditLimitRepository.update(
        { userId },
        { currentDebt: () => `current_debt + ${totalPayment}` },
      );
    }

    const createdOrder = await this.findOwnedOrder(userId, orderId);
    await this.notificationsService.sendOrderCreatedNotification(
      userId,
      orderId,
    );
    await this.notifyAdminsAboutNewOrder(createdOrder);
    return this.buildOrderDetail(createdOrder);
  }

  async findAllOrders(query: QueryOrdersDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;

    const queryBuilder = this.ordersRepository.createQueryBuilder('order');

    if (query.status) {
      queryBuilder.andWhere('order.order_status = :status', {
        status: query.status,
      });
    }

    if (query.search) {
      queryBuilder.andWhere(
        '(order.order_id LIKE :search OR order.user_id LIKE :search OR order.full_name LIKE :search OR order.phone LIKE :search)',
        { search: `%${query.search}%` },
      );
    }

    queryBuilder
      .orderBy('order.created_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [orders, total] = await queryBuilder.getManyAndCount();

    return {
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      items: orders.map((order) => this.toOrderSummary(order)),
    };
  }

  async findOrderDetail(currentUser: IUser, orderId: string) {
    await this.ensureUserExists(currentUser._id);
    const order = await this.findAccessibleOrder(currentUser, orderId);

    return this.buildOrderDetail(order);
  }

  async findOrderTracking(currentUser: IUser, orderId: string) {
    await this.ensureUserExists(currentUser._id);
    const order = await this.findAccessibleOrder(currentUser, orderId);
    const tracking = await this.findOrCreateOrderTracking(order.orderId);

    return this.mapOrderTracking(tracking);
  }

  async updateOrderTrackingMode(
    currentUser: IUser,
    orderId: string,
    updateOrderTrackingModeDto: UpdateOrderTrackingModeDto,
  ) {
    await this.ensureUserExists(currentUser._id);
    const order = await this.findAnyOrder(orderId);
    const tracking = await this.findOrCreateOrderTracking(order.orderId);

    tracking.mode = updateOrderTrackingModeDto.mode;
    const saved = await this.orderTrackingRepository.save(tracking);
    return this.mapOrderTracking(saved);
  }

  async updateManualOrderTracking(
    currentUser: IUser,
    orderId: string,
    updateOrderTrackingManualDto: UpdateOrderTrackingManualDto,
  ) {
    await this.ensureUserExists(currentUser._id);
    const order = await this.findAnyOrder(orderId);
    const tracking = await this.findOrCreateOrderTracking(order.orderId);

    tracking.manualLatitude = updateOrderTrackingManualDto.latitude.toFixed(7);
    tracking.manualLongitude = updateOrderTrackingManualDto.longitude.toFixed(7);
    tracking.manualNote = updateOrderTrackingManualDto.note?.trim() || null;
    tracking.manualUpdatedBy = currentUser._id;
    tracking.manualUpdatedAt = new Date();

    const saved = await this.orderTrackingRepository.save(tracking);
    return this.mapOrderTracking(saved);
  }

  async updateLiveOrderTracking(
    currentUser: IUser,
    orderId: string,
    updateOrderTrackingLiveDto: UpdateOrderTrackingLiveDto,
  ) {
    await this.ensureUserExists(currentUser._id);
    const order = await this.findAnyOrder(orderId);
    const tracking = await this.findOrCreateOrderTracking(order.orderId);

    tracking.gpsLatitude = updateOrderTrackingLiveDto.latitude.toFixed(7);
    tracking.gpsLongitude = updateOrderTrackingLiveDto.longitude.toFixed(7);
    tracking.gpsHeading =
      updateOrderTrackingLiveDto.heading !== undefined
        ? updateOrderTrackingLiveDto.heading.toFixed(2)
        : null;
    tracking.gpsSpeedKph =
      updateOrderTrackingLiveDto.speedKph !== undefined
        ? updateOrderTrackingLiveDto.speedKph.toFixed(2)
        : null;
    tracking.gpsProvider = updateOrderTrackingLiveDto.provider?.trim() || null;
    tracking.gpsUpdatedAt = new Date();

    const saved = await this.orderTrackingRepository.save(tracking);
    return this.mapOrderTracking(saved);
  }

  async cancelOrder(userId: string, orderId: string) {
    await this.ensureUserExists(userId);
    const order = await this.findOwnedOrder(userId, orderId);
    const previousStatus = order.orderStatus;

    if (
      ![OrderStatus.PENDING, OrderStatus.CONFIRMED].includes(order.orderStatus)
    ) {
      throw new BadRequestException('Order cannot be cancelled');
    }

    if (
      [PaymentStatus.PAID, PaymentStatus.PARTIAL_REFUNDED].includes(
        order.paymentStatus,
      )
    ) {
      throw new BadRequestException({
        message:
          'Đơn đã thu tiền phải đi qua quy trình hoàn tiền trước khi đóng hủy.',
        error: 'PAID_ORDER_CANCEL_REQUIRES_REFUND',
      });
    }

    await this.ordersRepository.manager.transaction(async (entityManager) => {
      const transactionalOrdersRepository =
        entityManager.getRepository(OrderEntity);
      const transactionalOrderItemsRepository =
        entityManager.getRepository(OrderItemEntity);
      const transactionalProductsRepository =
        entityManager.getRepository(ProductEntity);
      const transactionalHistoryRepository = entityManager.getRepository(
        OrderStatusHistoryEntity,
      );
      const transactionalDiscountsRepository =
        entityManager.getRepository(DiscountEntity);
      const transactionalCouponUsageRepository =
        entityManager.getRepository(CouponUsageEntity);

      await this.restockOrderItems(
        order.orderId,
        transactionalProductsRepository,
        transactionalOrderItemsRepository,
        entityManager,
      );

      await this.revertDiscountUsage(
        order,
        transactionalDiscountsRepository,
        transactionalCouponUsageRepository,
      );

      order.orderStatus = OrderStatus.CANCELLED;
      await transactionalOrdersRepository.save(order);

      const history = transactionalHistoryRepository.create({
        orderId: order.orderId,
        oldStatus: previousStatus,
        newStatus: OrderStatus.CANCELLED,
        changedBy: userId,
        note: 'Khách hàng đã hủy đơn',
      });
      await transactionalHistoryRepository.save(history);
    });

    // Hoàn lại công nợ khi hủy đơn mua nợ
    if (order.paymentMethod === PaymentMethod.CREDIT) {
      await this.creditLimitRepository.update(
        { userId },
        { currentDebt: () => `GREATEST(0, current_debt - ${Number(order.totalPayment)})` },
      );
    }

    const cancelledOrder = await this.findOwnedOrder(userId, orderId);
    await this.notificationsService.sendOrderStatusNotification(
      userId,
      orderId,
      OrderStatus.CANCELLED,
    );
    return this.buildOrderDetail(cancelledOrder);
  }

  async updateOrderStatus(
    currentUser: IUser,
    orderId: string,
    updateOrderStatusDto: UpdateOrderStatusDto,
  ) {
    await this.ensureUserExists(currentUser._id);
    const order = await this.findAnyOrder(orderId);
    const previousStatus = order.orderStatus;
    const previousPaymentStatus = order.paymentStatus;
    const nextStatus = updateOrderStatusDto.status;

    if (
      nextStatus === OrderStatus.CANCELLED &&
      [PaymentStatus.PAID, PaymentStatus.PARTIAL_REFUNDED].includes(
        order.paymentStatus,
      )
    ) {
      throw new BadRequestException({
        message:
          'Đơn đã thu tiền không thể hủy trực tiếp. Hãy xử lý hoàn tiền trước.',
        error: 'PAID_ORDER_CANCEL_REQUIRES_REFUND',
      });
    }

    if (nextStatus === OrderStatus.RETURNED) {
      throw new BadRequestException(
        'Đơn trả hàng phải xử lý bằng yêu cầu trả hàng và kiểm tra hàng, không đổi thẳng trạng thái đơn sang đã trả hàng.',
      );
    }

    if (previousStatus === nextStatus) {
      return this.buildOrderDetail(order);
    }

    if (
      [
        OrderStatus.DELIVERED,
        OrderStatus.PARTIAL_DELIVERED,
        OrderStatus.RETURNED,
      ].includes(previousStatus)
    ) {
      throw new BadRequestException('Finalized order cannot change status');
    }

    if (previousStatus === OrderStatus.CANCELLED) {
      throw new BadRequestException('Cancelled order cannot change status');
    }

    if (!this.isValidAdminStatusTransition(previousStatus, nextStatus)) {
      throw new BadRequestException('Invalid order status transition');
    }

    await this.ordersRepository.manager.transaction(async (entityManager) => {
      const transactionalOrdersRepository =
        entityManager.getRepository(OrderEntity);
      const transactionalOrderItemsRepository =
        entityManager.getRepository(OrderItemEntity);
      const transactionalProductsRepository =
        entityManager.getRepository(ProductEntity);
      const transactionalHistoryRepository = entityManager.getRepository(
        OrderStatusHistoryEntity,
      );
      const transactionalInventoryTransactionsRepository =
        entityManager.getRepository(InventoryTransactionEntity);
      const transactionalDiscountsRepository =
        entityManager.getRepository(DiscountEntity);
      const transactionalCouponUsageRepository =
        entityManager.getRepository(CouponUsageEntity);

      // BACKORDERED → PENDING: fulfill backorder, trừ stock chính thức
      if (
        previousStatus === OrderStatus.BACKORDERED &&
        nextStatus === OrderStatus.PENDING
      ) {
        const items = await transactionalOrderItemsRepository.find({
          where: { orderId: order.orderId },
        });
        for (const item of items) {
          const product = await transactionalProductsRepository.findOne({
            where: { productId: item.productId },
            lock: { mode: 'pessimistic_write' },
          });
          if (!product) {
            throw new BadRequestException(
              `Sản phẩm trong đơn không còn tồn tại`,
            );
          }
          if (item.quantity > product.quantityAvailable) {
            throw new BadRequestException(
              `Sản phẩm ${product.productName} vẫn chưa đủ tồn kho để fulfill`,
            );
          }
          const qtyBefore = product.quantityAvailable;
          const batchPick = await this.batchService
            .consumeInTx(entityManager, product.productId, item.quantity)
            .catch(async (err) => {
              const hasAnyBatch = await entityManager
                .createQueryBuilder()
                .select('1')
                .from('product_batches', 'b')
                .where('b.product_id = :pid', { pid: product.productId })
                .limit(1)
                .getRawOne();
              if (hasAnyBatch) throw err;
              return null;
            });
          product.quantityAvailable -= item.quantity;
          product.quantityReserved =
            (product.quantityReserved ?? 0) + item.quantity;
          await transactionalProductsRepository.save(product);

          if (batchPick?.success) {
            let runningBefore = qtyBefore;
            for (const line of batchPick.lines) {
              await transactionalInventoryTransactionsRepository.save(
                transactionalInventoryTransactionsRepository.create({
                  productId: item.productId,
                  performedBy: currentUser._id,
                  transactionType: InventoryTransactionType.EXPORT,
                  quantityChange: -line.qty,
                  quantityBefore: runningBefore,
                  quantityAfter: runningBefore - line.qty,
                  referenceType: 'ORDER',
                  referenceId: order.orderId,
                  batchId: line.batchId,
                  unitCostAtTime: line.unitCost.toFixed(4),
                  note: `Export by backorder fulfillment - batch ${line.batchCode}`,
                  relatedOrderId: order.orderId,
                }),
              );
              runningBefore -= line.qty;
            }
          } else {
            await transactionalInventoryTransactionsRepository.save(
              transactionalInventoryTransactionsRepository.create({
                productId: item.productId,
                performedBy: currentUser._id,
                transactionType: InventoryTransactionType.EXPORT,
                quantityChange: -item.quantity,
                quantityBefore: qtyBefore,
                quantityAfter: product.quantityAvailable,
                referenceType: 'ORDER',
                referenceId: order.orderId,
                unitCostAtTime: product.avgCost ?? null,
                note: 'Export by backorder fulfillment (legacy - no batch)',
                relatedOrderId: order.orderId,
              }),
            );
          }
          await this.syncDefaultWarehouseStock(
            entityManager,
            item.productId,
            -item.quantity,
          );
        }
      }

      if (nextStatus === OrderStatus.CANCELLED) {
        // Backorder bị cancel: KHÔNG restock vì chưa từng trừ stock
        const isBackorderCancel =
          previousStatus === OrderStatus.BACKORDERED &&
          nextStatus === OrderStatus.CANCELLED;

        if (isBackorderCancel) {
          await this.revertDiscountUsage(
            order,
            transactionalDiscountsRepository,
            transactionalCouponUsageRepository,
          );
          order.orderStatus = nextStatus;
          await transactionalOrdersRepository.save(order);
          const history = transactionalHistoryRepository.create({
            orderId: order.orderId,
            oldStatus: previousStatus,
            newStatus: nextStatus,
            changedBy: currentUser._id,
            note: updateOrderStatusDto.note ?? 'Đã hủy đơn chờ hàng',
          });
          await transactionalHistoryRepository.save(history);
          return;
        }

        // RETURNED: KHÔNG tự restock, chỉ giải phóng reserved (nếu chưa giao)
        // → Hàng phải qua inspection trước. Stock chỉ được restock khi
        //   admin inspect = USABLE.
        // CANCELLED: vẫn restock bình thường (hàng chưa rời kho).
        if (nextStatus === OrderStatus.CANCELLED) {
          await this.restockOrderItems(
            order.orderId,
            transactionalProductsRepository,
            transactionalOrderItemsRepository,
            entityManager,
          );
          await this.revertDiscountUsage(
            order,
            transactionalDiscountsRepository,
            transactionalCouponUsageRepository,
          );
        }
      }

      // Khi DELIVERED: giải phóng reserved (hàng đã rời kho thật sự)
      if (nextStatus === OrderStatus.DELIVERED) {
        await this.releaseReservedOnDelivered(
          order.orderId,
          transactionalProductsRepository,
          transactionalOrderItemsRepository,
        );
      }

      order.orderStatus = nextStatus;

      // Payment status logic:
      // - COD + DELIVERED → PAID (khách trả tiền khi nhận hàng)
      // - Online (non-COD) khi CONFIRMED: KHÔNG tự đặt PAID nữa.
      //   Phải có PaymentTransaction từ gateway hoặc admin xác nhận thủ công.
      //   (giữ nguyên paymentStatus hiện tại — thường là UNPAID)
      if (
        nextStatus === OrderStatus.DELIVERED &&
        order.paymentMethod === PaymentMethod.COD
      ) {
        order.paymentStatus = PaymentStatus.PAID;
      }

      if (nextStatus === OrderStatus.CANCELLED) {
        order.paymentStatus =
          order.paymentStatus === PaymentStatus.PAID
            ? PaymentStatus.REFUNDED
            : PaymentStatus.FAILED;
      }

      await transactionalOrdersRepository.save(order);

      const history = transactionalHistoryRepository.create({
        orderId: order.orderId,
        oldStatus: previousStatus,
        newStatus: nextStatus,
        changedBy: currentUser._id,
        note: updateOrderStatusDto.note ?? 'Cập nhật trạng thái bởi admin',
      });
      await transactionalHistoryRepository.save(history);
    });

    // Hoàn lại công nợ khi admin hủy đơn mua nợ chưa thanh toán
    if (
      nextStatus === OrderStatus.CANCELLED &&
      order.paymentMethod === PaymentMethod.CREDIT &&
      previousPaymentStatus === PaymentStatus.UNPAID
    ) {
      await this.creditLimitRepository.update(
        { userId: order.userId },
        { currentDebt: () => `GREATEST(0, current_debt - ${Number(order.totalPayment)})` },
      );
    }

    const updatedOrder = await this.findAnyOrder(orderId);
    await this.notificationsService.sendOrderStatusNotification(
      updatedOrder.userId,
      orderId,
      nextStatus,
    );

    if (
      nextStatus === OrderStatus.DELIVERED &&
      updatedOrder.userId &&
      !(await this.isGuestUserId(updatedOrder.userId))
    ) {
      void this.membershipService.recalculateAndReward(updatedOrder.userId);
    }

    return this.buildOrderDetail(updatedOrder);
  }

  async initiatePayment(
    currentUser: IUser | undefined,
    orderId: string,
    initiatePaymentDto: InitiatePaymentDto,
  ) {
    const order = currentUser
      ? await this.findAccessibleOrder(currentUser, orderId)
      : await this.findAnyOrder(orderId);

    if (currentUser) {
      await this.ensureUserExists(currentUser._id);
    } else {
      const normalizePhone = (value: string) => value.replace(/\s+/g, '');
      if (!(await this.isGuestUserId(order.userId))) {
        throw new UnauthorizedException('Order is not a guest order');
      }
      if (
        !initiatePaymentDto.phone ||
        normalizePhone(order.phone) !== normalizePhone(initiatePaymentDto.phone)
      ) {
        throw new UnauthorizedException('Phone number does not match order');
      }
    }

    if (!this.isOnlinePaymentMethod(order.paymentMethod)) {
      throw new BadRequestException({
        message: 'Đơn hàng không dùng phương thức thanh toán online.',
        error: 'ORDER_NOT_PAYABLE',
      });
    }

    if (order.paymentStatus === PaymentStatus.PAID) {
      throw new BadRequestException({
        message: 'Đơn hàng đã được thanh toán.',
        error: 'ORDER_ALREADY_PAID',
      });
    }

    const retryInfo = this.getPaymentRetryInfo(order);
    if (!retryInfo.canRetryPayment) {
      const errorCode =
        retryInfo.paymentBlockedReason === 'PAYMENT_EXPIRED'
          ? 'PAYMENT_WINDOW_EXPIRED'
          : 'ORDER_NOT_PAYABLE';
      throw new BadRequestException({
        message:
          errorCode === 'PAYMENT_WINDOW_EXPIRED'
            ? 'Đơn hàng đã quá hạn thanh toán 30 phút.'
            : 'Đơn hàng hiện không thể thanh toán lại.',
        error: errorCode,
      });
    }

    const transactionRef =
      order.paymentMethod === PaymentMethod.ZALOPAY
        ? this.buildZaloPayTransactionRef()
        : `${orderId}-${Date.now()}`;
    const paymentTransaction = this.paymentTransactionsRepository.create({
      orderId,
      userId: order.userId,
      provider: order.paymentMethod,
      transactionRef,
      transactionStatus: PaymentTransactionStatus.PENDING,
      paymentStatus: PaymentStatus.UNPAID,
      amount: order.totalPayment,
      gatewayCode: null,
      gatewayMessage: null,
      rawPayload: {
        returnUrl: initiatePaymentDto.returnUrl ?? null,
      },
    });

    await this.paymentTransactionsRepository.save(paymentTransaction);

    // Sentinel value — frontend detects this and shows simulation modal
    let paymentUrl = `https://payment-gateway.local?provider=${order.paymentMethod}&transactionRef=${transactionRef}&orderId=${orderId}`;

    if (order.paymentMethod === PaymentMethod.MOMO) {
      const momoUrl = await this.buildMomoPaymentUrl(
        orderId,
        transactionRef,
        Math.round(Number(order.totalPayment)),
        initiatePaymentDto.returnUrl ?? `${process.env.FRONTEND_URL ?? 'http://localhost:5173'}/client/payment`,
      ).catch((err: unknown) => {
        console.error('[MoMo] buildMomoPaymentUrl error:', err);
        return null;
      });
      if (momoUrl) {
        paymentUrl = momoUrl;
      } else {
        console.warn('[MoMo] Không lấy được paymentUrl — kiểm tra credentials và BACKEND_URL trong .env');
      }
    }

    if (order.paymentMethod === PaymentMethod.VNPAY) {
      const vnpayUrl = await this.buildVnpayPaymentUrl(
        orderId,
        transactionRef,
        Math.round(Number(order.totalPayment)),
        initiatePaymentDto.returnUrl ?? `${process.env.FRONTEND_URL ?? 'http://localhost:5173'}/client/payment`,
      ).catch((err: unknown) => {
        console.error('[VNPay] buildVnpayPaymentUrl error:', err);
        return null;
      });
      if (vnpayUrl) {
        paymentUrl = vnpayUrl;
      } else {
        console.warn('[VNPay] Không lấy được paymentUrl - kiểm tra VNPAY_TMN_CODE/VNPAY_HASH_SECRET');
      }
    }

    if (order.paymentMethod === PaymentMethod.ZALOPAY) {
      const zaloPayUrl = await this.buildZaloPayPaymentUrl(
        orderId,
        transactionRef,
        order.userId,
        Math.round(Number(order.totalPayment)),
        initiatePaymentDto.returnUrl ?? `${process.env.FRONTEND_URL ?? 'http://localhost:5173'}/client/payment`,
      ).catch((err: unknown) => {
        console.error('[ZaloPay] buildZaloPayPaymentUrl error:', err);
        return null;
      });
      if (zaloPayUrl) {
        paymentUrl = zaloPayUrl;
      } else {
        console.warn('[ZaloPay] Không lấy được order_url - kiểm tra ZALOPAY_APP_ID/KEY1/KEY2');
      }
    }

    return {
      orderId,
      provider: order.paymentMethod,
      transactionRef,
      paymentUrl,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    };
  }

  private async buildMomoPaymentUrl(
    internalOrderId: string,
    requestId: string,
    amount: number,
    redirectUrl: string,
  ): Promise<string | null> {
    const { partnerCode, accessKey, secretKey } =
      await this.settingsService.getMomoConfig();

    if (!partnerCode || !accessKey || !secretKey) return null;

    // Use requestId as MoMo orderId to guarantee uniqueness per request
    const momoOrderId = requestId;
    const ipnUrl = `${process.env.BACKEND_URL ?? 'http://localhost:8000'}/api/v1/payments/momo/ipn`;
    const orderInfo = `Thanh toan don hang ${internalOrderId}`;
    const requestType = 'payWithMethod';
    const extraData = '';
    const lang = 'vi';

    const rawSignature = [
      `accessKey=${accessKey}`,
      `amount=${amount}`,
      `extraData=${extraData}`,
      `ipnUrl=${ipnUrl}`,
      `orderId=${momoOrderId}`,
      `orderInfo=${orderInfo}`,
      `partnerCode=${partnerCode}`,
      `redirectUrl=${redirectUrl}`,
      `requestId=${requestId}`,
      `requestType=${requestType}`,
    ].join('&');

    const signature = createHmac('sha256', secretKey).update(rawSignature).digest('hex');

    const body = {
      partnerCode,
      accessKey,
      requestId,
      amount,
      orderId: momoOrderId,
      orderInfo,
      redirectUrl,
      ipnUrl,
      requestType,
      extraData,
      lang,
      signature,
    };

    // Use sandbox endpoint when partner code is the MoMo test value
    const isSandbox = partnerCode === 'MOMO' || process.env.MOMO_SANDBOX === 'true';
    const endpoint = isSandbox
      ? 'https://test-payment.momo.vn/v2/gateway/api/create'
      : 'https://payment.momo.vn/v2/gateway/api/create';

    console.log(`[MoMo] Calling ${isSandbox ? 'SANDBOX' : 'PRODUCTION'} endpoint`);
    console.log('[MoMo] orderId:', momoOrderId, '| amount:', amount, '| ipnUrl:', ipnUrl);

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = (await response.json()) as { resultCode?: number; payUrl?: string; message?: string };
    console.log('[MoMo] Response:', JSON.stringify(data));
    if (data.resultCode === 0 && data.payUrl) return data.payUrl;
    console.error(`[MoMo] resultCode=${data.resultCode ?? 'N/A'} message=${data.message ?? 'N/A'}`);
    return null;
  }

  private async buildVnpayPaymentUrl(
    internalOrderId: string,
    transactionRef: string,
    amount: number,
    returnUrl: string,
  ): Promise<string | null> {
    const { tmnCode, hashSecret, paymentUrl } =
      await this.settingsService.getVnpayConfig();
    if (!tmnCode || !hashSecret) return null;

    const backendUrl = process.env.BACKEND_URL ?? 'http://localhost:8000';
    const params: Record<string, string | number> = {
      vnp_Version: '2.1.0',
      vnp_Command: 'pay',
      vnp_TmnCode: tmnCode,
      vnp_Amount: amount * 100,
      vnp_CurrCode: 'VND',
      vnp_TxnRef: transactionRef,
      vnp_OrderInfo: `Thanh toan don hang ${internalOrderId}`,
      vnp_OrderType: 'other',
      vnp_Locale: 'vn',
      vnp_ReturnUrl: returnUrl,
      vnp_IpnUrl: `${backendUrl}/api/v1/payments/vnpay/ipn`,
      vnp_IpAddr: '127.0.0.1',
      vnp_CreateDate: this.formatGatewayDate(),
    };
    const query = buildVnpayPaymentQuery(params, hashSecret);
    return `${paymentUrl}?${query}`;
  }

  private async buildZaloPayPaymentUrl(
    internalOrderId: string,
    appTransId: string,
    userId: string,
    amount: number,
    redirectUrl: string,
  ): Promise<string | null> {
    const { appId, key1, createEndpoint } =
      await this.settingsService.getZaloPayConfig();
    if (!appId || !key1) return null;

    const callbackUrl = `${process.env.BACKEND_URL ?? 'http://localhost:8000'}/api/v1/payments/zalopay/callback`;
    const embedData = JSON.stringify({
      redirecturl: redirectUrl,
      callbackurl: callbackUrl,
      internalOrderId,
    });
    const item = JSON.stringify([]);
    const appTime = Date.now();
    const appUser = userId || 'guest';
    const description = `Thanh toán đơn hàng ${internalOrderId}`;
    const rawMac = `${appId}|${appTransId}|${appUser}|${amount}|${appTime}|${embedData}|${item}`;
    const mac = createHmac('sha256', key1).update(rawMac, 'utf8').digest('hex');

    const body = new URLSearchParams({
      app_id: appId,
      app_user: appUser,
      app_trans_id: appTransId,
      app_time: String(appTime),
      amount: String(amount),
      item,
      embed_data: embedData,
      description,
      callback_url: callbackUrl,
      mac,
    });

    const response = await fetch(createEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const data = (await response.json()) as {
      return_code?: number;
      order_url?: string;
      return_message?: string;
    };
    console.log('[ZaloPay] Response:', JSON.stringify(data));
    if (data.return_code === 1 && data.order_url) return data.order_url;
    console.error(`[ZaloPay] return_code=${data.return_code ?? 'N/A'} message=${data.return_message ?? 'N/A'}`);
    return null;
  }

  async handleMomoIpn(body: Record<string, unknown>) {
    const { accessKey, secretKey } = await this.settingsService.getMomoConfig();
    if (!secretKey || !accessKey) return { message: 'ignored' };

    // 1. VERIFY HMAC SIGNATURE — chống fake callback
    if (!verifyMomoSignature(body, accessKey, secretKey)) {
      throw new UnauthorizedException('Invalid MoMo signature');
    }

    const {
      orderId: momoOrderId,
      requestId,
      amount,
      resultCode,
      transId,
      message: gwMessage,
    } = body as {
      orderId?: string;
      requestId?: string;
      amount?: number;
      resultCode?: number | string;
      transId?: string;
      message?: string;
    };

    // momoOrderId = transactionRef (requestId) — look up the real order via transactions table
    const txRef = momoOrderId ?? requestId;
    if (!txRef) return { message: 'missing orderId' };

    const transaction = await this.paymentTransactionsRepository
      .findOne({ where: { transactionRef: txRef } })
      .catch(() => null);

    const internalOrderId = transaction?.orderId;
    if (!internalOrderId) return { message: 'transaction not found' };

    const order = await this.ordersRepository
      .findOneBy({ orderId: internalOrderId })
      .catch(() => null);
    if (!order) return { message: 'order not found' };

    // 2. IDEMPOTENCY — Nếu đã xử lý transId này thành SUCCESS rồi thì return luôn
    if (
      transaction &&
      transaction.transactionStatus === PaymentTransactionStatus.SUCCESS &&
      transaction.gatewayCode === String(resultCode ?? '')
    ) {
      return { message: 'already processed', transId };
    }

    // 3. AMOUNT MISMATCH GUARD — Tránh fake amount nhỏ
    if (amount !== undefined && amount !== null) {
      const expectedAmount = Number(order.totalPayment);
      const reportedAmount = Number(amount);
      if (
        Number.isFinite(expectedAmount) &&
        Number.isFinite(reportedAmount) &&
        Math.abs(expectedAmount - reportedAmount) > 0.01
      ) {
        // Lưu transaction là FAILED do amount mismatch — không update order
        if (transaction) {
          transaction.transactionStatus = PaymentTransactionStatus.FAILED;
          transaction.gatewayCode = 'AMOUNT_MISMATCH';
          transaction.gatewayMessage = `Expected ${expectedAmount}, got ${reportedAmount}`;
          transaction.rawPayload = body;
          await this.paymentTransactionsRepository.save(transaction);
        }
        throw new BadRequestException('Payment amount mismatch');
      }
    }

    const resultCodeValue = Number(resultCode);
    const success = resultCodeValue === 0;
    const paymentStatus = success ? PaymentStatus.PAID : PaymentStatus.FAILED;
    const reportedAmount = Number(amount ?? order.totalPayment);

    // Update existing transaction status if found, or create a new one
    if (transaction) {
      transaction.transactionStatus = success
        ? PaymentTransactionStatus.SUCCESS
        : PaymentTransactionStatus.FAILED;
      transaction.paymentStatus = paymentStatus;
      transaction.gatewayCode = String(resultCode ?? '');
      transaction.gatewayMessage = (gwMessage as string) ?? null;
      transaction.rawPayload = body;
      await this.paymentTransactionsRepository.save(transaction);
    } else {
      const newTx = this.paymentTransactionsRepository.create({
        orderId: internalOrderId,
        userId: order.userId,
        provider: PaymentMethod.MOMO,
        transactionRef: txRef,
        transactionStatus: success
          ? PaymentTransactionStatus.SUCCESS
          : PaymentTransactionStatus.FAILED,
        paymentStatus,
        amount: String(amount ?? order.totalPayment),
        gatewayCode: String(resultCode ?? ''),
        gatewayMessage: (gwMessage as string) ?? null,
        rawPayload: body,
      });
      await this.paymentTransactionsRepository.save(newTx);
    }

    if (success && this.isTerminalOrderStatus(order.orderStatus)) {
      await this.createLatePaymentRefundIfNeeded({
        order,
        amount: reportedAmount,
        provider: PaymentMethod.MOMO,
        transactionRef: txRef,
        note: `MoMo payment arrived after order was ${order.orderStatus}; queued for manual refund.`,
      });
      await this.notificationsService.sendPaymentNotification(
        order.userId,
        internalOrderId,
        PaymentStatus.PARTIAL_REFUNDED,
        PaymentMethod.MOMO,
      );
      return {
        message: 'late payment queued for manual refund',
        transId,
        refundStatus: OrderRefundStatus.PENDING,
      };
    }

    order.paymentStatus = success
      ? PaymentStatus.PAID
      : order.paymentStatus === PaymentStatus.PAID
        ? PaymentStatus.PAID
        : PaymentStatus.UNPAID;
    await this.ordersRepository.save(order);

    await this.notificationsService.sendPaymentNotification(
      order.userId,
      internalOrderId,
      paymentStatus,
      PaymentMethod.MOMO,
    );

    return { message: 'ok', transId };
  }

  async handleVnpayCallback(query: Record<string, unknown>) {
    const { hashSecret } = await this.settingsService.getVnpayConfig();
    if (!hashSecret) return { RspCode: '99', Message: 'VNPay is not configured' };

    if (!verifyVnpaySignature(query, hashSecret)) {
      throw new UnauthorizedException('Invalid VNPay signature');
    }

    const transactionRef = String(query.vnp_TxnRef ?? '');
    if (!transactionRef) return { RspCode: '01', Message: 'Missing transaction reference' };

    const responseCode = String(query.vnp_ResponseCode ?? '');
    const transactionStatus = String(query.vnp_TransactionStatus ?? '');
    const success = responseCode === '00' && transactionStatus === '00';
    const amount = Number(query.vnp_Amount ?? 0) / 100;
    const gatewayTransId = String(query.vnp_TransactionNo ?? '');
    const gatewayMessage = String(query.vnp_OrderInfo ?? '');

    const result = await this.applyVerifiedGatewayPaymentResult({
      provider: PaymentMethod.VNPAY,
      transactionRef,
      success,
      amount,
      gatewayCode: responseCode || transactionStatus,
      gatewayMessage,
      rawPayload: query,
      latePaymentNote: `VNPay payment arrived after order was closed; queued for manual refund.`,
    });

    return {
      RspCode: result.message === 'transaction not found' ? '01' : '00',
      Message: result.message,
      orderId: result.orderId,
      transactionRef,
      gatewayTransId,
    };
  }

  async handleZaloPayCallback(body: Record<string, unknown>) {
    const { key2 } = await this.settingsService.getZaloPayConfig();
    if (!key2) return { return_code: 2, return_message: 'ZaloPay is not configured' };

    if (!verifyZaloPayCallback(body, key2)) {
      throw new UnauthorizedException('Invalid ZaloPay signature');
    }

    const dataRaw = String(body.data ?? '');
    const data = JSON.parse(dataRaw) as {
      app_trans_id?: string;
      amount?: number | string;
      zp_trans_id?: string | number;
      return_code?: number | string;
      return_message?: string;
    };
    const transactionRef = String(data.app_trans_id ?? '');
    if (!transactionRef) return { return_code: 2, return_message: 'Missing app_trans_id' };

    const result = await this.applyVerifiedGatewayPaymentResult({
      provider: PaymentMethod.ZALOPAY,
      transactionRef,
      success: true,
      amount: Number(data.amount ?? 0),
      gatewayCode: String(data.zp_trans_id ?? data.return_code ?? '1'),
      gatewayMessage: data.return_message ?? 'ZaloPay callback success',
      rawPayload: { ...body, parsedData: data },
      latePaymentNote: `ZaloPay payment arrived after order was closed; queued for manual refund.`,
    });

    return {
      return_code: result.message === 'transaction not found' ? 2 : 1,
      return_message: result.message,
      orderId: result.orderId,
      transactionRef,
    };
  }

  private async applyVerifiedGatewayPaymentResult(args: {
    provider: PaymentMethod;
    transactionRef: string;
    success: boolean;
    amount: number;
    gatewayCode: string;
    gatewayMessage: string | null;
    rawPayload: Record<string, unknown>;
    latePaymentNote: string;
  }) {
    const transaction = await this.paymentTransactionsRepository
      .findOne({ where: { transactionRef: args.transactionRef } })
      .catch(() => null);
    if (!transaction) {
      return {
        message: 'transaction not found',
        provider: args.provider,
        transactionRef: args.transactionRef,
      };
    }

    const order = await this.ordersRepository
      .findOneBy({ orderId: transaction.orderId })
      .catch(() => null);
    if (!order) {
      return {
        message: 'order not found',
        provider: args.provider,
        transactionRef: args.transactionRef,
      };
    }

    if (order.paymentMethod !== args.provider) {
      throw new BadRequestException('Payment provider does not match order');
    }

    if (
      transaction.transactionStatus === PaymentTransactionStatus.SUCCESS &&
      transaction.gatewayCode === args.gatewayCode
    ) {
      return {
        message: 'already processed',
        orderId: order.orderId,
        provider: args.provider,
        transactionRef: args.transactionRef,
        paymentStatus: transaction.paymentStatus,
      };
    }

    if (args.success) {
      const expectedAmount = Number(order.totalPayment);
      if (
        Number.isFinite(expectedAmount) &&
        Number.isFinite(args.amount) &&
        Math.abs(expectedAmount - args.amount) > 0.01
      ) {
        transaction.transactionStatus = PaymentTransactionStatus.FAILED;
        transaction.paymentStatus = PaymentStatus.FAILED;
        transaction.gatewayCode = 'AMOUNT_MISMATCH';
        transaction.gatewayMessage = `Expected ${expectedAmount}, got ${args.amount}`;
        transaction.rawPayload = args.rawPayload;
        await this.paymentTransactionsRepository.save(transaction);
        throw new BadRequestException('Payment amount mismatch');
      }
    }

    const paymentStatus = args.success ? PaymentStatus.PAID : PaymentStatus.FAILED;
    transaction.transactionStatus = args.success
      ? PaymentTransactionStatus.SUCCESS
      : PaymentTransactionStatus.FAILED;
    transaction.paymentStatus = paymentStatus;
    transaction.gatewayCode = args.gatewayCode;
    transaction.gatewayMessage = args.gatewayMessage;
    transaction.rawPayload = args.rawPayload;
    await this.paymentTransactionsRepository.save(transaction);

    if (args.success && this.isTerminalOrderStatus(order.orderStatus)) {
      await this.createLatePaymentRefundIfNeeded({
        order,
        amount: args.amount,
        provider: args.provider,
        transactionRef: args.transactionRef,
        note: args.latePaymentNote,
      });
      await this.notificationsService.sendPaymentNotification(
        order.userId,
        order.orderId,
        PaymentStatus.PARTIAL_REFUNDED,
        args.provider,
      );
      return {
        message: 'late payment queued for manual refund',
        orderId: order.orderId,
        provider: args.provider,
        transactionRef: args.transactionRef,
        paymentStatus: order.paymentStatus,
        refundStatus: OrderRefundStatus.PENDING,
      };
    }

    order.paymentStatus = args.success
      ? PaymentStatus.PAID
      : order.paymentStatus === PaymentStatus.PAID
        ? PaymentStatus.PAID
        : PaymentStatus.UNPAID;
    await this.ordersRepository.save(order);
    await this.notificationsService.sendPaymentNotification(
      order.userId,
      order.orderId,
      paymentStatus,
      args.provider,
    );

    return {
      message: 'ok',
      orderId: order.orderId,
      provider: args.provider,
      transactionRef: args.transactionRef,
      paymentStatus,
    };
  }

  async handlePaymentCallback(
    provider: string,
    paymentCallbackDto: PaymentCallbackDto,
  ) {
    if (
      process.env.NODE_ENV === 'production' &&
      process.env.ENABLE_UNVERIFIED_PAYMENT_CALLBACKS !== 'true'
    ) {
      throw new UnauthorizedException(
        'Unsigned payment callback is disabled in production',
      );
    }

    const normalizedProvider = provider.toLowerCase() as PaymentMethod;
    const order = await this.findAnyOrder(paymentCallbackDto.orderId);

    if (order.paymentMethod !== normalizedProvider) {
      throw new BadRequestException('Payment provider does not match order');
    }

    // 1. IDEMPOTENCY — Tránh xử lý lại cùng transactionRef
    const existingTx = await this.paymentTransactionsRepository.findOne({
      where: { transactionRef: paymentCallbackDto.transactionRef },
    });
    if (
      existingTx &&
      existingTx.transactionStatus === PaymentTransactionStatus.SUCCESS &&
      paymentCallbackDto.success
    ) {
      return {
        orderId: order.orderId,
        provider: normalizedProvider,
        transactionRef: paymentCallbackDto.transactionRef,
        paymentStatus: existingTx.paymentStatus,
        message: 'already processed',
      };
    }

    // 2. AMOUNT MISMATCH GUARD — Không cho fake amount nhỏ hơn
    if (paymentCallbackDto.success) {
      const expectedAmount = Number(order.totalPayment);
      const reportedAmount = Number(paymentCallbackDto.amount);
      if (
        Number.isFinite(expectedAmount) &&
        Number.isFinite(reportedAmount) &&
        Math.abs(expectedAmount - reportedAmount) > 0.01
      ) {
        throw new BadRequestException(
          `Payment amount mismatch: expected ${expectedAmount}, got ${reportedAmount}`,
        );
      }
    }

    const paymentStatus = paymentCallbackDto.success
      ? PaymentStatus.PAID
      : PaymentStatus.FAILED;
    const reportedAmount = Number(paymentCallbackDto.amount);

    if (existingTx) {
      existingTx.transactionStatus = paymentCallbackDto.success
        ? PaymentTransactionStatus.SUCCESS
        : PaymentTransactionStatus.FAILED;
      existingTx.paymentStatus = paymentStatus;
      existingTx.gatewayCode = paymentCallbackDto.gatewayCode ?? null;
      existingTx.gatewayMessage = paymentCallbackDto.gatewayMessage ?? null;
      existingTx.rawPayload = paymentCallbackDto.rawPayload ?? null;
      await this.paymentTransactionsRepository.save(existingTx);
    } else {
      const transaction = this.paymentTransactionsRepository.create({
        orderId: order.orderId,
        userId: order.userId,
        provider: normalizedProvider,
        transactionRef: paymentCallbackDto.transactionRef,
        transactionStatus: paymentCallbackDto.success
          ? PaymentTransactionStatus.SUCCESS
          : PaymentTransactionStatus.FAILED,
        paymentStatus,
        amount: paymentCallbackDto.amount,
        gatewayCode: paymentCallbackDto.gatewayCode ?? null,
        gatewayMessage: paymentCallbackDto.gatewayMessage ?? null,
        rawPayload: paymentCallbackDto.rawPayload ?? null,
      });
      await this.paymentTransactionsRepository.save(transaction);
    }

    if (paymentCallbackDto.success && this.isTerminalOrderStatus(order.orderStatus)) {
      await this.createLatePaymentRefundIfNeeded({
        order,
        amount: reportedAmount,
        provider: normalizedProvider,
        transactionRef: paymentCallbackDto.transactionRef,
        note: `Unsigned/dev callback arrived after order was ${order.orderStatus}; queued for manual refund.`,
      });
      await this.notificationsService.sendPaymentNotification(
        order.userId,
        order.orderId,
        PaymentStatus.PARTIAL_REFUNDED,
        normalizedProvider,
      );
      return {
        orderId: order.orderId,
        provider: normalizedProvider,
        transactionRef: paymentCallbackDto.transactionRef,
        paymentStatus: order.paymentStatus,
        refundStatus: OrderRefundStatus.PENDING,
        message: 'late payment queued for manual refund',
      };
    }

    order.paymentStatus = paymentCallbackDto.success
      ? PaymentStatus.PAID
      : order.paymentStatus === PaymentStatus.PAID
        ? PaymentStatus.PAID
        : PaymentStatus.UNPAID;
    await this.ordersRepository.save(order);
    await this.notificationsService.sendPaymentNotification(
      order.userId,
      order.orderId,
      paymentStatus,
      normalizedProvider,
    );

    return {
      orderId: order.orderId,
      provider: normalizedProvider,
      transactionRef: paymentCallbackDto.transactionRef,
      paymentStatus,
    };
  }

  /**
   * Cron reconciliation — chạy mỗi 15 phút.
   * Tìm các đơn online (non-COD) đã PENDING + paymentStatus=UNPAID quá 30 phút
   * → Đối soát với gateway hoặc tự cancel để giải phóng stock.
   *
   * Hiện tại: KHÔNG gọi MoMo query API thật (cần endpoint /v2/gateway/api/query
   * + signature) — sẽ AUTO CANCEL đơn nếu quá 30 phút không thanh toán.
   * Stock sẽ được restock thông qua updateOrderStatus → CANCELLED.
   */
  @Cron('*/15 * * * *') // mỗi 15 phút
  async reconcileStalePayments() {
    try {
      const cutoff = new Date(Date.now() - this.stalePaymentTtlMs);
      const stale = await this.ordersRepository.find({
        where: {
          orderStatus: In([OrderStatus.PENDING, OrderStatus.BACKORDERED]),
          paymentStatus: In([PaymentStatus.UNPAID, PaymentStatus.FAILED]),
          paymentMethod: In([
            PaymentMethod.MOMO,
            PaymentMethod.VNPAY,
            PaymentMethod.ZALOPAY,
            PaymentMethod.BANK_TRANSFER,
            PaymentMethod.PAYPAL,
          ]),
          createdAt: LessThan(cutoff),
        },
        take: 100, // batch nhỏ để tránh nghẽn DB
      });

      if (stale.length === 0) return;

      this.logger.log(
        `[reconcileStalePayments] Found ${stale.length} stale unpaid orders`,
      );

      for (const order of stale) {
        try {
          // Kiểm tra có PaymentTransaction SUCCESS chưa (case race condition)
          const succeeded = await this.paymentTransactionsRepository.findOne({
            where: {
              orderId: order.orderId,
              transactionStatus: PaymentTransactionStatus.SUCCESS,
            },
          });
          if (succeeded) {
            order.paymentStatus = PaymentStatus.PAID;
            await this.ordersRepository.save(order);
            continue;
          }

          // Auto-cancel + restock (hoàn batch theo lịch sử consumption)
          await this.ordersRepository.manager.transaction(async (em) => {
            const oldStatus = order.orderStatus;
            const items = await em.find(OrderItemEntity, {
              where: { orderId: order.orderId },
            });
            for (const item of items) {
              const netRaw = await em
                .createQueryBuilder(InventoryTransactionEntity, 'tx')
                .select('COALESCE(SUM(tx.quantity_change), 0)', 'net')
                .where('tx.related_order_id = :orderId', {
                  orderId: order.orderId,
                })
                .andWhere('tx.product_id = :productId', {
                  productId: item.productId,
                })
                .andWhere('tx.transaction_type IN (:...types)', {
                  types: [
                    InventoryTransactionType.EXPORT,
                    InventoryTransactionType.RETURN_IN,
                  ],
                })
                .getRawOne<{ net: string }>();
              const restockQty = Math.min(
                item.quantity,
                Math.max(0, -Number(netRaw?.net ?? 0)),
              );
              if (restockQty <= 0) {
                continue;
              }

              const product = await em.findOne(ProductEntity, {
                where: { productId: item.productId },
                lock: { mode: 'pessimistic_write' },
              });
              if (product) {
                product.quantityAvailable += restockQty;
                product.quantityReserved = Math.max(
                  0,
                  (product.quantityReserved ?? 0) - restockQty,
                );
                await em.save(ProductEntity, product);
              }

              // Hoàn batch nếu có lịch sử consumption với batchId, đồng thời log RETURN_IN
              const netMap = await this.batchService.getOrderBatchConsumption(
                em,
                order.orderId,
                item.productId,
              );
              if (netMap.size > 0) {
                let remaining = restockQty;
                const sorted = Array.from(netMap.entries())
                  .filter(([_, n]) => n > 0)
                  .sort((a, b) => b[1] - a[1]);
                for (const [batchId, net] of sorted) {
                  if (remaining <= 0) break;
                  const restore = Math.min(net, remaining);
                  await this.batchService.restoreInTx(em, batchId, restore);
                  await em.save(
                    InventoryTransactionEntity,
                    em.create(InventoryTransactionEntity, {
                      productId: item.productId,
                      performedBy: null,
                      transactionType: InventoryTransactionType.RETURN_IN,
                      quantityChange: restore,
                      referenceType: 'ORDER',
                      referenceId: order.orderId,
                      batchId,
                      note: 'Tự động hủy do quá hạn thanh toán 30 phút',
                      relatedOrderId: order.orderId,
                    }),
                  );
                  remaining -= restore;
                }
              } else {
                // Legacy fallback: không có batch info → log txn không có batchId
                await em.save(
                  InventoryTransactionEntity,
                  em.create(InventoryTransactionEntity, {
                    productId: item.productId,
                    performedBy: null,
                    transactionType: InventoryTransactionType.RETURN_IN,
                    quantityChange: restockQty,
                    referenceType: 'ORDER',
                    referenceId: order.orderId,
                    note: 'Tự động hủy do quá hạn thanh toán 30 phút',
                    relatedOrderId: order.orderId,
                  }),
                );
              }
            }
            order.orderStatus = OrderStatus.CANCELLED;
            order.paymentStatus = PaymentStatus.FAILED;
            await em.save(OrderEntity, order);
            await em.save(
              OrderStatusHistoryEntity,
              em.create(OrderStatusHistoryEntity, {
                orderId: order.orderId,
                oldStatus,
                newStatus: OrderStatus.CANCELLED,
                changedBy: null,
                note: 'Tự động hủy do quá hạn thanh toán 30 phút',
              }),
            );
          });
          this.logger.log(
            `[reconcileStalePayments] Cancelled order ${order.orderId}`,
          );
        } catch (err) {
          this.logger.error(
            `[reconcileStalePayments] Failed for order ${order.orderId}`,
            err instanceof Error ? err.stack : String(err),
          );
        }
      }
    } catch (err) {
      this.logger.error(
        '[reconcileStalePayments] Top-level error',
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  async findPaymentTransactions(currentUser: IUser, orderId: string) {
    await this.ensureUserExists(currentUser._id);
    const order = this.hasManageOrdersPermission(currentUser)
      ? await this.findAnyOrder(orderId)
      : await this.findOwnedOrder(currentUser._id, orderId);

    const items = await this.paymentTransactionsRepository.find({
      where: { orderId: order.orderId },
      order: { createdAt: 'DESC' },
    });

    return items.map((item) => ({
      id: item.paymentTransactionId,
      orderId: item.orderId,
      provider: item.provider,
      transactionRef: item.transactionRef,
      transactionStatus: item.transactionStatus,
      paymentStatus: item.paymentStatus,
      amount: item.amount,
      gatewayCode: item.gatewayCode,
      gatewayMessage: item.gatewayMessage,
      rawPayload: item.rawPayload,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    }));
  }

  async findAllPaymentTransactions(params: {
    page: number;
    limit: number;
    provider?: string;
    status?: string;
  }) {
    const { page, limit, provider, status } = params;
    const skip = (page - 1) * limit;

    const query = this.paymentTransactionsRepository.createQueryBuilder('pt');
    if (provider) query.andWhere('pt.provider = :provider', { provider });
    if (status) query.andWhere('pt.transactionStatus = :status', { status });
    query.orderBy('pt.createdAt', 'DESC').skip(skip).take(limit);

    const [items, total] = await query.getManyAndCount();

    // Fetch user info in bulk
    const userIds = [...new Set(items.map((i) => i.userId))];
    const users = userIds.length > 0
      ? await this.usersRepository.createQueryBuilder('u').select(['u.userId', 'u.username', 'u.email']).whereInIds(userIds).getMany()
      : [];
    const userMap = new Map(users.map((u) => [u.userId, u]));

    return {
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
      items: items.map((i) => ({
        id: i.paymentTransactionId,
        orderId: i.orderId,
        provider: i.provider,
        transactionRef: i.transactionRef,
        transactionStatus: i.transactionStatus,
        paymentStatus: i.paymentStatus,
        amount: i.amount,
        gatewayCode: i.gatewayCode,
        gatewayMessage: i.gatewayMessage,
        createdAt: i.createdAt,
        user: userMap.get(i.userId) ? {
          username: userMap.get(i.userId)!.username,
          email: userMap.get(i.userId)!.email,
        } : null,
      })),
    };
  }

  private async getCompletedRefundAmount(
    orderId: string,
    refundRepository = this.orderRefundsRepository,
  ) {
    const completed = await refundRepository.find({
      where: { orderId, refundStatus: OrderRefundStatus.COMPLETED },
    });

    return completed.reduce((sum, item) => sum + Number(item.amount ?? 0), 0);
  }

  private assertCancelablePaidRefundOrder(order: OrderEntity) {
    const cancelable = this.isValidAdminStatusTransition(
      order.orderStatus,
      OrderStatus.CANCELLED,
    );
    const hasCollectedPayment = [
      PaymentStatus.PAID,
      PaymentStatus.PARTIAL_REFUNDED,
    ].includes(order.paymentStatus);

    if (!cancelable || !hasCollectedPayment) {
      throw new BadRequestException({
        message:
          'Đơn không đủ điều kiện tạo hoàn tiền hủy đơn đã thu tiền.',
        error: 'CANCEL_PAID_REFUND_ORDER_NOT_ELIGIBLE',
      });
    }
  }

  private mapAdminRefund(
    refund: OrderRefundEntity,
    order?: OrderEntity,
    user?: UserEntity,
  ) {
    return {
      refundId: refund.refundId,
      orderId: refund.orderId,
      returnId: refund.returnId,
      reason: refund.reason,
      amount: refund.amount,
      refundStatus: refund.refundStatus,
      paymentProvider: refund.paymentProvider,
      manualReference: refund.manualReference,
      createdBy: refund.createdBy,
      note: refund.note,
      createdAt: refund.createdAt,
      updatedAt: refund.updatedAt,
      order: order
        ? {
            id: order.orderId,
            status: order.orderStatus,
            paymentMethod: order.paymentMethod,
            paymentStatus: order.paymentStatus,
            totalPayment: order.totalPayment,
            fullName: order.fullName,
            phone: order.phone,
          }
        : null,
      user: user
        ? {
            username: user.username,
            email: user.email,
          }
        : null,
    };
  }

  async findAdminRefunds(params: {
    page: number;
    limit: number;
    status?: string;
    reason?: string;
    orderId?: string;
  }) {
    const { page, limit, status, reason, orderId } = params;
    const query = this.orderRefundsRepository
      .createQueryBuilder('refund')
      .orderBy('refund.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (status) {
      query.andWhere('refund.refundStatus = :status', { status });
    }
    if (reason) {
      query.andWhere('refund.reason = :reason', { reason });
    }
    if (orderId) {
      query.andWhere('refund.orderId LIKE :orderId', {
        orderId: `%${orderId.trim()}%`,
      });
    }

    const [items, total] = await query.getManyAndCount();
    const orderIds = [...new Set(items.map((item) => item.orderId))];
    const orders = orderIds.length
      ? await this.ordersRepository.find({ where: { orderId: In(orderIds) } })
      : [];
    const orderMap = new Map(orders.map((order) => [order.orderId, order]));
    const userIds = [...new Set(orders.map((order) => order.userId))];
    const users = userIds.length
      ? await this.usersRepository.find({ where: { userId: In(userIds) } })
      : [];
    const userMap = new Map(users.map((user) => [user.userId, user]));

    return {
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      items: items.map((item) => {
        const order = orderMap.get(item.orderId);
        return this.mapAdminRefund(
          item,
          order,
          order ? userMap.get(order.userId) : undefined,
        );
      }),
    };
  }

  async createCancelPaidOrderRefund(
    currentUser: IUser,
    dto: CreateCancelPaidRefundDto,
  ) {
    await this.ensureUserExists(currentUser._id);
    const order = await this.findAnyOrder(dto.orderId);
    this.assertCancelablePaidRefundOrder(order);

    const duplicate = await this.orderRefundsRepository.findOne({
      where: {
        orderId: order.orderId,
        reason: OrderRefundReason.CANCEL_PAID_ORDER,
        refundStatus: In([
          OrderRefundStatus.PENDING,
          OrderRefundStatus.APPROVED,
        ]),
      },
    });
    if (duplicate) {
      throw new ConflictException({
        message: 'Đơn đã có hoàn tiền hủy đơn đang xử lý.',
        error: 'CANCEL_PAID_REFUND_ALREADY_OPEN',
      });
    }

    const completedRefundAmount = await this.getCompletedRefundAmount(
      order.orderId,
    );
    const remainingRefundable = Math.max(
      0,
      Number(order.totalPayment) - completedRefundAmount,
    );
    const amount =
      dto.amount !== undefined ? Number(dto.amount) : remainingRefundable;
    if (
      !Number.isFinite(amount) ||
      amount <= 0 ||
      amount > remainingRefundable
    ) {
      throw new BadRequestException({
        message: `Số tiền hoàn không hợp lệ. Còn có thể hoàn ${remainingRefundable.toFixed(2)}.`,
        error: 'REFUND_AMOUNT_EXCEEDS_REMAINING',
      });
    }

    const created = this.orderRefundsRepository.create({
      orderId: order.orderId,
      returnId: null,
      reason: OrderRefundReason.CANCEL_PAID_ORDER,
      amount: amount.toFixed(2),
      refundStatus: OrderRefundStatus.PENDING,
      paymentProvider: order.paymentMethod,
      manualReference: null,
      createdBy: currentUser._id,
      note: dto.note?.trim() || 'Chờ hoàn tiền trước khi hủy đơn đã thu tiền',
    });
    const saved = await this.orderRefundsRepository.save(created);

    return this.mapAdminRefund(saved, order);
  }

  async updateAdminRefundStatus(
    currentUser: IUser,
    refundId: string,
    dto: UpdateOrderRefundStatusDto,
  ) {
    await this.ensureUserExists(currentUser._id);
    const updated = await this.orderRefundsRepository.manager.transaction(
      async (entityManager) => {
        const refund = await entityManager.findOne(OrderRefundEntity, {
          where: { refundId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!refund) {
          throw new NotFoundException('Refund not found');
        }

        const transitions: Record<OrderRefundStatus, OrderRefundStatus[]> = {
          [OrderRefundStatus.PENDING]: [
            OrderRefundStatus.APPROVED,
            OrderRefundStatus.COMPLETED,
            OrderRefundStatus.FAILED,
          ],
          [OrderRefundStatus.APPROVED]: [
            OrderRefundStatus.COMPLETED,
            OrderRefundStatus.FAILED,
          ],
          [OrderRefundStatus.COMPLETED]: [],
          [OrderRefundStatus.FAILED]: [],
        };
        const statusChanged = refund.refundStatus !== dto.status;
        if (
          statusChanged &&
          !transitions[refund.refundStatus].includes(dto.status)
        ) {
          throw new BadRequestException('Invalid refund status transition');
        }

        const nextManualReference =
          dto.manualReference?.trim() || refund.manualReference;
        const nextNote = dto.note?.trim() || refund.note;
        if (
          dto.status === OrderRefundStatus.COMPLETED &&
          !nextManualReference &&
          !nextNote
        ) {
          throw new BadRequestException({
            message:
              'Hoàn tiền thủ công cần mã chứng từ hoặc ghi chú đối soát.',
            error: 'REFUND_COMPLETION_REFERENCE_REQUIRED',
          });
        }

        refund.manualReference = nextManualReference;
        refund.note = nextNote;
        refund.refundStatus = dto.status;

        const order = await entityManager.findOne(OrderEntity, {
          where: { orderId: refund.orderId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!order) {
          throw new NotFoundException('Order not found');
        }

        if (statusChanged && dto.status === OrderRefundStatus.COMPLETED) {
          const alreadyCompleted = await entityManager.find(OrderRefundEntity, {
            where: {
              orderId: order.orderId,
              refundStatus: OrderRefundStatus.COMPLETED,
            },
          });
          const completedBefore = alreadyCompleted.reduce(
            (sum, item) =>
              item.refundId === refund.refundId
                ? sum
                : sum + Number(item.amount ?? 0),
            0,
          );
          if (completedBefore + Number(refund.amount) > Number(order.totalPayment)) {
            throw new BadRequestException({
              message: 'Số tiền hoàn vượt số tiền còn có thể hoàn của đơn.',
              error: 'REFUND_AMOUNT_EXCEEDS_REMAINING',
            });
          }
        }

        if (
          statusChanged &&
          dto.status === OrderRefundStatus.COMPLETED &&
          refund.reason === OrderRefundReason.CANCEL_PAID_ORDER
        ) {
          this.assertCancelablePaidRefundOrder(order);

          const productsRepository =
            entityManager.getRepository(ProductEntity);
          const orderItemsRepository =
            entityManager.getRepository(OrderItemEntity);

          await this.restockOrderItems(
            order.orderId,
            productsRepository,
            orderItemsRepository,
            entityManager,
          );
          await this.revertDiscountUsage(
            order,
            entityManager.getRepository(DiscountEntity),
            entityManager.getRepository(CouponUsageEntity),
          );

          const previousStatus = order.orderStatus;
          order.orderStatus = OrderStatus.CANCELLED;
          await entityManager.save(OrderStatusHistoryEntity, {
            orderId: order.orderId,
            oldStatus: previousStatus,
            newStatus: OrderStatus.CANCELLED,
            changedBy: currentUser._id,
            note:
              dto.note?.trim() ||
              'Đã hoàn tiền thủ công và hủy đơn đã thu tiền',
          });
        }

        await entityManager.save(OrderRefundEntity, refund);

        if (statusChanged && dto.status === OrderRefundStatus.COMPLETED) {
          const completedRefunds = await entityManager.find(
            OrderRefundEntity,
            {
              where: {
                orderId: order.orderId,
                refundStatus: OrderRefundStatus.COMPLETED,
              },
            },
          );
          const completedAmount = completedRefunds.reduce(
            (sum, item) => sum + Number(item.amount ?? 0),
            0,
          );
          order.paymentStatus =
            completedAmount >= Number(order.totalPayment)
              ? PaymentStatus.REFUNDED
              : PaymentStatus.PARTIAL_REFUNDED;
        }

        await entityManager.save(OrderEntity, order);
        return { refund, order };
      },
    );

    if (
      updated.refund.reason === OrderRefundReason.CANCEL_PAID_ORDER &&
      updated.refund.refundStatus === OrderRefundStatus.COMPLETED
    ) {
      await this.notificationsService.sendOrderStatusNotification(
        updated.order.userId,
        updated.order.orderId,
        OrderStatus.CANCELLED,
      );
    }

    return this.mapAdminRefund(updated.refund, updated.order);
  }

  async createReturn(userId: string, createReturnDto: CreateReturnDto) {
    await this.ensureUserExists(userId);
    const order = await this.findOwnedOrder(userId, createReturnDto.orderId);

    // Cho phép tạo return ở các status:
    //  - SHIPPING: client báo "nhận thiếu" (short_delivery) trước khi confirm
    //  - DELIVERED / PARTIAL_DELIVERED / PARTIAL_RETURNED: trả hàng bình thường sau khi đã nhận
    const allowedStatuses: OrderStatus[] = [
      OrderStatus.SHIPPING,
      OrderStatus.DELIVERED,
      OrderStatus.PARTIAL_DELIVERED,
      OrderStatus.PARTIAL_RETURNED,
    ];
    if (!allowedStatuses.includes(order.orderStatus)) {
      throw new BadRequestException(
        `Không thể tạo yêu cầu trả ở trạng thái ${order.orderStatus}. Chỉ chấp nhận: ${allowedStatuses.join(', ')}.`,
      );
    }

    // Nếu order đang SHIPPING → bắt buộc reason là short_delivery để phân biệt rõ
    if (
      order.orderStatus === OrderStatus.SHIPPING &&
      createReturnDto.reason !== 'short_delivery'
    ) {
      throw new BadRequestException(
        'Đơn đang giao chỉ chấp nhận lý do "short_delivery" (báo nhận thiếu).',
      );
    }

    const returnWindow = await this.getOrderReturnWindow(order);
    if (
      order.orderStatus !== OrderStatus.SHIPPING &&
      !returnWindow.canCreateReturn
    ) {
      throw new BadRequestException(
        returnWindow.returnBlockedReason ?? 'RETURN_WINDOW_EXPIRED',
      );
    }
    const orderItem = await this.orderItemsRepository.findOneBy({
      orderItemId: createReturnDto.orderItemId,
      orderId: order.orderId,
    });
    if (!orderItem) {
      throw new NotFoundException('Order item not found');
    }

    const alreadyReturnedQuantity = await this.getReservedReturnQuantity(
      orderItem.orderItemId,
    );
    const returnableQuantityBase = this.getReturnableQuantityBase(
      order,
      orderItem,
    );
    const remainingReturnableQuantity =
      returnableQuantityBase - alreadyReturnedQuantity;
    if (
      createReturnDto.returnQuantity <= 0 ||
      createReturnDto.returnQuantity > remainingReturnableQuantity
    ) {
      throw new BadRequestException(
        `Số lượng trả không hợp lệ. Còn có thể trả ${Math.max(0, remainingReturnableQuantity)}/${orderItem.quantity}.`,
      );
    }

    // Chỉ block nếu đã có return ĐANG MỞ (OPEN) cho item này.
    // REJECTED hoặc REFUNDED → cho phép tạo mới (có thể bị từ chối oan, hoặc trả thêm).
    const openStatuses: ReturnStatus[] = [
      ReturnStatus.REQUESTED,
      ReturnStatus.APPROVED,
      ReturnStatus.RECEIVED,
      ReturnStatus.INSPECTED,
    ];
    const openReturn = await this.returnsRepository.findOne({
      where: openStatuses.map((s) => ({
        userId,
        orderItemId: createReturnDto.orderItemId,
        returnStatus: s,
      })),
    });
    if (openReturn) {
      throw new BadRequestException(
        `Đã có yêu cầu trả hàng đang xử lý (${openReturn.returnStatus}). Đợi xử lý xong trước khi tạo mới.`,
      );
    }

    const created = this.returnsRepository.create({
      orderId: order.orderId,
      orderItemId: createReturnDto.orderItemId,
      returnQuantity: createReturnDto.returnQuantity,
      userId,
      reason: createReturnDto.reason,
      description: createReturnDto.description ?? null,
      returnStatus: ReturnStatus.REQUESTED,
      refundAmount: null,
    });

    const saved = await this.returnsRepository.save(created);
    await this.notificationsService.createNotification({
      userId,
      title: 'Yêu cầu trả hàng đã được tạo',
      message: `Yêu cầu trả hàng cho đơn #${order.orderId.slice(0, 8).toUpperCase()} đã được tiếp nhận.`,
      metadata: {
        returnId: saved.returnId,
        orderId: order.orderId,
        type: 'return_status_changed',
        targetUrl: `/client/returns?returnId=${saved.returnId}`,
        statusLabel: this.getReturnStatusLabel(saved.returnStatus),
      },
    });

    return {
      ...saved,
      statusLabel: this.getReturnStatusLabel(saved.returnStatus),
      returnWindowDays: returnWindow.returnWindowDays,
      returnDeadline: returnWindow.returnDeadline,
      canCreateReturn: returnWindow.canCreateReturn,
      returnBlockedReason: returnWindow.returnBlockedReason,
      maxRefundableAmount: this.getRefundableAmountForQuantity(
        orderItem,
        saved.returnQuantity,
      ).toFixed(2),
      alreadyReturnedQuantity,
      remainingReturnableQuantity:
        remainingReturnableQuantity - saved.returnQuantity,
    };
  }

  async findMyReturns(
    userId: string,
    query: {
      page?: number;
      limit?: number;
      search?: string;
      status?: string;
      from?: string;
      to?: string;
    } = {},
  ) {
    await this.ensureUserExists(userId);
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 10));
    const normalizedSearch = query.search?.trim().toLowerCase();
    const items = await this.returnsRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });

    const orderItemIds = [...new Set(items.map((item) => item.orderItemId))];
    const orderIds = [...new Set(items.map((item) => item.orderId))];
    const [orderItems, orders] = await Promise.all([
      orderItemIds.length
        ? this.orderItemsRepository.find({
            where: { orderItemId: In(orderItemIds) },
          })
        : Promise.resolve([]),
      orderIds.length
        ? this.ordersRepository.find({ where: { orderId: In(orderIds) } })
        : Promise.resolve([]),
    ]);
    const itemById = new Map(
      orderItems.map((orderItem) => [orderItem.orderItemId, orderItem]),
    );
    const orderById = new Map(orders.map((order) => [order.orderId, order]));

    const enriched = await Promise.all(
      items.map(async (item) => {
        const order = orderById.get(item.orderId);
        const windowInfo = order
          ? await this.getOrderReturnWindow(order)
          : {
              returnWindowDays: RETURN_WINDOW_DAYS,
              deliveredAt: null,
              returnDeadline: null,
              canCreateReturn: false,
              returnBlockedReason: null,
            };
        const orderItem = itemById.get(item.orderItemId);
        return {
          id: item.returnId,
          returnId: item.returnId,
          orderId: item.orderId,
          orderItemId: item.orderItemId,
          productId: orderItem?.productId ?? null,
          productName: orderItem?.productName ?? null,
          imageUrl: null,
          returnQuantity: item.returnQuantity,
          reason: item.reason,
          reasonLabel: this.getReturnReasonLabel(item.reason),
          description: item.description,
          status: item.returnStatus,
          statusLabel: this.getReturnStatusLabel(item.returnStatus),
          inspectionStatus: item.inspectionStatus,
          inspectionStatusLabel: this.getReturnInspectionStatusLabel(
            item.inspectionStatus,
          ),
          refundAmount: item.refundAmount,
          returnDeadline: windowInfo.returnDeadline,
          returnWindowDays: windowInfo.returnWindowDays,
          canCreateReturn: windowInfo.canCreateReturn,
          returnBlockedReason: windowInfo.returnBlockedReason,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        };
      }),
    );

    const fromTime = query.from ? new Date(query.from).getTime() : null;
    const toTime = query.to ? new Date(query.to).getTime() : null;
    const filtered = enriched.filter((item) => {
      if (query.status && query.status !== 'all' && item.status !== query.status) {
        return false;
      }
      const createdTime = new Date(item.createdAt).getTime();
      if (fromTime && createdTime < fromTime) return false;
      if (toTime && createdTime > toTime + 24 * 60 * 60 * 1000 - 1) return false;
      if (normalizedSearch) {
        const haystack = [
          item.returnId,
          item.orderId,
          item.productName,
          item.reason,
          item.reasonLabel,
          item.description,
          item.statusLabel,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(normalizedSearch)) return false;
      }
      return true;
    });
    const total = filtered.length;
    return {
      items: filtered.slice((page - 1) * limit, page * limit),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  private formatGatewayDate(value = new Date()) {
    const pad = (input: number) => String(input).padStart(2, '0');
    return [
      value.getFullYear(),
      pad(value.getMonth() + 1),
      pad(value.getDate()),
      pad(value.getHours()),
      pad(value.getMinutes()),
      pad(value.getSeconds()),
    ].join('');
  }

  private buildZaloPayTransactionRef() {
    const now = new Date();
    const shortDate = this.formatGatewayDate(now).slice(2, 8);
    return `${shortDate}_${Date.now()}_${randomUUID().slice(0, 6)}`;
  }

  async findAllReturns() {
    const items = await this.returnsRepository.find({
      order: { createdAt: 'DESC' },
    });

    const orderItemIds = [...new Set(items.map((item) => item.orderItemId))];
    const orderIds = [...new Set(items.map((item) => item.orderId))];
    const userIds = [...new Set(items.map((item) => item.userId).filter(Boolean))];

    const [orderItems, orders, users] = await Promise.all([
      orderItemIds.length
        ? this.orderItemsRepository.find({ where: { orderItemId: In(orderItemIds) } })
        : Promise.resolve([]),
      orderIds.length
        ? this.ordersRepository.find({ where: { orderId: In(orderIds) } })
        : Promise.resolve([]),
      userIds.length
        ? this.usersRepository.find({ where: { userId: In(userIds) } })
        : Promise.resolve([]),
    ]);

    const itemById = new Map(
      orderItems.map((orderItem) => [orderItem.orderItemId, orderItem]),
    );
    const orderById = new Map(orders.map((order) => [order.orderId, order]));
    const userById = new Map(users.map((user) => [user.userId, user]));
    const productIds = [
      ...new Set(orderItems.map((orderItem) => orderItem.productId).filter(Boolean)),
    ];
    const productImages = productIds.length
      ? await this.productImagesRepository.find({
          where: { productId: In(productIds) },
          order: { isPrimary: 'DESC', sortOrder: 'ASC', createdAt: 'ASC' },
        })
      : [];
    const imageByProductId = new Map<string, string>();
    for (const image of productImages) {
      if (!imageByProductId.has(image.productId)) {
        imageByProductId.set(image.productId, image.imageUrl);
      }
    }

    return items.map((item) => {
      const orderItem = itemById.get(item.orderItemId);
      const order = orderById.get(item.orderId);
      const user = userById.get(item.userId);
      return {
        returnId: item.returnId,
        orderId: item.orderId,
        orderCode: order ? order.orderId.slice(0, 8).toUpperCase() : null,
        userId: item.userId,
        customerName: order?.fullName ?? user?.fullName ?? user?.username ?? null,
        customerEmail: user?.email ?? null,
        customerPhone: order?.phone ?? user?.phoneNumber ?? null,
        orderItemId: item.orderItemId,
        productId: orderItem?.productId ?? null,
        productName: orderItem?.productName ?? null,
        productImageUrl: orderItem?.productId
          ? imageByProductId.get(orderItem.productId) ?? null
          : null,
        orderedQuantity: orderItem?.quantity ?? null,
        deliveredQuantity: orderItem?.quantityDelivered ?? null,
        returnQuantity: item.returnQuantity,
        reason: item.reason,
        reasonLabel: this.getReturnReasonLabel(item.reason),
        description: item.description,
        returnStatus: item.returnStatus,
        statusLabel: this.getReturnStatusLabel(item.returnStatus),
        inspectionStatus: item.inspectionStatus,
        inspectionStatusLabel: this.getReturnInspectionStatusLabel(item.inspectionStatus),
        inspectionNote: item.inspectionNote,
        inspectedBy: item.inspectedBy,
        inspectedAt: item.inspectedAt,
        refundAmount: item.refundAmount,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      };
    });
  }

  async updateReturnStatus(
    currentUser: IUser,
    returnId: string,
    updateReturnStatusDto: UpdateReturnStatusDto,
  ) {
    await this.ensureUserExists(currentUser._id);
    const returnRequest = await this.returnsRepository.findOneBy({ returnId });
    if (!returnRequest) {
      throw new NotFoundException('Return request not found');
    }

    if (
      returnRequest.returnStatus !== updateReturnStatusDto.status &&
      !this.validateReturnStatusTransition(
        returnRequest.returnStatus,
        updateReturnStatusDto.status,
      )
    ) {
      throw new BadRequestException('Invalid return status transition');
    }

    const orderItem = await this.orderItemsRepository.findOneBy({
      orderItemId: returnRequest.orderItemId,
    });
    if (!orderItem) {
      throw new NotFoundException('Order item not found');
    }

    if (updateReturnStatusDto.status === ReturnStatus.RECEIVED) {
      // RECEIVED: chỉ đánh dấu đã nhận, KHÔNG tự restock.
      // Hàng phải qua inspection (admin gọi PATCH /returns/:id/inspect)
      // để quyết định nhập kho / báo hỏng / trả NCC.
      returnRequest.inspectionStatus = ReturnInspectionStatus.PENDING;
    }

    returnRequest.returnStatus = updateReturnStatusDto.status;
    if (updateReturnStatusDto.status === ReturnStatus.REFUNDED) {
      if (returnRequest.inspectionStatus === ReturnInspectionStatus.PENDING) {
        throw new BadRequestException(
          'Return đã nhận vật lý phải inspect trước khi hoàn tiền.',
        );
      }

      const maxRefundableAmount = this.getRefundableAmountForQuantity(
        orderItem,
        returnRequest.returnQuantity,
      );
      const requestedRefundAmount =
        updateReturnStatusDto.refundAmount !== undefined
          ? Number(updateReturnStatusDto.refundAmount)
          : maxRefundableAmount;
      if (
        !Number.isFinite(requestedRefundAmount) ||
        requestedRefundAmount < 0 ||
        requestedRefundAmount > maxRefundableAmount
      ) {
        throw new BadRequestException(
          `Số tiền hoàn không hợp lệ. Tối đa ${maxRefundableAmount.toFixed(2)}.`,
        );
      }
      returnRequest.refundAmount = requestedRefundAmount.toFixed(2);

      // PHẢI lưu return trước khi tính tổng — vì query bên dưới sẽ đọc lại từ DB
      await this.returnsRepository.save(returnRequest);

      const order = await this.findAnyOrder(returnRequest.orderId);
      const orderItems = await this.orderItemsRepository.findBy({
        orderId: order.orderId,
      });
      const refundedReturns = await this.returnsRepository.find({
        where: { orderId: order.orderId, returnStatus: ReturnStatus.REFUNDED },
      });

      const refundedQuantityByLine = new Map<string, number>();
      for (const refundedReturn of refundedReturns) {
        refundedQuantityByLine.set(
          refundedReturn.orderItemId,
          (refundedQuantityByLine.get(refundedReturn.orderItemId) ?? 0) +
            Number(refundedReturn.returnQuantity ?? 0),
        );
      }
      const allRefunded = orderItems.every(
        (it) =>
          (refundedQuantityByLine.get(it.orderItemId) ?? 0) >=
          this.getReturnableQuantityBase(order, it),
      );

      const existingRefund = await this.orderRefundsRepository.findOne({
        where: {
          returnId: returnRequest.returnId,
          reason: OrderRefundReason.RETURN,
        },
      });
      if (!existingRefund) {
        await this.orderRefundsRepository.save(
          this.orderRefundsRepository.create({
            orderId: order.orderId,
            returnId: returnRequest.returnId,
            reason: OrderRefundReason.RETURN,
            amount: returnRequest.refundAmount,
            refundStatus: OrderRefundStatus.COMPLETED,
            paymentProvider: order.paymentMethod,
            manualReference: null,
            createdBy: currentUser._id,
            note:
              updateReturnStatusDto.note ??
              `Refund return ${returnRequest.returnId}`,
          }),
        );
      }

      // FIX HIGH: nếu là CREDIT order → trừ refundAmount khỏi currentDebt
      const refundAmt = Number(returnRequest.refundAmount ?? 0);
      if (
        !existingRefund &&
        order.paymentMethod === PaymentMethod.CREDIT &&
        refundAmt > 0
      ) {
        await this.creditLimitRepository
          .createQueryBuilder()
          .update()
          .set({ currentDebt: () => `GREATEST(0, current_debt - ${refundAmt})` })
          .where('user_id = :uid', { uid: order.userId })
          .execute();
      }

      if (allRefunded) {
        // Tất cả item đã được hoàn → full return
        order.orderStatus = OrderStatus.RETURNED;
        order.paymentStatus =
          order.paymentStatus === PaymentStatus.PAID ||
          order.paymentStatus === PaymentStatus.PARTIAL_REFUNDED
            ? PaymentStatus.REFUNDED
            : PaymentStatus.FAILED;
      } else {
        // Chỉ refund 1 phần → đánh dấu partial
        order.orderStatus = OrderStatus.PARTIAL_RETURNED;
        if (order.paymentStatus === PaymentStatus.PAID) {
          order.paymentStatus = PaymentStatus.PARTIAL_REFUNDED;
        }
      }
      await this.ordersRepository.save(order);

      // FIX HIGH: trigger membership recalc — totalSpent giờ phải trừ refund
      void this.membershipService.recalculateAndReward(returnRequest.userId);

      // Trả về saved bản return (đã save trên dòng trên rồi)
      await this.notificationsService.createNotification({
        userId: returnRequest.userId,
        title: 'Yêu cầu trả hàng đã cập nhật',
        message: `Yêu cầu trả hàng #${returnRequest.returnId} đã chuyển sang "${this.getReturnStatusLabel(returnRequest.returnStatus)}".`,
        metadata: {
          returnId: returnRequest.returnId,
          status: returnRequest.returnStatus,
          orderId: returnRequest.orderId,
          type: 'return_status_changed',
          targetUrl: `/client/returns?returnId=${returnRequest.returnId}`,
          statusLabel: this.getReturnStatusLabel(returnRequest.returnStatus),
        },
      });
      return returnRequest;
    }

    const savedReturn = await this.returnsRepository.save(returnRequest);
    await this.notificationsService.createNotification({
      userId: savedReturn.userId,
      title: 'Yêu cầu trả hàng đã cập nhật',
      message: `Yêu cầu trả hàng #${savedReturn.returnId} đã chuyển sang "${this.getReturnStatusLabel(savedReturn.returnStatus)}".`,
      metadata: {
        returnId: savedReturn.returnId,
        status: savedReturn.returnStatus,
        orderId: savedReturn.orderId,
        type: 'return_status_changed',
        targetUrl: `/client/returns?returnId=${savedReturn.returnId}`,
        statusLabel: this.getReturnStatusLabel(savedReturn.returnStatus),
      },
    });

    return savedReturn;
  }

  /**
   * Admin xác nhận giao một phần (partial delivery).
   * Khách mua 10 → giao thực tế 6 → các bước:
   *   1. Cập nhật order_items.quantity_delivered cho từng line
   *   2. Phần chưa giao (4 cái) → cộng lại quantityAvailable, giảm reserved
   *   3. Tạo inventory_transaction RETURN_IN cho phần thiếu
   *   4. Giảm reserved cho phần đã giao (như delivered bình thường)
   *   5. Đặt status = PARTIAL_DELIVERED nếu còn thiếu, DELIVERED nếu đủ
   *   6. Tính lại totalPayment theo phần đã giao thực tế
   *
   * Phải gọi từ status SHIPPING (chỉ giao được khi đang ship).
   */
  async partialDeliverOrder(
    currentUser: IUser,
    orderId: string,
    items: { orderItemId: string; deliveredQty: number }[],
    note?: string,
  ) {
    await this.ensureUserExists(currentUser._id);
    const order = await this.findAnyOrder(orderId);

    if (order.orderStatus !== OrderStatus.SHIPPING) {
      throw new BadRequestException(
        'Partial delivery chỉ thực hiện khi đơn đang SHIPPING',
      );
    }

    const orderItems = await this.orderItemsRepository.find({
      where: { orderId: order.orderId },
    });
    const itemMap = new Map(orderItems.map((it) => [it.orderItemId, it]));

    if (items.length !== orderItems.length) {
      throw new BadRequestException(
        'Partial delivery phải gửi đủ toàn bộ dòng sản phẩm của đơn.',
      );
    }

    const submittedItemIds = new Set(items.map((item) => item.orderItemId));
    if (submittedItemIds.size !== items.length) {
      throw new BadRequestException(
        'Partial delivery không được gửi trùng dòng sản phẩm.',
      );
    }

    for (const orderItem of orderItems) {
      if (!submittedItemIds.has(orderItem.orderItemId)) {
        throw new BadRequestException(
          `Thiếu số lượng giao cho dòng ${orderItem.productName}.`,
        );
      }
    }

    // Validate: deliveredQty không được vượt qty đặt.
    for (const dto of items) {
      const oi = itemMap.get(dto.orderItemId);
      if (!oi) {
        throw new BadRequestException(
          `Order item ${dto.orderItemId} không thuộc đơn này`,
        );
      }
      if (dto.deliveredQty > oi.quantity) {
        throw new BadRequestException(
          `Số lượng giao (${dto.deliveredQty}) không thể vượt số đặt (${oi.quantity}) của ${oi.productName}`,
        );
      }
      if (dto.deliveredQty < 0) {
        throw new BadRequestException('deliveredQty không được âm');
      }
    }

    let totalDeliveredQty = 0;
    let totalOrderedQty = 0;
    let newSubtotal = 0;
    let newDiscountAmount = 0;
    const previousTotalPayment = Number(order.totalPayment);

    await withDeadlockRetry(() =>
      this.ordersRepository.manager.transaction(async (em) => {
        for (const dto of items) {
          const oi = itemMap.get(dto.orderItemId)!;
          const undeliveredQty = oi.quantity - dto.deliveredQty;
          totalDeliveredQty += dto.deliveredQty;
          totalOrderedQty += oi.quantity;
          const deliveredShare = oi.quantity > 0 ? dto.deliveredQty / oi.quantity : 0;
          newSubtotal += this.getOrderItemGrossAmount(oi) * deliveredShare;
          newDiscountAmount += Number(oi.discountAllocated ?? 0) * deliveredShare;

          oi.quantityDelivered = dto.deliveredQty;
          await em.save(OrderItemEntity, oi);

          // Phần đã giao: giảm reserved (hàng đã rời kho thật)
          // Phần KHÔNG giao: cộng lại quantityAvailable + giảm reserved
          if (oi.quantity > 0) {
            const product = await em.findOne(ProductEntity, {
              where: { productId: oi.productId },
              lock: { mode: 'pessimistic_write' },
            });
            if (!product) continue;

            const releaseReserved = oi.quantity; // toàn bộ qty của line
            product.quantityReserved = Math.max(
              0,
              (product.quantityReserved ?? 0) - releaseReserved,
            );
            // Cộng lại phần thiếu vào available + hoàn batch
            if (undeliveredQty > 0) {
              const qtyBefore = product.quantityAvailable;
              product.quantityAvailable += undeliveredQty;
              await em.save(ProductEntity, product);

              const netMap = await this.batchService.getOrderBatchConsumption(
                em,
                order.orderId,
                product.productId,
              );
              if (netMap.size > 0) {
                let remaining = undeliveredQty;
                const sorted = Array.from(netMap.entries())
                  .filter(([_, n]) => n > 0)
                  .sort((a, b) => b[1] - a[1]);
                for (const [batchId, net] of sorted) {
                  if (remaining <= 0) break;
                  const restore = Math.min(net, remaining);
                  await this.batchService.restoreInTx(em, batchId, restore);
                  await em.save(
                    InventoryTransactionEntity,
                    em.create(InventoryTransactionEntity, {
                      productId: product.productId,
                      performedBy: currentUser._id,
                      transactionType: InventoryTransactionType.RETURN_IN,
                      quantityChange: restore,
                      referenceType: 'ORDER',
                      referenceId: order.orderId,
                      batchId,
                      unitCostAtTime: product.avgCost ?? null,
                      note: `Partial delivery: ${dto.deliveredQty}/${oi.quantity} delivered, ${restore} restocked to batch`,
                      relatedOrderId: order.orderId,
                    }),
                  );
                  remaining -= restore;
                }
              } else {
                // Legacy fallback
                await em.save(
                  InventoryTransactionEntity,
                  em.create(InventoryTransactionEntity, {
                    productId: product.productId,
                    performedBy: currentUser._id,
                    transactionType: InventoryTransactionType.RETURN_IN,
                    quantityChange: undeliveredQty,
                    quantityBefore: qtyBefore,
                    quantityAfter: product.quantityAvailable,
                    referenceType: 'ORDER',
                    referenceId: order.orderId,
                    unitCostAtTime: product.avgCost ?? null,
                    note: `Partial delivery: ${dto.deliveredQty}/${oi.quantity} delivered, ${undeliveredQty} restocked (legacy)`,
                    relatedOrderId: order.orderId,
                  }),
                );
              }
              await this.syncDefaultWarehouseStock(
                em,
                product.productId,
                undeliveredQty,
              );
            } else {
              await em.save(ProductEntity, product);
            }
          }
        }

        if (totalDeliveredQty <= 0) {
          throw new BadRequestException(
            'Partial delivery cần có ít nhất một sản phẩm được giao.',
          );
        }

        // Cập nhật order: status + total
        const isFullyDelivered = totalDeliveredQty === totalOrderedQty;
        order.orderStatus = isFullyDelivered
          ? OrderStatus.DELIVERED
          : OrderStatus.PARTIAL_DELIVERED;
        order.totalQuantity = totalDeliveredQty;
        // Recalc totalPayment = gross delivered - allocated discount + delivery.
        const newTotalPayment =
          newSubtotal -
          newDiscountAmount +
          Number(order.deliveryCost);
        const shortDeliveryAdjustment = Math.max(
          0,
          previousTotalPayment - Math.max(0, newTotalPayment),
        );
        order.subtotalAmount = this.toMoney(newSubtotal);
        order.discountAmount = this.toMoney(newDiscountAmount);
        order.totalPayment = Math.max(0, newTotalPayment).toFixed(2);

        // COD thu theo phần giao thực tế, bao gồm trường hợp giao một phần.
        if (order.paymentMethod === PaymentMethod.COD) {
          order.paymentStatus = PaymentStatus.PAID;
        }

        if (
          shortDeliveryAdjustment > 0 &&
          order.paymentMethod === PaymentMethod.CREDIT
        ) {
          await em
            .getRepository(CustomerCreditLimitEntity)
            .createQueryBuilder()
            .update()
            .set({
              currentDebt: () =>
                `GREATEST(0, current_debt - ${shortDeliveryAdjustment})`,
            })
            .where('user_id = :uid', { uid: order.userId })
            .execute();
        }

        if (
          shortDeliveryAdjustment > 0 &&
          order.paymentStatus === PaymentStatus.PAID &&
          this.isOnlinePaymentMethod(order.paymentMethod)
        ) {
          await em.save(
            OrderRefundEntity,
            em.create(OrderRefundEntity, {
              orderId: order.orderId,
              returnId: null,
              reason: OrderRefundReason.SHORT_DELIVERY,
              amount: this.toMoney(shortDeliveryAdjustment),
              refundStatus: OrderRefundStatus.PENDING,
              paymentProvider: order.paymentMethod,
              manualReference: null,
              createdBy: currentUser._id,
              note: `Short delivery adjustment ${totalDeliveredQty}/${totalOrderedQty}`,
            }),
          );
        }

        await em.save(OrderEntity, order);
        await em.save(
          OrderStatusHistoryEntity,
          em.create(OrderStatusHistoryEntity, {
            orderId: order.orderId,
            oldStatus: OrderStatus.SHIPPING,
            newStatus: order.orderStatus,
            changedBy: currentUser._id,
            note:
              note ??
              `Partial delivery: ${totalDeliveredQty}/${totalOrderedQty}; adjustment ${this.toMoney(shortDeliveryAdjustment)}`,
          }),
        );
      }),
    );

    await this.notificationsService.sendOrderStatusNotification(
      order.userId,
      order.orderId,
      order.orderStatus,
    );

    // FIX: giao 1 phần làm thay đổi totalPayment (giảm theo phần thực giao)
    // → phải recalc membership để totalSpent + tier đúng.
    void this.membershipService.recalculateAndReward(order.userId);

    return this.findAnyOrder(order.orderId);
  }

  /**
   * Admin kiểm tra hàng trả về và quyết định:
   *   USABLE             → nhập lại kho chính
   *   DAMAGED            → ghi DAMAGE adjustment, KHÔNG nhập kho (loss)
   *   RETURN_TO_SUPPLIER → đánh dấu để admin tạo Supplier Return riêng
   *
   * Chỉ chạy được khi return đã RECEIVED + inspectionStatus = PENDING.
   */
  async inspectReturn(
    currentUser: IUser,
    returnId: string,
    decision: ReturnInspectionStatus,
    note?: string,
  ) {
    await this.ensureUserExists(currentUser._id);
    if (decision === ReturnInspectionStatus.PENDING) {
      throw new BadRequestException('Decision không thể là PENDING');
    }

    const returnRequest = await this.returnsRepository.findOneBy({ returnId });
    if (!returnRequest) {
      throw new NotFoundException('Return request not found');
    }
    if (returnRequest.returnStatus !== ReturnStatus.RECEIVED) {
      throw new BadRequestException(
        'Chỉ có thể inspect return đã RECEIVED',
      );
    }
    if (returnRequest.inspectionStatus !== ReturnInspectionStatus.PENDING) {
      throw new BadRequestException(
        `Return này đã được inspect (${returnRequest.inspectionStatus})`,
      );
    }

    const orderItem = await this.orderItemsRepository.findOneBy({
      orderItemId: returnRequest.orderItemId,
    });
    if (!orderItem) throw new NotFoundException('Order item not found');

    await this.ordersRepository.manager.transaction(async (em) => {
      const product = await em.findOne(ProductEntity, {
        where: { productId: orderItem.productId },
        lock: { mode: 'pessimistic_write' },
      });

      if (decision === ReturnInspectionStatus.USABLE && product) {
        // Nhập lại kho chính
        const qtyBefore = product.quantityAvailable;
        product.quantityAvailable += returnRequest.returnQuantity;
        await em.save(ProductEntity, product);

        // FIX CRITICAL: hoàn batch theo NET consumption history.
        // Lúc checkout consumed từ batch A 3 + batch B 2 → restock cũng phải vào
        // chính các batch đó, KHÔNG được chỉ cộng quantityAvailable.
        const netMap = await this.batchService.getOrderBatchConsumption(
          em,
          returnRequest.orderId,
          product.productId,
        );
        if (netMap.size > 0) {
          let remaining = returnRequest.returnQuantity;
          const sorted = Array.from(netMap.entries())
            .filter(([_, n]) => n > 0)
            .sort((a, b) => b[1] - a[1]);
          let runningBefore = qtyBefore;
          for (const [batchId, net] of sorted) {
            if (remaining <= 0) break;
            const restore = Math.min(net, remaining);
            await this.batchService.restoreInTx(em, batchId, restore);
            await em.save(
              InventoryTransactionEntity,
              em.create(InventoryTransactionEntity, {
                productId: product.productId,
                performedBy: currentUser._id,
                transactionType: InventoryTransactionType.RETURN_IN,
                quantityChange: restore,
                quantityBefore: runningBefore,
                quantityAfter: runningBefore + restore,
                referenceType: 'RETURN',
                referenceId: String(returnRequest.returnId),
                batchId,
                unitCostAtTime: product.avgCost ?? null,
                note: note ?? `Return inspection: USABLE — restocked ${restore} to batch`,
                relatedOrderId: returnRequest.orderId,
              }),
            );
            runningBefore += restore;
            remaining -= restore;
          }
          // Nếu còn remaining > 0 (lệch do partial-deliver hoặc legacy txn không có batch_id)
          // → tạo "return batch" mới với unit_cost = avgCost để giữ tổng đúng.
          if (remaining > 0) {
            await this.batchService.createInTx(em, {
              productId: product.productId,
              grId: null,
              batchCode: `RETURN-${returnRequest.returnId}`,
              mfgDate: null,
              expDate: product.expiredAt ?? null,
              qtyReceived: remaining,
              unitCost: Number(product.avgCost ?? 0),
              note: `Return restock — không khớp batch history, tạo batch mới`,
            });
          }
        } else {
          // Legacy order không có batch info → tạo "return batch" mới
          await this.batchService.createInTx(em, {
            productId: product.productId,
            grId: null,
            batchCode: `RETURN-${returnRequest.returnId}`,
            mfgDate: null,
            expDate: product.expiredAt ?? null,
            qtyReceived: returnRequest.returnQuantity,
            unitCost: Number(product.avgCost ?? 0),
            note: `Return restock (legacy) — orderItem ${orderItem.orderItemId}`,
          });
          await em.save(
            InventoryTransactionEntity,
            em.create(InventoryTransactionEntity, {
              productId: product.productId,
              performedBy: currentUser._id,
              transactionType: InventoryTransactionType.RETURN_IN,
              quantityChange: returnRequest.returnQuantity,
              quantityBefore: qtyBefore,
              quantityAfter: product.quantityAvailable,
              referenceType: 'RETURN',
              referenceId: String(returnRequest.returnId),
              unitCostAtTime: product.avgCost ?? null,
              note: note ?? 'Return inspection: USABLE — restocked (new batch)',
              relatedOrderId: returnRequest.orderId,
            }),
          );
        }
        await this.syncDefaultWarehouseStock(
          em,
          product.productId,
          returnRequest.returnQuantity,
        );
      } else if (decision === ReturnInspectionStatus.DAMAGED && product) {
        // Hỏng — KHÔNG nhập kho. Ghi DAMAGE inventory_transaction (loss).
        await em.save(
          InventoryTransactionEntity,
          em.create(InventoryTransactionEntity, {
            productId: product.productId,
            performedBy: currentUser._id,
            transactionType: InventoryTransactionType.DAMAGE,
            quantityChange: 0, // không thay đổi tồn (vì chưa nhập)
            quantityBefore: product.quantityAvailable,
            quantityAfter: product.quantityAvailable,
            referenceType: 'RETURN',
            referenceId: String(returnRequest.returnId),
            unitCostAtTime: product.avgCost ?? null,
            note: note ?? `Return inspection: DAMAGED — written off ${returnRequest.returnQuantity} unit(s)`,
            relatedOrderId: returnRequest.orderId,
          }),
        );
      }
      // RETURN_TO_SUPPLIER: không động vào kho. Admin sẽ tạo Supplier Return riêng.

      returnRequest.inspectionStatus = decision;
      returnRequest.inspectionNote = note ?? null;
      returnRequest.inspectedBy = currentUser._id;
      returnRequest.inspectedAt = new Date();
      returnRequest.returnStatus = ReturnStatus.INSPECTED;
      await em.save(ReturnEntity, returnRequest);
    });

    return this.returnsRepository.findOneBy({ returnId });
  }

  /**
   * Admin xác nhận thanh toán thủ công cho đơn non-COD (BANK_TRANSFER, online chưa tự ghi nhận).
   */
  async confirmPayment(currentUser: IUser, orderId: string) {
    await this.ensureUserExists(currentUser._id);
    const order = await this.findAnyOrder(orderId);

    this.assertOrderCanAcceptPayment(order);

    if (order.paymentStatus === PaymentStatus.PAID) {
      throw new BadRequestException('Đơn hàng đã được thanh toán');
    }
    if (order.paymentMethod === PaymentMethod.COD) {
      throw new BadRequestException('COD tự động ghi nhận khi giao — không cần xác nhận thủ công');
    }
    if (order.paymentMethod === PaymentMethod.CREDIT) {
      throw new BadRequestException('Đơn hàng mua nợ — công nợ được quản lý riêng qua hạn mức tín dụng');
    }

    const existingRefund = await this.orderRefundsRepository.findOne({
      where: {
        orderId: order.orderId,
        refundStatus: In([
          OrderRefundStatus.PENDING,
          OrderRefundStatus.APPROVED,
          OrderRefundStatus.COMPLETED,
        ]),
      },
    });
    if (existingRefund) {
      throw new BadRequestException({
        message:
          'Order already has refund/reconciliation records. Payment confirmation must be handled manually.',
        error: 'PAYMENT_CONFIRMATION_BLOCKED_BY_REFUND_LEDGER',
      });
    }

    order.paymentStatus = PaymentStatus.PAID;
    await this.ordersRepository.save(order);

    const tx = this.paymentTransactionsRepository.create({
      orderId: order.orderId,
      userId: order.userId,
      provider: order.paymentMethod,
      transactionRef: `manual-${Date.now()}`,
      transactionStatus: PaymentTransactionStatus.SUCCESS,
      paymentStatus: PaymentStatus.PAID,
      amount: order.totalPayment,
      gatewayCode: 'MANUAL',
      gatewayMessage: `Xác nhận thủ công bởi admin ${currentUser._id}`,
      rawPayload: { confirmedBy: currentUser._id, confirmedAt: new Date().toISOString() },
    });
    await this.paymentTransactionsRepository.save(tx);

    await this.notificationsService.sendPaymentNotification(
      order.userId,
      orderId,
      PaymentStatus.PAID,
      order.paymentMethod,
    );

    return this.buildOrderDetail(await this.findAnyOrder(orderId));
  }

  /**
   * Khách hàng xác nhận đã nhận hàng (khi đơn đang SHIPPING).
   * Chuyển → DELIVERED + giải phóng reserved + COD tự PAID.
   */
  async confirmReceivedByCustomer(currentUser: IUser, orderId: string) {
    await this.ensureUserExists(currentUser._id);
    const order = await this.findOrderDetail(currentUser, orderId);

    if (order.status !== OrderStatus.SHIPPING) {
      throw new BadRequestException('Chỉ có thể xác nhận nhận hàng khi đơn đang được giao');
    }

    await this.ordersRepository.manager.transaction(async (em) => {
      const transactionalProductsRepo = em.getRepository(ProductEntity);
      const transactionalOrderItemsRepo = em.getRepository(OrderItemEntity);

      await this.releaseReservedOnDelivered(
        orderId,
        transactionalProductsRepo,
        transactionalOrderItemsRepo,
      );

      const dbOrder = await em.getRepository(OrderEntity).findOneBy({ orderId });
      if (!dbOrder) return;

      dbOrder.orderStatus = OrderStatus.DELIVERED;
      if (dbOrder.paymentMethod === PaymentMethod.COD) {
        dbOrder.paymentStatus = PaymentStatus.PAID;
      }

      await em.save(OrderEntity, dbOrder);
      await em.save(
        OrderStatusHistoryEntity,
        em.create(OrderStatusHistoryEntity, {
          orderId,
          oldStatus: OrderStatus.SHIPPING,
          newStatus: OrderStatus.DELIVERED,
          changedBy: currentUser._id,
          note: 'Khách hàng xác nhận đã nhận hàng',
        }),
      );
    });

    const updated = await this.findAnyOrder(orderId);
    await this.notificationsService.sendOrderStatusNotification(
      updated.userId,
      orderId,
      OrderStatus.DELIVERED,
    );

    if (updated.userId) {
      void this.membershipService.recalculateAndReward(updated.userId);
    }

    return this.buildOrderDetail(updated);
  }
}

