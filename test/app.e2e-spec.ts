import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  Injectable,
  UnauthorizedException,
  VersioningType,
  ValidationPipe,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { CartsController } from '../src/carts/carts.controller';
import { CartsService } from '../src/carts/carts.service';
import { TransformInterceptor } from '../src/core/transform.interceptor';
import { IS_PUBLIC_KEY, PERMISSIONS_KEY } from '../src/decorator/customize';
import { DiscountsController } from '../src/discounts/discounts.controller';
import { DiscountsService } from '../src/discounts/discounts.service';
import { OrdersController } from '../src/orders/orders.controller';
import { PaymentMethod } from '../src/orders/entities/order.entity';
import { OrdersService } from '../src/orders/orders.service';
import { WishlistController } from '../src/products/wishlist.controller';
import { ProductsService } from '../src/products/products.service';
import { ReportsController } from '../src/reports/reports.controller';
import { ReportsService } from '../src/reports/reports.service';
import { UsersController } from '../src/users/users.controller';
import { UserRole } from '../src/users/entities/user.entity';
import type { IUser } from '../src/users/users.interface';
import { UsersService } from '../src/users/users.service';

@Injectable()
class TestAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{
      headers: { authorization?: string };
      user?: IUser;
    }>();
    const authHeader = request.headers.authorization;

    if (!authHeader) {
      throw new UnauthorizedException('Missing bearer token');
    }

    if (authHeader === 'Bearer user-token') {
      request.user = {
        _id: 'user-1',
        username: 'alice',
        email: 'alice@example.com',
        role: { _id: UserRole.CUSTOMER, name: UserRole.CUSTOMER },
        permissions: [],
      };
    }

    if (authHeader === 'Bearer admin-token') {
      request.user = {
        _id: 'admin-1',
        username: 'admin',
        email: 'admin@example.com',
        role: { _id: UserRole.ADMIN, name: UserRole.ADMIN },
        permissions: [
          {
            _id: 'perm-1',
            key: 'manage_orders',
            name: 'Manage Orders',
          },
          {
            _id: 'perm-2',
            key: 'manage_reports',
            name: 'Manage Reports',
          },
          {
            _id: 'perm-3',
            key: 'manage_discounts',
            name: 'Manage Discounts',
          },
        ],
      };
    }

    if (!request.user) {
      throw new UnauthorizedException('Invalid bearer token');
    }

    const requiredPermissions =
      this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];

    if (requiredPermissions.length === 0) {
      return true;
    }

    const currentPermissions = new Set(
      request.user.permissions.map((permission) => permission.key),
    );

    return requiredPermissions.every((permission) =>
      currentPermissions.has(permission),
    );
  }
}

type HttpErrorBody = {
  message: string | string[];
};

type WrappedBody<T> = {
  statusCode: number;
  message: string;
  data: T;
};

const getHttpErrorBody = (response: { body: unknown }) =>
  response.body as HttpErrorBody;

const getWrappedBody = <T>(response: { body: unknown }) =>
  response.body as WrappedBody<T>;

describe('HTTP flows (e2e)', () => {
  let app: INestApplication<App>;
  const usersService = {
    findProfile: jest.fn(),
    updateProfile: jest.fn(),
    changePassword: jest.fn(),
    findMyShippingAddresses: jest.fn(),
    createShippingAddress: jest.fn(),
    updateShippingAddress: jest.fn(),
    deleteShippingAddress: jest.fn(),
    setDefaultShippingAddress: jest.fn(),
    findMyOrders: jest.fn(),
    findMyOrderDetail: jest.fn(),
    findAll: jest.fn(),
  };
  const ordersService = {
    createOrder: jest.fn(),
    findAllOrders: jest.fn(),
    findOrderDetail: jest.fn(),
    cancelOrder: jest.fn(),
    updateOrderStatus: jest.fn(),
  };
  const cartsService = {
    getMyCart: jest.fn(),
    addItem: jest.fn(),
    updateItem: jest.fn(),
    deleteItem: jest.fn(),
  };
  const productsService = {
    findWishlist: jest.fn(),
    addWishlistItem: jest.fn(),
    removeWishlistItem: jest.fn(),
  };
  const discountsService = {
    findAvailableOrderDiscounts: jest.fn(),
    findAllForAdmin: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };
  const reportsService = {
    getDashboard: jest.fn(),
    getSalesSummary: jest.fn(),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [
        UsersController,
        OrdersController,
        CartsController,
        WishlistController,
        DiscountsController,
        ReportsController,
      ],
      providers: [
        Reflector,
        TestAuthGuard,
        {
          provide: UsersService,
          useValue: usersService,
        },
        {
          provide: OrdersService,
          useValue: ordersService,
        },
        {
          provide: CartsService,
          useValue: cartsService,
        },
        {
          provide: ProductsService,
          useValue: productsService,
        },
        {
          provide: DiscountsService,
          useValue: discountsService,
        },
        {
          provide: ReportsService,
          useValue: reportsService,
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    const reflector = moduleFixture.get(Reflector);
    app.useGlobalGuards(moduleFixture.get(TestAuthGuard));
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    app.useGlobalInterceptors(new TransformInterceptor(reflector));
    app.setGlobalPrefix('api');
    app.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: '1',
    });

    await app.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects private routes without a bearer token', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/users/me')
      .expect(401)
      .expect((response: { body: unknown }) => {
        const body = getHttpErrorBody(response);
        expect(body.message).toBe('Missing bearer token');
      });
  });

  it('validates the change password DTO on private routes', async () => {
    await request(app.getHttpServer())
      .patch('/api/v1/users/me/change-password')
      .set('Authorization', 'Bearer user-token')
      .send({
        oldPassword: '123',
        newPassword: '456',
      })
      .expect(400)
      .expect((response: { body: unknown }) => {
        const body = getHttpErrorBody(response);
        expect(body.message).toEqual(
          expect.arrayContaining([
            'oldPassword must be longer than or equal to 6 characters',
            'newPassword must be longer than or equal to 6 characters',
          ]),
        );
      });
  });

  it('creates a shipping address for the authenticated user', async () => {
    usersService.createShippingAddress.mockResolvedValue({
      id: 'addr-1',
      recipientName: 'Alice Nguyen',
      phone: '0900000000',
      addressLine: '123 Nguyen Trai',
      ward: 'Ward 1',
      district: 'District 5',
      province: 'HCMC',
      isDefault: true,
    });

    await request(app.getHttpServer())
      .post('/api/v1/users/me/addresses')
      .set('Authorization', 'Bearer user-token')
      .send({
        recipientName: 'Alice Nguyen',
        phone: '0900000000',
        addressLine: '123 Nguyen Trai',
        ward: 'Ward 1',
        district: 'District 5',
        province: 'HCMC',
        isDefault: true,
      })
      .expect(201)
      .expect((response: { body: unknown }) => {
        const body = getWrappedBody<{ id: string; isDefault: boolean }>(
          response,
        );
        expect(usersService.createShippingAddress).toHaveBeenCalledWith(
          'user-1',
          expect.objectContaining({
            recipientName: 'Alice Nguyen',
            isDefault: true,
          }),
        );
        expect(body.statusCode).toBe(201);
        expect(body.message).toBe('Create my shipping address');
        expect(body.data.id).toBe('addr-1');
        expect(body.data.isDefault).toBe(true);
      });
  });

  it('forbids normal users from reading the admin orders list', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/orders')
      .set('Authorization', 'Bearer user-token')
      .expect(403);
  });

  it('allows admins to read the orders list', async () => {
    ordersService.findAllOrders.mockResolvedValue({
      meta: {
        page: 1,
        limit: 10,
        total: 1,
        totalPages: 1,
      },
      items: [
        {
          id: 'order-1',
          status: 'pending',
          totalPayment: '199000.00',
        },
      ],
    });

    await request(app.getHttpServer())
      .get('/api/v1/orders?page=1&limit=10')
      .set('Authorization', 'Bearer admin-token')
      .expect(200)
      .expect((response: { body: unknown }) => {
        const body = getWrappedBody<{
          meta: { total: number };
          items: Array<{ id: string }>;
        }>(response);

        expect(ordersService.findAllOrders).toHaveBeenCalledWith(
          expect.objectContaining({
            page: 1,
            limit: 10,
          }),
        );
        expect(body.statusCode).toBe(200);
        expect(body.message).toBe('Get orders list');
        expect(body.data.meta.total).toBe(1);
        expect(body.data.items[0]?.id).toBe('order-1');
      });
  });

  it('creates an order for the authenticated user', async () => {
    ordersService.createOrder.mockResolvedValue({
      id: 'order-1',
      status: 'pending',
      paymentMethod: PaymentMethod.COD,
      totalPayment: '199000.00',
      items: [],
      history: [],
    });

    await request(app.getHttpServer())
      .post('/api/v1/orders')
      .set('Authorization', 'Bearer user-token')
      .send({
        shippingAddressId: '1',
        deliveryId: '1',
        paymentMethod: PaymentMethod.COD,
        note: 'Giao buoi sang',
      })
      .expect(201)
      .expect((response: { body: unknown }) => {
        const body = getWrappedBody<{ id: string; status: string }>(response);

        expect(ordersService.createOrder).toHaveBeenCalledWith(
          'user-1',
          expect.objectContaining({
            shippingAddressId: '1',
            deliveryId: '1',
            paymentMethod: PaymentMethod.COD,
          }),
        );
        expect(body.statusCode).toBe(201);
        expect(body.message).toBe('Create order');
        expect(body.data.id).toBe('order-1');
        expect(body.data.status).toBe('pending');
      });
  });

  it('validates cart item quantity before calling the cart service', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/cart/items')
      .set('Authorization', 'Bearer user-token')
      .send({
        productId: 'product-1',
        quantity: 0,
      })
      .expect(400)
      .expect((response: { body: unknown }) => {
        const body = getHttpErrorBody(response);
        expect(body.message).toEqual(
          expect.arrayContaining(['quantity must not be less than 1']),
        );
      });
  });

  it('returns the authenticated user cart', async () => {
    cartsService.getMyCart.mockResolvedValue({
      id: 'cart-1',
      totalItems: 1,
      totalQuantity: 2,
      totalAmount: '198000.00',
      items: [],
    });

    await request(app.getHttpServer())
      .get('/api/v1/cart')
      .set('Authorization', 'Bearer user-token')
      .expect(200)
      .expect((response: { body: unknown }) => {
        const body = getWrappedBody<{
          id: string;
          totalItems: number;
          totalQuantity: number;
          totalAmount: string;
        }>(response);

        expect(cartsService.getMyCart).toHaveBeenCalledWith('user-1');
        expect(body.message).toBe('Get my cart');
        expect(body.data.id).toBe('cart-1');
        expect(body.data.totalAmount).toBe('198000.00');
      });
  });

  it('returns the authenticated user wishlist', async () => {
    productsService.findWishlist.mockResolvedValue([
      {
        productId: 'product-1',
        productName: 'Fresh Orange',
      },
    ]);

    await request(app.getHttpServer())
      .get('/api/v1/wishlist')
      .set('Authorization', 'Bearer user-token')
      .expect(200)
      .expect((response: { body: unknown }) => {
        const body = getWrappedBody<Array<{ productId: string }>>(response);

        expect(productsService.findWishlist).toHaveBeenCalledWith('user-1');
        expect(body.message).toBe('Get wishlist');
        expect(body.data[0]?.productId).toBe('product-1');
      });
  });

  it('allows public users to read available discounts without authentication', async () => {
    discountsService.findAvailableOrderDiscounts.mockResolvedValue([
      {
        discountCode: 'WELCOME10',
        isPrivate: false,
      },
    ]);

    await request(app.getHttpServer())
      .get('/api/v1/discounts')
      .expect(200)
      .expect((response: { body: unknown }) => {
        const body =
          getWrappedBody<Array<{ discountCode: string; isPrivate: boolean }>>(
            response,
          );

        expect(discountsService.findAvailableOrderDiscounts).toHaveBeenCalled();
        expect(body.message).toBe('Get available discounts');
        expect(body.data[0]?.discountCode).toBe('WELCOME10');
      });
  });

  it('forbids normal users from reading reports', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/reports/dashboard')
      .set('Authorization', 'Bearer user-token')
      .expect(403);
  });

  it('allows admins to read the dashboard report', async () => {
    reportsService.getDashboard.mockResolvedValue({
      totalUsers: 10,
      totalOrders: 5,
      revenue: '1000000.00',
    });

    await request(app.getHttpServer())
      .get('/api/v1/reports/dashboard')
      .set('Authorization', 'Bearer admin-token')
      .expect(200)
      .expect((response: { body: unknown }) => {
        const body = getWrappedBody<{
          totalUsers: number;
          totalOrders: number;
          revenue: string;
        }>(response);

        expect(reportsService.getDashboard).toHaveBeenCalled();
        expect(body.message).toBe('Get dashboard report');
        expect(body.data.totalUsers).toBe(10);
        expect(body.data.revenue).toBe('1000000.00');
      });
  });

  it('validates report query parameters before calling the report service', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/reports/sales-summary?from=invalid-date')
      .set('Authorization', 'Bearer admin-token')
      .expect(400)
      .expect((response: { body: unknown }) => {
        const body = getHttpErrorBody(response);
        expect(body.message).toEqual(
          expect.arrayContaining(['from must be a valid ISO 8601 date string']),
        );
      });
  });
});
