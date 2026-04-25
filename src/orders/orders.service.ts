import { randomUUID } from 'node:crypto';
import { createHmac } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { WarehouseEntity } from '../warehouses/entities/warehouse.entity';
import { WarehouseStockEntity } from '../warehouses/entities/warehouse-stock.entity';
import { CartItemEntity } from '../carts/entities/cart-item.entity';
import { ShoppingCartEntity } from '../carts/entities/shopping-cart.entity';
import { DiscountCategoryEntity } from '../discounts/entities/discount-category.entity';
import {
  DiscountApplyTarget,
  DiscountEntity,
  DiscountType,
} from '../discounts/entities/discount.entity';
import { CouponUsageEntity } from '../discounts/entities/coupon-usage.entity';
import { DiscountProductEntity } from '../discounts/entities/discount-product.entity';
import {
  InventoryTransactionEntity,
  InventoryTransactionType,
} from '../products/entities/inventory-transaction.entity';
import { ProductEntity } from '../products/entities/product.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../settings/settings.service';
import type { IUser } from '../users/users.interface';
import { UserEntity } from '../users/entities/user.entity';
import { withDeadlockRetry } from '../common/transaction.util';
import { CreateReturnDto } from './dto/create-return.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { InitiatePaymentDto } from './dto/initiate-payment.dto';
import { PaymentCallbackDto } from './dto/payment-callback.dto';
import { QueryOrdersDto } from './dto/query-orders.dto';
import { UpdateOrderTrackingLiveDto } from './dto/update-order-tracking-live.dto';
import { UpdateOrderTrackingManualDto } from './dto/update-order-tracking-manual.dto';
import { UpdateOrderTrackingModeDto } from './dto/update-order-tracking-mode.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { UpdateReturnStatusDto } from './dto/update-return-status.dto';
import { DeliveryMethodEntity } from './entities/delivery-method.entity';
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
  PaymentTransactionEntity,
  PaymentTransactionStatus,
} from './entities/payment-transaction.entity';
import { ReturnEntity, ReturnStatus } from './entities/return.entity';
import { ShippingAddressEntity } from './entities/shipping-address.entity';

@Injectable()
export class OrdersService {
  private readonly liveTrackingFreshnessMs = 2 * 60 * 1000;

  constructor(
    @InjectRepository(DeliveryMethodEntity)
    private readonly deliveryMethodsRepository: Repository<DeliveryMethodEntity>,
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
    @InjectRepository(PaymentTransactionEntity)
    private readonly paymentTransactionsRepository: Repository<PaymentTransactionEntity>,
    private readonly notificationsService: NotificationsService,
    private readonly settingsService: SettingsService,
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

  private async ensurePaymentMethodEnabled(method: PaymentMethod) {
    if (method === PaymentMethod.PAYPAL) {
      throw new BadRequestException('Payment method is not supported');
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
      [ReturnStatus.RECEIVED]: [ReturnStatus.REFUNDED],
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

  private calculateDeliveryCost(
    deliveryMethod: DeliveryMethodEntity,
    subtotalAmount: number,
  ) {
    const minOrderAmount = Number(deliveryMethod.minOrderAmount);
    if (subtotalAmount >= minOrderAmount) {
      return 0;
    }

    return Number(deliveryMethod.basePrice);
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

  private async validateDiscountForCheckout(
    userId: string,
    discountCode: string | undefined,
    subtotalAmount: number,
    cartItems: CartItemEntity[],
    productsById: Map<string, ProductEntity>,
  ) {
    if (!discountCode) {
      return null;
    }

    const discount = await this.discountsRepository.findOneBy({
      discountCode: discountCode.trim(),
    });

    if (!discount || !discount.isActive) {
      throw new NotFoundException('Discount code not found');
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
      const categoryMappings = await this.discountCategoriesRepository.find({
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

        return sum + Number(item.priceAtAdded) * item.quantity;
      }, 0);
    }

    if (discount.appliesTo === DiscountApplyTarget.PRODUCT) {
      const productMappings = await this.discountProductsRepository.find({
        where: { discountId: discount.discountId },
      });
      const productIds = new Set(productMappings.map((item) => item.productId));
      eligibleSubtotal = cartItems.reduce((sum, item) => {
        if (!productIds.has(item.productId)) {
          return sum;
        }

        return sum + Number(item.priceAtAdded) * item.quantity;
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

    const existingUsage = await this.couponUsageRepository.findOneBy({
      discountId: discount.discountId,
      userId,
    });

    if (existingUsage) {
      throw new BadRequestException('You have already used this discount code');
    }

    return {
      discount,
      eligibleSubtotal,
    };
  }

  private async buildOrderDetail(order: OrderEntity) {
    const [items, history] = await Promise.all([
      this.orderItemsRepository.find({
        where: { orderId: order.orderId },
        order: { createdAt: 'ASC', orderItemId: 'ASC' },
      }),
      this.orderStatusHistoryRepository.find({
        where: { orderId: order.orderId },
        order: { createdAt: 'ASC', historyId: 'ASC' },
      }),
    ]);

    return {
      id: order.orderId,
      status: order.orderStatus,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      shippingAddressId: order.shippingAddressId,
      deliveryId: order.deliveryId,
      subtotalAmount: order.subtotalAmount,
      discountAmount: order.discountAmount,
      deliveryCost: order.deliveryCost,
      totalPayment: order.totalPayment,
      totalQuantity: order.totalQuantity,
      note: order.note,
      fullName: order.fullName,
      phone: order.phone,
      address: order.address,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      items: items.map((item) => ({
        id: item.orderItemId,
        productId: item.productId,
        productName: item.productName,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        lineTotal: item.lineTotal,
      })),
      history: history.map((entry) => ({
        id: entry.historyId,
        oldStatus: entry.oldStatus,
        newStatus: entry.newStatus,
        changedBy: entry.changedBy,
        note: entry.note,
        createdAt: entry.createdAt,
      })),
    };
  }

  private toOrderSummary(order: OrderEntity) {
    return {
      id: order.orderId,
      userId: order.userId,
      status: order.orderStatus,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      totalPayment: order.totalPayment,
      totalQuantity: order.totalQuantity,
      fullName: order.fullName,
      phone: order.phone,
      address: order.address,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    };
  }

  private isValidAdminStatusTransition(
    currentStatus: OrderStatus,
    nextStatus: OrderStatus,
  ) {
    const allowedTransitions: Record<OrderStatus, OrderStatus[]> = {
      [OrderStatus.BACKORDERED]: [OrderStatus.PENDING, OrderStatus.CANCELLED],
      [OrderStatus.PENDING]: [OrderStatus.CONFIRMED, OrderStatus.CANCELLED],
      [OrderStatus.CONFIRMED]: [OrderStatus.PROCESSING, OrderStatus.CANCELLED],
      [OrderStatus.PROCESSING]: [OrderStatus.SHIPPING, OrderStatus.CANCELLED],
      [OrderStatus.SHIPPING]: [OrderStatus.DELIVERED, OrderStatus.RETURNED],
      [OrderStatus.DELIVERED]: [OrderStatus.RETURNED],
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

  async createOrder(
    userId: string,
    createOrderDto: CreateOrderDto,
    idempotencyKey?: string,
  ) {
    await this.ensureUserExists(userId);
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
    const deliveryCost = this.calculateDeliveryCost(
      deliveryMethod,
      subtotalAmount,
    );
    const totalPayment = subtotalAmount - discountAmount + deliveryCost;
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
        const transactionalDiscountsRepository =
          entityManager.getRepository(DiscountEntity);
        const transactionalCouponUsageRepository =
          entityManager.getRepository(CouponUsageEntity);

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
          });
          await transactionalOrderItemsRepository.save(orderItem);

          // Backorder line: KHÔNG trừ stock, KHÔNG ghi inventory transaction
          // (sẽ xử lý sau khi nhập hàng về và admin fulfill)
          if (isLineBackorder) {
            continue;
          }

          const qtyBefore = product.quantityAvailable;
          product.quantityAvailable -= cartItem.quantity;
          product.quantityReserved =
            (product.quantityReserved ?? 0) + cartItem.quantity;
          await transactionalProductsRepository.save(product);

          const inventoryTransaction =
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
              note: 'Export by order checkout',
              relatedOrderId: orderId,
            });
          await transactionalInventoryTransactionsRepository.save(
            inventoryTransaction,
          );

          await this.syncDefaultWarehouseStock(
            entityManager,
            product.productId,
            -cartItem.quantity,
          );
        }

        if (discount) {
          discount.usedCount += 1;
          await transactionalDiscountsRepository.save(discount);

          const couponUsage = transactionalCouponUsageRepository.create({
            discountId: discount.discountId,
            userId,
            orderId,
          });
          await transactionalCouponUsageRepository.save(couponUsage);
        }

        const history = transactionalHistoryRepository.create({
          orderId,
          oldStatus: null,
          newStatus: isBackorder
            ? OrderStatus.BACKORDERED
            : OrderStatus.PENDING,
          changedBy: userId,
          note: isBackorder
            ? 'Order created (backordered — chờ nhập kho)'
            : 'Order created',
        });
        await transactionalHistoryRepository.save(history);

        await transactionalCartItemsRepository.delete({ cartId: cart.cartId });
      }),
    );

    const createdOrder = await this.findOwnedOrder(userId, orderId);
    await this.notificationsService.sendOrderCreatedNotification(
      userId,
      orderId,
    );
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

      const items = await transactionalOrderItemsRepository.find({
        where: { orderId: order.orderId },
      });
      await this.restockOrderItems(
        order.orderId,
        transactionalProductsRepository,
        transactionalOrderItemsRepository,
        entityManager,
      );

      for (const item of items) {
        const product = await transactionalProductsRepository.findOneBy({
          productId: item.productId,
        });
        const inventoryTransaction =
          transactionalInventoryTransactionsRepository.create({
            productId: item.productId,
            performedBy: userId,
            transactionType: InventoryTransactionType.RETURN_IN,
            quantityChange: item.quantity,
            quantityBefore: product
              ? product.quantityAvailable - item.quantity
              : null,
            quantityAfter: product ? product.quantityAvailable : null,
            referenceType: 'ORDER',
            referenceId: order.orderId,
            unitCostAtTime: product?.avgCost ?? null,
            note: 'Restock by order cancellation',
            relatedOrderId: order.orderId,
          });
        await transactionalInventoryTransactionsRepository.save(
          inventoryTransaction,
        );
      }

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
        note: 'Order cancelled by user',
      });
      await transactionalHistoryRepository.save(history);
    });

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
    const nextStatus = updateOrderStatusDto.status;

    if (previousStatus === nextStatus) {
      return this.buildOrderDetail(order);
    }

    if (
      [OrderStatus.DELIVERED, OrderStatus.RETURNED].includes(previousStatus)
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
          product.quantityAvailable -= item.quantity;
          product.quantityReserved =
            (product.quantityReserved ?? 0) + item.quantity;
          await transactionalProductsRepository.save(product);

          const tx = transactionalInventoryTransactionsRepository.create({
            productId: item.productId,
            performedBy: currentUser._id,
            transactionType: InventoryTransactionType.EXPORT,
            quantityChange: -item.quantity,
            quantityBefore: qtyBefore,
            quantityAfter: product.quantityAvailable,
            referenceType: 'ORDER',
            referenceId: order.orderId,
            unitCostAtTime: product.avgCost ?? null,
            note: 'Export by backorder fulfillment',
            relatedOrderId: order.orderId,
          });
          await transactionalInventoryTransactionsRepository.save(tx);
          await this.syncDefaultWarehouseStock(
            entityManager,
            item.productId,
            -item.quantity,
          );
        }
      }

      if (
        nextStatus === OrderStatus.CANCELLED ||
        nextStatus === OrderStatus.RETURNED
      ) {
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
            note: updateOrderStatusDto.note ?? 'Backorder cancelled',
          });
          await transactionalHistoryRepository.save(history);
          return;
        }

        const items = await transactionalOrderItemsRepository.find({
          where: { orderId: order.orderId },
        });

        await this.restockOrderItems(
          order.orderId,
          transactionalProductsRepository,
          transactionalOrderItemsRepository,
          entityManager,
        );

        for (const item of items) {
          const product = await transactionalProductsRepository.findOneBy({
            productId: item.productId,
          });
          const inventoryTransaction =
            transactionalInventoryTransactionsRepository.create({
              productId: item.productId,
              performedBy: currentUser._id,
              transactionType: InventoryTransactionType.RETURN_IN,
              quantityChange: item.quantity,
              quantityBefore: product
                ? product.quantityAvailable - item.quantity
                : null,
              quantityAfter: product ? product.quantityAvailable : null,
              referenceType: 'ORDER',
              referenceId: order.orderId,
              unitCostAtTime: product?.avgCost ?? null,
              note:
                nextStatus === OrderStatus.CANCELLED
                  ? 'Restock by admin cancellation'
                  : 'Restock by returned order',
              relatedOrderId: order.orderId,
            });
          await transactionalInventoryTransactionsRepository.save(
            inventoryTransaction,
          );
        }

        if (nextStatus === OrderStatus.CANCELLED) {
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

      if (nextStatus === OrderStatus.RETURNED) {
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
        note: updateOrderStatusDto.note ?? 'Order status updated by admin',
      });
      await transactionalHistoryRepository.save(history);
    });

    const updatedOrder = await this.findAnyOrder(orderId);
    await this.notificationsService.sendOrderStatusNotification(
      updatedOrder.userId,
      orderId,
      nextStatus,
    );
    return this.buildOrderDetail(updatedOrder);
  }

  async initiatePayment(
    currentUser: IUser,
    orderId: string,
    initiatePaymentDto: InitiatePaymentDto,
  ) {
    await this.ensureUserExists(currentUser._id);
    const order = await this.findOrderDetail(currentUser, orderId);

    if (!this.isOnlinePaymentMethod(order.paymentMethod)) {
      throw new BadRequestException('Order does not require online payment');
    }

    if (order.paymentStatus === PaymentStatus.PAID) {
      throw new BadRequestException('Order has already been paid');
    }

    const transactionRef = `${orderId}-${Date.now()}`;
    const paymentTransaction = this.paymentTransactionsRepository.create({
      orderId,
      userId: currentUser._id,
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

  async handleMomoIpn(body: Record<string, unknown>) {
    const { secretKey } = await this.settingsService.getMomoConfig();
    if (!secretKey) return { message: 'ignored' };

    console.log('[MoMo IPN] Received:', JSON.stringify(body));

    const { orderId: momoOrderId, requestId, amount, resultCode, transId, message: gwMessage } = body as {
      orderId?: string;
      requestId?: string;
      amount?: number;
      resultCode?: number;
      transId?: string;
      message?: string;
    };

    // momoOrderId = transactionRef (requestId) — look up the real order via transactions table
    const txRef = momoOrderId ?? requestId;
    if (!txRef) return { message: 'missing orderId' };

    const transaction = await this.paymentTransactionsRepository.findOne({
      where: { transactionRef: txRef },
    }).catch(() => null);

    const internalOrderId = transaction?.orderId;
    if (!internalOrderId) return { message: 'transaction not found' };

    const order = await this.ordersRepository.findOneBy({ orderId: internalOrderId }).catch(() => null);
    if (!order) return { message: 'order not found' };

    const success = resultCode === 0;
    const paymentStatus = success ? PaymentStatus.PAID : PaymentStatus.FAILED;

    // Update existing transaction status if found, or create a new one
    if (transaction) {
      transaction.transactionStatus = success ? PaymentTransactionStatus.SUCCESS : PaymentTransactionStatus.FAILED;
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
        transactionStatus: success ? PaymentTransactionStatus.SUCCESS : PaymentTransactionStatus.FAILED,
        paymentStatus,
        amount: String(amount ?? order.totalPayment),
        gatewayCode: String(resultCode ?? ''),
        gatewayMessage: (gwMessage as string) ?? null,
        rawPayload: body,
      });
      await this.paymentTransactionsRepository.save(newTx);
    }

    order.paymentStatus = paymentStatus;
    await this.ordersRepository.save(order);

    await this.notificationsService.sendPaymentNotification(
      order.userId,
      internalOrderId,
      paymentStatus,
      PaymentMethod.MOMO,
    );

    return { message: 'ok', transId };
  }

  async handlePaymentCallback(
    provider: string,
    paymentCallbackDto: PaymentCallbackDto,
  ) {
    const normalizedProvider = provider.toLowerCase() as PaymentMethod;
    const order = await this.findAnyOrder(paymentCallbackDto.orderId);

    if (order.paymentMethod !== normalizedProvider) {
      throw new BadRequestException('Payment provider does not match order');
    }

    const paymentStatus = paymentCallbackDto.success
      ? PaymentStatus.PAID
      : PaymentStatus.FAILED;

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

    order.paymentStatus = paymentStatus;
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

  async createReturn(userId: string, createReturnDto: CreateReturnDto) {
    await this.ensureUserExists(userId);
    const order = await this.findOwnedOrder(userId, createReturnDto.orderId);

    if (order.orderStatus !== OrderStatus.DELIVERED) {
      throw new BadRequestException('Only delivered orders can be returned');
    }

    const orderItem = await this.orderItemsRepository.findOneBy({
      orderItemId: createReturnDto.orderItemId,
      orderId: order.orderId,
    });
    if (!orderItem) {
      throw new NotFoundException('Order item not found');
    }

    const existingReturn = await this.returnsRepository.findOneBy({
      userId,
      orderItemId: createReturnDto.orderItemId,
    });
    if (existingReturn) {
      throw new BadRequestException('Return request already exists');
    }

    const created = this.returnsRepository.create({
      orderId: order.orderId,
      orderItemId: createReturnDto.orderItemId,
      userId,
      reason: createReturnDto.reason,
      description: createReturnDto.description ?? null,
      returnStatus: ReturnStatus.REQUESTED,
      refundAmount: null,
    });

    const saved = await this.returnsRepository.save(created);
    await this.notificationsService.createNotification({
      userId,
      title: 'Yeu cau tra hang da duoc tao',
      message: `Yeu cau tra hang cho don ${order.orderId} da duoc tiep nhan.`,
      metadata: { returnId: saved.returnId, orderId: order.orderId },
    });

    return saved;
  }

  async findMyReturns(userId: string) {
    await this.ensureUserExists(userId);
    const items = await this.returnsRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });

    return items.map((item) => ({
      id: item.returnId,
      orderId: item.orderId,
      orderItemId: item.orderItemId,
      reason: item.reason,
      description: item.description,
      status: item.returnStatus,
      refundAmount: item.refundAmount,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    }));
  }

  async findAllReturns() {
    const items = await this.returnsRepository.find({
      order: { createdAt: 'DESC' },
    });

    return items.map((item) => ({
      id: item.returnId,
      orderId: item.orderId,
      userId: item.userId,
      orderItemId: item.orderItemId,
      reason: item.reason,
      description: item.description,
      status: item.returnStatus,
      refundAmount: item.refundAmount,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    }));
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
      const product = await this.productsRepository.findOneBy({
        productId: orderItem.productId,
      });
      if (product) {
        await this.ordersRepository.manager.transaction(async (em) => {
          product.quantityAvailable += orderItem.quantity;
          await em.save(ProductEntity, product);

          await em.save(
            InventoryTransactionEntity,
            em.create(InventoryTransactionEntity, {
              productId: product.productId,
              performedBy: currentUser._id,
              transactionType: InventoryTransactionType.RETURN_IN,
              quantityChange: orderItem.quantity,
              note: updateReturnStatusDto.note ?? 'Return received by admin',
              relatedOrderId: returnRequest.orderId,
            }),
          );

          await this.syncDefaultWarehouseStock(
            em,
            product.productId,
            orderItem.quantity,
          );
        });
      }
    }

    returnRequest.returnStatus = updateReturnStatusDto.status;
    if (updateReturnStatusDto.status === ReturnStatus.REFUNDED) {
      returnRequest.refundAmount =
        updateReturnStatusDto.refundAmount ?? orderItem.lineTotal;
      const order = await this.findAnyOrder(returnRequest.orderId);
      order.orderStatus = OrderStatus.RETURNED;
      order.paymentStatus =
        order.paymentStatus === PaymentStatus.PAID
          ? PaymentStatus.REFUNDED
          : PaymentStatus.FAILED;
      await this.ordersRepository.save(order);
    }

    const savedReturn = await this.returnsRepository.save(returnRequest);
    await this.notificationsService.createNotification({
      userId: savedReturn.userId,
      title: 'Yeu cau tra hang da thay doi trang thai',
      message: `Yeu cau tra hang ${savedReturn.returnId} da chuyen sang ${savedReturn.returnStatus}.`,
      metadata: {
        returnId: savedReturn.returnId,
        status: savedReturn.returnStatus,
        orderId: savedReturn.orderId,
      },
    });

    return savedReturn;
  }
}
