import { BadRequestException } from '@nestjs/common';
import { OrdersService } from './orders.service';
import {
  OrderEntity,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
} from './entities/order.entity';
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
    notificationsService = {
      sendOrderCreatedNotification: jest.fn(),
      sendOrderStatusNotification: jest.fn(),
      sendPaymentNotification: jest.fn(),
      createNotification: jest.fn(),
    };

    service = new OrdersService(
      deliveryMethodsRepository as never,
      shippingAddressesRepository as never,
      ordersRepository as never,
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
      createRepositoryMock() as never,
      createRepositoryMock() as never,
      notificationsService as never,
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
