import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { OrdersService } from './orders.service';
import {
  OrderEntity,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
} from './entities/order.entity';
import {
  OrderRefundEntity,
  OrderRefundReason,
  OrderRefundStatus,
} from './entities/order-refund.entity';
import { UserEntity, UserRole } from '../users/entities/user.entity';
import type { IUser } from '../users/users.interface';

type MockRepository = {
  findOne?: jest.Mock;
  findOneBy?: jest.Mock;
  find?: jest.Mock;
  findBy?: jest.Mock;
  save?: jest.Mock;
  create?: jest.Mock;
  delete?: jest.Mock;
  update?: jest.Mock;
  count?: jest.Mock;
  createQueryBuilder?: jest.Mock;
  manager?: {
    transaction: jest.Mock;
    query?: jest.Mock;
  };
};

type TransactionEntityTarget = { name: string };

const createRepositoryMock = (): MockRepository => ({
  findOne: jest.fn(),
  findOneBy: jest.fn(),
  find: jest.fn(),
  findBy: jest.fn(),
  save: jest.fn(),
  create: jest.fn(),
  delete: jest.fn(),
  update: jest.fn(),
  count: jest.fn(),
  createQueryBuilder: jest.fn(),
  manager: {
    transaction: jest.fn(),
    query: jest.fn().mockResolvedValue([{ provider: 'local' }]),
  },
});

describe('OrdersService', () => {
  let service: OrdersService;
  let deliveryMethodsRepository: MockRepository;
  let shippingAddressesRepository: MockRepository;
  let ordersRepository: MockRepository;
  let orderItemsRepository: MockRepository;
  let orderStatusHistoryRepository: MockRepository;
  let cartsRepository: MockRepository;
  let cartItemsRepository: MockRepository;
  let productsRepository: MockRepository;
  let inventoryTransactionsRepository: MockRepository;
  let usersRepository: MockRepository;
  let discountsRepository: MockRepository;
  let discountCategoriesRepository: MockRepository;
  let discountProductsRepository: MockRepository;
  let couponUsageRepository: MockRepository;
  let returnsRepository: MockRepository;
  let orderRefundsRepository: MockRepository;
  let paymentTransactionsRepository: MockRepository;
  let notificationsService: {
    sendOrderCreatedNotification: jest.Mock;
    sendOrderStatusNotification: jest.Mock;
    sendPaymentNotification: jest.Mock;
    createNotification: jest.Mock;
  };

  const now = new Date('2026-04-19T08:00:00.000Z');
  const userEntity: UserEntity = {
    userId: 'user-1',
    username: 'admin',
    email: 'admin@example.com',
    avatarUrl: null,
    role: UserRole.ADMIN,
    passwordHash: 'hash',
    provider: 'local',
    providerId: null,
    isActive: true,
    resetPasswordCode: null,
    resetPasswordExpiresAt: null,
    createdAt: now,
    updatedAt: now,
  };
  const adminUser: IUser = {
    _id: 'user-1',
    username: 'admin',
    email: 'admin@example.com',
    role: { _id: UserRole.ADMIN, name: UserRole.ADMIN },
    permissions: [
      {
        _id: 'perm-1',
        key: 'manage_orders',
        name: 'Manage Orders',
      },
    ],
  };

  beforeEach(() => {
    deliveryMethodsRepository = createRepositoryMock();
    shippingAddressesRepository = createRepositoryMock();
    ordersRepository = createRepositoryMock();
    orderItemsRepository = createRepositoryMock();
    orderStatusHistoryRepository = createRepositoryMock();
    cartsRepository = createRepositoryMock();
    cartItemsRepository = createRepositoryMock();
    productsRepository = createRepositoryMock();
    inventoryTransactionsRepository = createRepositoryMock();
    usersRepository = createRepositoryMock();
    discountsRepository = createRepositoryMock();
    discountCategoriesRepository = createRepositoryMock();
    discountProductsRepository = createRepositoryMock();
    couponUsageRepository = createRepositoryMock();
    returnsRepository = createRepositoryMock();
    orderRefundsRepository = createRepositoryMock();
    paymentTransactionsRepository = createRepositoryMock();
    notificationsService = {
      sendOrderCreatedNotification: jest.fn(),
      sendOrderStatusNotification: jest.fn(),
      sendPaymentNotification: jest.fn(),
      createNotification: jest.fn(),
    };

    service = new OrdersService(
      deliveryMethodsRepository as never,
      createRepositoryMock() as never,
      shippingAddressesRepository as never,
      ordersRepository as never,
      createRepositoryMock() as never,
      orderItemsRepository as never,
      orderStatusHistoryRepository as never,
      cartsRepository as never,
      cartItemsRepository as never,
      productsRepository as never,
      inventoryTransactionsRepository as never,
      usersRepository as never,
      discountsRepository as never,
      discountCategoriesRepository as never,
      discountProductsRepository as never,
      couponUsageRepository as never,
      returnsRepository as never,
      orderRefundsRepository as never,
      paymentTransactionsRepository as never,
      createRepositoryMock() as never,
      notificationsService as never,
      { emitNewOrder: jest.fn() } as never,
      { isPaymentMethodActive: jest.fn().mockResolvedValue(true) } as never,
      { recalculateAndReward: jest.fn() } as never,
      {} as never,
    );
  });

  it('rejects invalid admin status transitions', async () => {
    const order: OrderEntity = {
      orderId: 'order-1',
      userId: 'user-2',
      shippingAddressId: 'addr-1',
      deliveryId: '1',
      discountId: null,
      orderStatus: OrderStatus.PENDING,
      paymentMethod: PaymentMethod.COD,
      paymentStatus: PaymentStatus.UNPAID,
      subtotalAmount: '100000.00',
      discountAmount: '0.00',
      deliveryCost: '0.00',
      totalPayment: '100000.00',
      totalQuantity: 1,
      note: null,
      fullName: 'Alice',
      phone: '0900000000',
      address: '123 Nguyen Trai',
      idempotencyKey: null,
      createdAt: now,
      updatedAt: now,
    };

    usersRepository.findOneBy?.mockResolvedValue(userEntity);
    ordersRepository.findOneBy?.mockResolvedValue(order);

    await expect(
      service.updateOrderStatus(adminUser, order.orderId, {
        status: OrderStatus.DELIVERED,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('blocks customer cancellation after payment has been collected', async () => {
    const paidPendingOrder = {
      orderId: 'order-paid-1',
      userId: 'user-1',
      orderStatus: OrderStatus.PENDING,
      paymentMethod: PaymentMethod.MOMO,
      paymentStatus: PaymentStatus.PAID,
    } as OrderEntity;

    usersRepository.findOneBy?.mockResolvedValue(userEntity);
    ordersRepository.findOneBy?.mockResolvedValue(paidPendingOrder);

    await expect(
      service.cancelOrder(userEntity.userId, paidPendingOrder.orderId),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        error: 'PAID_ORDER_CANCEL_REQUIRES_REFUND',
      }),
    });
  });

  it('rejects a return quantity that exceeds the remaining order item quantity', async () => {
    const deliveredOrder = {
      orderId: 'order-return-1',
      userId: userEntity.userId,
      orderStatus: OrderStatus.DELIVERED,
    } as OrderEntity;
    const orderItem = {
      orderItemId: 'item-return-1',
      orderId: deliveredOrder.orderId,
      quantity: 5,
      lineTotal: '500000.00',
      grossLineTotal: '500000.00',
      discountAllocated: '0.00',
      netLineTotal: '500000.00',
    };

    usersRepository.findOneBy?.mockResolvedValue(userEntity);
    ordersRepository.findOneBy?.mockResolvedValue(deliveredOrder);
    orderItemsRepository.findOneBy?.mockResolvedValue(orderItem);
    returnsRepository.find?.mockResolvedValue([
      {
        returnId: 'return-existing-1',
        orderItemId: orderItem.orderItemId,
        returnQuantity: 4,
        returnStatus: 'approved',
      },
    ]);

    await expect(
      service.createReturn(userEntity.userId, {
        orderId: deliveredOrder.orderId,
        orderItemId: orderItem.orderItemId,
        returnQuantity: 2,
        reason: 'wrong_item',
        description: 'Tra them vuot so luong con lai',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(returnsRepository.create).not.toHaveBeenCalled();
    expect(returnsRepository.save).not.toHaveBeenCalled();
  });

  it('rejects partial delivery payloads that omit an order item line', async () => {
    const shippingOrder = {
      orderId: 'order-partial-1',
      userId: 'user-2',
      orderStatus: OrderStatus.SHIPPING,
    } as OrderEntity;

    usersRepository.findOneBy?.mockResolvedValue(userEntity);
    ordersRepository.findOneBy?.mockResolvedValue(shippingOrder);
    orderItemsRepository.find?.mockResolvedValue([
      {
        orderItemId: 'item-partial-1',
        orderId: shippingOrder.orderId,
        productName: 'Phan NPK',
        quantity: 2,
      },
      {
        orderItemId: 'item-partial-2',
        orderId: shippingOrder.orderId,
        productName: 'Hat giong lua',
        quantity: 1,
      },
    ]);

    await expect(
      service.partialDeliverOrder(adminUser, shippingOrder.orderId, [
        { orderItemId: 'item-partial-1', deliveredQty: 1 },
      ]),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(ordersRepository.manager?.transaction).not.toHaveBeenCalled();
  });

  it('limits returns on partial delivered orders to the delivered quantity', async () => {
    const partialDeliveredOrder = {
      orderId: 'order-partial-return-1',
      userId: userEntity.userId,
      orderStatus: OrderStatus.PARTIAL_DELIVERED,
    } as OrderEntity;
    const orderItem = {
      orderItemId: 'item-partial-return-1',
      orderId: partialDeliveredOrder.orderId,
      quantity: 10,
      quantityDelivered: 6,
      lineTotal: '1000000.00',
      grossLineTotal: '1000000.00',
      discountAllocated: '0.00',
      netLineTotal: '1000000.00',
    } as never;

    usersRepository.findOneBy?.mockResolvedValue(userEntity);
    ordersRepository.findOneBy?.mockResolvedValue(partialDeliveredOrder);
    orderItemsRepository.findOneBy?.mockResolvedValue(orderItem);
    returnsRepository.find?.mockResolvedValue([]);

    await expect(
      service.createReturn(userEntity.userId, {
        orderId: partialDeliveredOrder.orderId,
        orderItemId: 'item-partial-return-1',
        returnQuantity: 7,
        reason: 'partial_return',
        description: 'Return more than delivered quantity',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(returnsRepository.create).not.toHaveBeenCalled();
  });

  it('blocks manual payment confirmation for closed orders', async () => {
    const closedOrder = {
      orderId: 'order-closed-payment-1',
      userId: 'user-2',
      orderStatus: OrderStatus.CANCELLED,
      paymentMethod: PaymentMethod.BANK_TRANSFER,
      paymentStatus: PaymentStatus.FAILED,
    } as OrderEntity;

    usersRepository.findOneBy?.mockResolvedValue(userEntity);
    ordersRepository.findOneBy?.mockResolvedValue(closedOrder);

    await expect(
      service.confirmPayment(adminUser, closedOrder.orderId),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        error: 'PAYMENT_FOR_CLOSED_ORDER_REQUIRES_RECONCILIATION',
      }),
    });
  });

  it('creates a pending manual refund before cancelling a paid order', async () => {
    const paidOrder = {
      orderId: 'order-refund-paid-1',
      userId: 'user-2',
      orderStatus: OrderStatus.PENDING,
      paymentMethod: PaymentMethod.MOMO,
      paymentStatus: PaymentStatus.PAID,
      totalPayment: '240000.00',
      fullName: 'Linh',
      phone: '0900000000',
    } as OrderEntity;
    const refund = {
      refundId: 'refund-paid-1',
      orderId: paidOrder.orderId,
      returnId: null,
      reason: OrderRefundReason.CANCEL_PAID_ORDER,
      amount: paidOrder.totalPayment,
      refundStatus: OrderRefundStatus.PENDING,
      paymentProvider: paidOrder.paymentMethod,
      manualReference: null,
      createdBy: adminUser._id,
      note: 'Khach doi huy',
      createdAt: now,
      updatedAt: now,
    } as OrderRefundEntity;

    usersRepository.findOneBy?.mockResolvedValue(userEntity);
    ordersRepository.findOneBy?.mockResolvedValue(paidOrder);
    orderRefundsRepository.findOne?.mockResolvedValue(null);
    orderRefundsRepository.find?.mockResolvedValue([]);
    orderRefundsRepository.create?.mockReturnValue(refund);
    orderRefundsRepository.save?.mockResolvedValue(refund);

    await expect(
      service.createCancelPaidOrderRefund(adminUser, {
        orderId: paidOrder.orderId,
        note: refund.note ?? undefined,
      }),
    ).resolves.toMatchObject({
      refundId: refund.refundId,
      reason: OrderRefundReason.CANCEL_PAID_ORDER,
      refundStatus: OrderRefundStatus.PENDING,
      amount: paidOrder.totalPayment,
    });
  });

  it('rejects unsigned generic payment callbacks in production', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousFlag = process.env.ENABLE_UNVERIFIED_PAYMENT_CALLBACKS;
    process.env.NODE_ENV = 'production';
    delete process.env.ENABLE_UNVERIFIED_PAYMENT_CALLBACKS;

    try {
      await expect(
        service.handlePaymentCallback('momo', {
          orderId: 'order-any',
          transactionRef: 'fake-ref',
          amount: '100000',
          success: true,
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
      if (previousFlag === undefined) {
        delete process.env.ENABLE_UNVERIFIED_PAYMENT_CALLBACKS;
      } else {
        process.env.ENABLE_UNVERIFIED_PAYMENT_CALLBACKS = previousFlag;
      }
    }
  });

  it('queues a manual refund instead of marking a closed order as paid on late callback', async () => {
    const closedOrder = {
      orderId: 'order-late-paid-1',
      userId: 'user-2',
      orderStatus: OrderStatus.CANCELLED,
      paymentMethod: PaymentMethod.MOMO,
      paymentStatus: PaymentStatus.FAILED,
      totalPayment: '120000.00',
    } as OrderEntity;
    const refund = {
      refundId: 'refund-late-1',
      orderId: closedOrder.orderId,
      reason: OrderRefundReason.MANUAL_ADJUSTMENT,
      amount: closedOrder.totalPayment,
      refundStatus: OrderRefundStatus.PENDING,
    } as OrderRefundEntity;

    ordersRepository.findOneBy?.mockResolvedValue(closedOrder);
    paymentTransactionsRepository.findOne?.mockResolvedValue(null);
    paymentTransactionsRepository.create?.mockImplementation((value) => value);
    paymentTransactionsRepository.save?.mockImplementation((value) =>
      Promise.resolve(value),
    );
    orderRefundsRepository.findOne?.mockResolvedValue(null);
    orderRefundsRepository.create?.mockReturnValue(refund);
    orderRefundsRepository.save?.mockResolvedValue(refund);

    await expect(
      service.handlePaymentCallback('momo', {
        orderId: closedOrder.orderId,
        transactionRef: 'late-ref-1',
        amount: '120000',
        success: true,
      }),
    ).resolves.toMatchObject({
      paymentStatus: PaymentStatus.FAILED,
      refundStatus: OrderRefundStatus.PENDING,
    });

    expect(orderRefundsRepository.save).toHaveBeenCalledWith(refund);
    expect(ordersRepository.save).not.toHaveBeenCalled();
    expect(closedOrder.paymentStatus).toBe(PaymentStatus.FAILED);
  });

  it('completes a paid cancellation refund and closes the order once', async () => {
    const paidOrder = {
      orderId: 'order-refund-paid-2',
      userId: 'user-2',
      discountId: null,
      orderStatus: OrderStatus.CONFIRMED,
      paymentMethod: PaymentMethod.MOMO,
      paymentStatus: PaymentStatus.PAID,
      totalPayment: '180000.00',
    } as OrderEntity;
    const refund = {
      refundId: 'refund-paid-2',
      orderId: paidOrder.orderId,
      returnId: null,
      reason: OrderRefundReason.CANCEL_PAID_ORDER,
      amount: paidOrder.totalPayment,
      refundStatus: OrderRefundStatus.APPROVED,
      paymentProvider: paidOrder.paymentMethod,
      manualReference: null,
      createdBy: adminUser._id,
      note: null,
      createdAt: now,
      updatedAt: now,
    } as OrderRefundEntity;
    const emptyRepository = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      findOneBy: jest.fn().mockResolvedValue(null),
      save: jest.fn((entity: unknown) => Promise.resolve(entity)),
      create: jest.fn((entity: unknown) => entity),
    };
    const entityManager = {
      findOne: jest.fn((entity: TransactionEntityTarget) => {
        if (entity.name === OrderRefundEntity.name) return Promise.resolve(refund);
        if (entity.name === OrderEntity.name) return Promise.resolve(paidOrder);
        return Promise.resolve(null);
      }),
      find: jest.fn((entity: TransactionEntityTarget) => {
        if (entity.name === OrderRefundEntity.name) return Promise.resolve([refund]);
        return Promise.resolve([]);
      }),
      save: jest.fn((_: unknown, entity: unknown) => Promise.resolve(entity)),
      getRepository: jest.fn(() => emptyRepository),
    };

    usersRepository.findOneBy?.mockResolvedValue(userEntity);
    orderRefundsRepository.manager?.transaction.mockImplementation(
      (callback: (manager: typeof entityManager) => Promise<unknown>) =>
        callback(entityManager),
    );

    await expect(
      service.updateAdminRefundStatus(adminUser, refund.refundId, {
        status: OrderRefundStatus.COMPLETED,
        manualReference: 'BANK-REF-001',
      }),
    ).resolves.toMatchObject({
      refundId: refund.refundId,
      refundStatus: OrderRefundStatus.COMPLETED,
    });

    expect(paidOrder.orderStatus).toBe(OrderStatus.CANCELLED);
    expect(paidOrder.paymentStatus).toBe(PaymentStatus.REFUNDED);
    expect(emptyRepository.find).toHaveBeenCalledTimes(1);
  });

  it('marks COD orders as paid when admin moves them to delivered', async () => {
    const order: OrderEntity = {
      orderId: 'order-1',
      userId: 'user-2',
      shippingAddressId: 'addr-1',
      deliveryId: '1',
      discountId: null,
      orderStatus: OrderStatus.SHIPPING,
      paymentMethod: PaymentMethod.COD,
      paymentStatus: PaymentStatus.UNPAID,
      subtotalAmount: '100000.00',
      discountAmount: '0.00',
      deliveryCost: '0.00',
      totalPayment: '100000.00',
      totalQuantity: 1,
      note: null,
      fullName: 'Alice',
      phone: '0900000000',
      address: '123 Nguyen Trai',
      idempotencyKey: null,
      createdAt: now,
      updatedAt: now,
    };

    usersRepository.findOneBy?.mockResolvedValue(userEntity);
    ordersRepository.findOneBy
      ?.mockResolvedValueOnce(order)
      .mockResolvedValueOnce(order);
    orderItemsRepository.find?.mockResolvedValue([]);
    orderStatusHistoryRepository.find?.mockResolvedValue([]);

    const transactionalOrdersRepository = {
      save: jest.fn((entity: OrderEntity) => Promise.resolve(entity)),
    };
    const transactionalHistoryRepository = {
      create: jest.fn((entity: Record<string, unknown>) => ({
        historyId: 'history-1',
        createdAt: now,
        ...entity,
      })),
      save: jest.fn((entity: Record<string, unknown>) =>
        Promise.resolve(entity),
      ),
    };
    const passthroughRepository = {
      find: jest.fn(() => Promise.resolve([])),
      findOneBy: jest.fn(() => Promise.resolve(null)),
      save: jest.fn((entity: Record<string, unknown>) =>
        Promise.resolve(entity),
      ),
      delete: jest.fn(() => Promise.resolve({ affected: 1 })),
    };

    ordersRepository.manager?.transaction.mockImplementation(
      (
        callback: (manager: {
          getRepository: (entity: TransactionEntityTarget) => unknown;
        }) => Promise<void>,
      ) =>
        callback({
          getRepository: (entity: TransactionEntityTarget) => {
            if (entity.name === OrderEntity.name) {
              return transactionalOrdersRepository;
            }
            if (entity.name === 'OrderStatusHistoryEntity') {
              return transactionalHistoryRepository;
            }
            return passthroughRepository;
          },
        }),
    );

    const result = await service.updateOrderStatus(adminUser, order.orderId, {
      status: OrderStatus.DELIVERED,
    });

    expect(transactionalOrdersRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        orderStatus: OrderStatus.DELIVERED,
        paymentStatus: PaymentStatus.PAID,
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        id: order.orderId,
        status: OrderStatus.DELIVERED,
        paymentStatus: PaymentStatus.PAID,
      }),
    );
  });
});
