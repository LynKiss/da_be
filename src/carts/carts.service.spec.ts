import { BadRequestException } from '@nestjs/common';
import { CartsService } from './carts.service';
import { ProductEntity } from '../products/entities/product.entity';
import { UserEntity, UserRole } from '../users/entities/user.entity';

type MockRepository = {
  findOne?: jest.Mock;
  findOneBy?: jest.Mock;
  findBy?: jest.Mock;
  save?: jest.Mock;
  create?: jest.Mock;
  delete?: jest.Mock;
  find?: jest.Mock;
};

const createRepositoryMock = (): MockRepository => ({
  findOne: jest.fn(),
  findOneBy: jest.fn(),
  findBy: jest.fn(),
  save: jest.fn(),
  create: jest.fn(),
  delete: jest.fn(),
  find: jest.fn(),
});

describe('CartsService', () => {
  let service: CartsService;
  let cartsRepository: MockRepository;
  let cartItemsRepository: MockRepository;
  let productsRepository: MockRepository;
  let usersRepository: MockRepository;

  const now = new Date('2026-04-19T08:00:00.000Z');
  const user: UserEntity = {
    userId: 'user-1',
    username: 'alice',
    email: 'alice@example.com',
    avatarUrl: null,
    role: UserRole.CUSTOMER,
    passwordHash: 'hash',
    provider: 'local',
    providerId: null,
    isActive: true,
    resetPasswordCode: null,
    resetPasswordExpiresAt: null,
    createdAt: now,
    updatedAt: now,
  };
  const product: ProductEntity = {
    productId: 'product-1',
    productName: 'Fresh Orange',
    productSlug: 'fresh-orange',
    categoryId: '1',
    subcategoryId: null,
    originId: null,
    productPrice: '120000.00',
    productPriceSale: '99000.00',
    quantityAvailable: 5,
    description: null,
    ratingAverage: '0.00',
    ratingCount: 0,
    isShow: true,
    expiredAt: null,
    unit: 'kg',
    quantityPerBox: null,
    barcode: null,
    boxBarcode: null,
    createdAt: now,
    updatedAt: now,
  };

  beforeEach(() => {
    cartsRepository = createRepositoryMock();
    cartItemsRepository = createRepositoryMock();
    productsRepository = createRepositoryMock();
    usersRepository = createRepositoryMock();

    service = new CartsService(
      cartsRepository as never,
      cartItemsRepository as never,
      productsRepository as never,
      usersRepository as never,
    );
  });

  it('merges quantity into an existing cart item and refreshes the unit price', async () => {
    usersRepository.findOneBy?.mockResolvedValue(user);
    cartsRepository.findOneBy?.mockResolvedValue({
      cartId: 'cart-1',
      userId: user.userId,
      createdAt: now,
      updatedAt: now,
    });
    productsRepository.findOneBy?.mockResolvedValue(product);
    cartItemsRepository.findOneBy?.mockResolvedValue({
      cartItemId: 'item-1',
      cartId: 'cart-1',
      productId: product.productId,
      quantity: 1,
      priceAtAdded: '120000.00',
      createdAt: now,
      updatedAt: now,
    });
    cartItemsRepository.save?.mockImplementation((entity) =>
      Promise.resolve(entity),
    );

    const result = await service.addItem(user.userId, {
      productId: product.productId,
      quantity: 2,
    });

    expect(cartItemsRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        cartItemId: 'item-1',
        quantity: 3,
        priceAtAdded: '99000.00',
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        id: 'item-1',
        quantity: 3,
        unitPrice: '99000.00',
        lineTotal: '297000.00',
      }),
    );
  });

  it('rejects when the requested quantity exceeds stock', async () => {
    usersRepository.findOneBy?.mockResolvedValue(user);
    cartsRepository.findOneBy?.mockResolvedValue({
      cartId: 'cart-1',
      userId: user.userId,
      createdAt: now,
      updatedAt: now,
    });
    productsRepository.findOneBy?.mockResolvedValue(product);
    cartItemsRepository.findOneBy?.mockResolvedValue({
      cartItemId: 'item-1',
      cartId: 'cart-1',
      productId: product.productId,
      quantity: 4,
      priceAtAdded: '120000.00',
      createdAt: now,
      updatedAt: now,
    });

    await expect(
      service.addItem(user.userId, {
        productId: product.productId,
        quantity: 2,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns aggregated totals for the current cart', async () => {
    usersRepository.findOneBy?.mockResolvedValue(user);
    cartsRepository.findOneBy?.mockResolvedValue({
      cartId: 'cart-1',
      userId: user.userId,
      createdAt: now,
      updatedAt: now,
    });
    cartItemsRepository.find?.mockResolvedValue([
      {
        cartItemId: 'item-1',
        cartId: 'cart-1',
        productId: 'product-1',
        quantity: 2,
        priceAtAdded: '99000.00',
        createdAt: now,
        updatedAt: now,
      },
      {
        cartItemId: 'item-2',
        cartId: 'cart-1',
        productId: 'product-2',
        quantity: 1,
        priceAtAdded: '50000.00',
        createdAt: now,
        updatedAt: now,
      },
    ]);
    productsRepository.findBy?.mockResolvedValue([
      product,
      {
        ...product,
        productId: 'product-2',
        productName: 'Mango',
        productPrice: '50000.00',
        productPriceSale: null,
        quantityAvailable: 10,
      },
    ]);

    const result = await service.getMyCart(user.userId);

    expect(result).toEqual(
      expect.objectContaining({
        id: 'cart-1',
        totalItems: 2,
        totalQuantity: 3,
        totalAmount: '248000.00',
      }),
    );
  });
});
