import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CartItemEntity } from '../carts/entities/cart-item.entity';
import { ShoppingCartEntity } from '../carts/entities/shopping-cart.entity';
import { ProductEntity } from '../products/entities/product.entity';
import { UserEntity } from '../users/entities/user.entity';
import { CreateOrderDto } from './dto/create-order.dto';
import { DeliveryMethodEntity } from './entities/delivery-method.entity';
import { OrderItemEntity } from './entities/order-item.entity';
import {
  OrderEntity,
  OrderStatus,
  PaymentStatus,
} from './entities/order.entity';
import { OrderStatusHistoryEntity } from './entities/order-status-history.entity';
import { ShippingAddressEntity } from './entities/shipping-address.entity';

@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(DeliveryMethodEntity)
    private readonly deliveryMethodsRepository: Repository<DeliveryMethodEntity>,
    @InjectRepository(ShippingAddressEntity)
    private readonly shippingAddressesRepository: Repository<ShippingAddressEntity>,
    @InjectRepository(OrderEntity)
    private readonly ordersRepository: Repository<OrderEntity>,
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
    @InjectRepository(UserEntity)
    private readonly usersRepository: Repository<UserEntity>,
  ) {}

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

  async createOrder(userId: string, createOrderDto: CreateOrderDto) {
    await this.ensureUserExists(userId);

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

    for (const cartItem of cartItems) {
      const product = productsById.get(cartItem.productId);
      if (!product || !product.isShow) {
        throw new BadRequestException('One or more products are unavailable');
      }

      if (cartItem.quantity > product.quantityAvailable) {
        throw new BadRequestException('One or more cart items exceed stock');
      }

      subtotalAmount += Number(cartItem.priceAtAdded) * cartItem.quantity;
      totalQuantity += cartItem.quantity;
    }

    const discountAmount = 0;
    const deliveryCost = this.calculateDeliveryCost(
      deliveryMethod,
      subtotalAmount,
    );
    const totalPayment = subtotalAmount - discountAmount + deliveryCost;
    const addressSnapshot = this.buildAddressSnapshot(shippingAddress);
    const orderId = randomUUID();

    await this.ordersRepository.manager.transaction(async (entityManager) => {
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

      const order = transactionalOrdersRepository.create({
        orderId,
        userId,
        shippingAddressId: shippingAddress.shippingAddressId,
        deliveryId: deliveryMethod.deliveryId,
        discountId: null,
        orderStatus: OrderStatus.PENDING,
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
      });

      await transactionalOrdersRepository.save(order);

      for (const cartItem of cartItems) {
        const product = productsById.get(cartItem.productId);
        if (!product) {
          throw new BadRequestException('One or more products are unavailable');
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

        product.quantityAvailable -= cartItem.quantity;
        await transactionalProductsRepository.save(product);
        await transactionalOrderItemsRepository.save(orderItem);
      }

      const history = transactionalHistoryRepository.create({
        orderId,
        oldStatus: null,
        newStatus: OrderStatus.PENDING,
        changedBy: userId,
        note: 'Order created',
      });
      await transactionalHistoryRepository.save(history);

      await transactionalCartItemsRepository.delete({ cartId: cart.cartId });
    });

    const createdOrder = await this.findOwnedOrder(userId, orderId);
    return this.buildOrderDetail(createdOrder);
  }

  async findOrderDetail(userId: string, orderId: string) {
    await this.ensureUserExists(userId);
    const order = await this.findOwnedOrder(userId, orderId);
    return this.buildOrderDetail(order);
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

      const items = await transactionalOrderItemsRepository.find({
        where: { orderId: order.orderId },
      });

      for (const item of items) {
        const product = await transactionalProductsRepository.findOneBy({
          productId: item.productId,
        });

        if (product) {
          product.quantityAvailable += item.quantity;
          await transactionalProductsRepository.save(product);
        }
      }

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
    return this.buildOrderDetail(cancelledOrder);
  }
}
