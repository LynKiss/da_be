import { ConfigService } from '@nestjs/config';
import { CartsService } from '../carts/carts.service';
import { OrdersService } from '../orders/orders.service';
import { ProductsService } from '../products/products.service';
import { UsersService } from '../users/users.service';
import { SupportBotService } from './support-bot.service';

describe('SupportBotService', () => {
  let service: SupportBotService;
  let configService: { get: jest.Mock };
  let productsService: { findAll: jest.Mock };
  let ordersService: { findGuestOrder: jest.Mock };
  let cartsService: { addItem: jest.Mock; getMyCart: jest.Mock };
  let usersService: { findMyOrders: jest.Mock };
  const originalFetch = global.fetch;

  beforeEach(() => {
    configService = {
      get: jest.fn(),
    };
    productsService = {
      findAll: jest.fn(),
    };
    ordersService = {
      findGuestOrder: jest.fn(),
    };
    cartsService = {
      addItem: jest.fn(),
      getMyCart: jest.fn(),
    };
    usersService = {
      findMyOrders: jest.fn(),
    };

    service = new SupportBotService(
      configService as unknown as ConfigService,
      productsService as unknown as ProductsService,
      ordersService as unknown as OrdersService,
      cartsService as unknown as CartsService,
      usersService as unknown as UsersService,
    );
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it('returns fallback product suggestions when AI is not configured', async () => {
    configService.get.mockReturnValue(undefined);
    productsService.findAll.mockResolvedValue({
      items: [
        {
          productId: 'product-1',
          productName: 'Phan NPK 20-20-15',
          effectivePrice: '150000.00',
          basePrice: '150000.00',
          unit: 'bao',
          quantityAvailable: 12,
          primaryImageUrl: null,
        },
      ],
    });

    const result = await service.createReply({
      message: 'Tim phan NPK cho lua',
      history: [],
    });

    expect(result.source).toBe('fallback');
    expect(result.products).toHaveLength(1);
    expect(result.reply).toContain('Phan NPK 20-20-15');
  });

  it('returns visible catalog products for broad product questions', async () => {
    configService.get.mockReturnValue(undefined);
    productsService.findAll.mockResolvedValue({
      items: [
        {
          productId: 'product-2',
          productName: 'Hat giong lua OM5451',
          effectivePrice: '85000.00',
          basePrice: '85000.00',
          unit: 'kg',
          quantityAvailable: 30,
          primaryImageUrl: null,
        },
      ],
    });

    const result = await service.createReply({
      message: 'Hien dang co nhung san pham gi?',
      history: [],
    });

    expect(productsService.findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        page: 1,
        limit: 4,
        includeHidden: false,
      }),
    );
    expect(productsService.findAll.mock.calls[0][0].search).toBeUndefined();
    expect(result.source).toBe('fallback');
    expect(result.products).toHaveLength(1);
    expect(result.reply).toContain('Hien co 1 san pham dang hien thi');
    expect(result.reply).toContain('Hat giong lua OM5451');
  });

  it('returns product recommendations with reasons', async () => {
    configService.get.mockReturnValue(undefined);
    productsService.findAll.mockResolvedValue({
      items: [
        {
          productId: 'product-6',
          productName: 'Phan NPK chuyen dung cho lua',
          effectivePrice: '210000.00',
          basePrice: '210000.00',
          unit: 'bao',
          quantityAvailable: 15,
          primaryImageUrl: null,
        },
      ],
    });

    const result = await service.createReply({
      message: 'Goi y san pham cho lua',
      history: [],
    });

    expect(productsService.findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        search: 'lua',
        page: 1,
        limit: 4,
        includeHidden: false,
      }),
    );
    expect(result.intent).toBe('product_recommendation');
    expect(result.products).toHaveLength(1);
    expect(result.reply).toContain('Toi goi y cac san pham');
    expect(result.reply).toContain('Phan NPK chuyen dung cho lua');
    expect(result.reply).toContain('Phu hop vi');
  });

  it('uses the current user context for identity questions', async () => {
    configService.get.mockReturnValue(undefined);

    const result = await service.createReply(
      {
        message: 'Toi la ai?',
        history: [],
      },
      {
        _id: 'user-1',
        username: 'customer01',
        email: 'customer@example.com',
        role: { _id: 'customer' as never, name: 'customer' as never },
        permissions: [],
      },
    );

    expect(result.source).toBe('fallback');
    expect(result.reply).toContain('customer01');
    expect(result.reply).toContain('customer@example.com');
  });

  it('adds a clear product request to the current user cart', async () => {
    configService.get.mockReturnValue(undefined);
    productsService.findAll.mockResolvedValue({
      items: [
        {
          productId: 'product-3',
          productName: 'Phan huu co',
          effectivePrice: '120000.00',
          basePrice: '120000.00',
          unit: 'bao',
          quantityAvailable: 10,
          primaryImageUrl: null,
        },
      ],
    });
    cartsService.addItem.mockResolvedValue({
      productName: 'Phan huu co',
    });
    cartsService.getMyCart.mockResolvedValue({
      totalItems: 1,
      totalQuantity: 2,
      totalAmount: '240000.00',
      items: [
        {
          productName: 'Phan huu co',
          quantity: 2,
          lineTotal: '240000.00',
        },
      ],
    });

    const result = await service.createReply(
      {
        message: 'Them 2 phan huu co vao gio',
        history: [],
      },
      {
        _id: 'user-1',
        username: 'customer01',
        email: 'customer@example.com',
        role: { _id: 'customer' as never, name: 'customer' as never },
        permissions: [],
      },
    );

    expect(cartsService.addItem).toHaveBeenCalledWith('user-1', {
      productId: 'product-3',
      quantity: 2,
    });
    expect(result.cartChanged).toBe(true);
    expect(result.reply).toContain('Da them 2 x Phan huu co vao gio hang');
  });

  it('removes quantity from cart search and selects the best catalog match', async () => {
    configService.get.mockReturnValue(undefined);
    productsService.findAll
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({
        items: [
          {
            productId: 'product-4',
            productName: 'Binh xit tay 8 lit Taiwan',
            effectivePrice: '95000.00',
            basePrice: '95000.00',
            unit: 'cai',
            quantityAvailable: 8,
            primaryImageUrl: null,
          },
          {
            productId: 'product-5',
            productName: 'Phan huu co vi sinh Lam Thao 20kg',
            effectivePrice: '185250.00',
            basePrice: '185250.00',
            unit: 'bao',
            quantityAvailable: 20,
            primaryImageUrl: null,
          },
        ],
      });
    cartsService.addItem.mockResolvedValue({
      productName: 'Binh xit tay 8 lit Taiwan',
    });
    cartsService.getMyCart.mockResolvedValue({
      totalItems: 1,
      totalQuantity: 2,
      totalAmount: '190000.00',
      items: [
        {
          productName: 'Binh xit tay 8 lit Taiwan',
          quantity: 2,
          lineTotal: '190000.00',
        },
      ],
    });

    const result = await service.createReply(
      {
        message: 'them 2 Binh xit tay 8 lit Taiwan vao gio',
        history: [],
      },
      {
        _id: 'user-1',
        username: 'customer01',
        email: 'customer@example.com',
        role: { _id: 'customer' as never, name: 'customer' as never },
        permissions: [],
      },
    );

    expect(productsService.findAll.mock.calls[0][0].search).toBe(
      'binh xit tay 8 lit taiwan',
    );
    expect(cartsService.addItem).toHaveBeenCalledWith('user-1', {
      productId: 'product-4',
      quantity: 2,
    });
    expect(result.reply).toContain(
      'Da them 2 x Binh xit tay 8 lit Taiwan vao gio hang',
    );
  });

  it('summarizes current user orders and statuses', async () => {
    configService.get.mockReturnValue(undefined);
    usersService.findMyOrders.mockResolvedValue({
      total: 2,
      items: [
        {
          id: '11111111-2222-3333-4444-555555555555',
          status: 'shipping',
          paymentMethod: 'cod',
          paymentStatus: 'unpaid',
          totalPayment: '520000.00',
          totalQuantity: 2,
          createdAt: new Date('2026-04-20T00:00:00.000Z'),
        },
        {
          id: '22222222-3333-4444-5555-666666666666',
          status: 'delivered',
          paymentMethod: 'vnpay',
          paymentStatus: 'paid',
          totalPayment: '120000.00',
          totalQuantity: 1,
          createdAt: new Date('2026-04-19T00:00:00.000Z'),
        },
      ],
    });

    const result = await service.createReply(
      {
        message: 'Toi co nhung don hang nao va trang thai ra sao?',
        history: [],
      },
      {
        _id: 'user-1',
        username: 'customer01',
        email: 'customer@example.com',
        role: { _id: 'customer' as never, name: 'customer' as never },
        permissions: [],
      },
    );

    expect(usersService.findMyOrders).toHaveBeenCalledWith('user-1', {
      page: 1,
      limit: 5,
    });
    expect(result.source).toBe('fallback');
    expect(result.reply).toContain('Ban co 2 don hang');
    expect(result.reply).toContain('Dang giao');
    expect(result.reply).toContain('Da giao');
  });

  it('summarizes guest order when message contains order id and phone', async () => {
    configService.get.mockReturnValue(undefined);
    ordersService.findGuestOrder.mockResolvedValue({
      id: '11111111-2222-3333-4444-555555555555',
      status: 'shipping',
      totalPayment: '520000.00',
      totalQuantity: 2,
      fullName: 'Nguyen Van A',
      phone: '0912345678',
      items: [{ productName: 'Phan huu co', quantity: 2 }],
    });

    const result = await service.createReply({
      message:
        'Tra cuu don 11111111-2222-3333-4444-555555555555 voi so 0912345678',
      history: [],
    });

    expect(ordersService.findGuestOrder).toHaveBeenCalledWith(
      '11111111-2222-3333-4444-555555555555',
      '0912345678',
    );
    expect(result.reply).toContain('Trang thai: Dang giao');
    expect(result.source).toBe('fallback');
  });

  it('uses AI response when provider is configured', async () => {
    configService.get.mockImplementation((key: string) => {
      const values: Record<string, string> = {
        SUPPORT_BOT_API_KEY: 'test-key',
        SUPPORT_BOT_MODEL: 'test-model',
        SUPPORT_BOT_API_BASE_URL: 'https://example.com/v1',
        SUPPORT_BOT_TIMEOUT_MS: '2000',
      };

      return values[key];
    });

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: 'AI da tra loi dung nghiep vu.' } }],
        }),
    }) as unknown as typeof fetch;

    const result = await service.createReply({
      message: 'Phi giao hang bao nhieu?',
      history: [],
    });

    expect(global.fetch).toHaveBeenCalled();
    expect(result.source).toBe('ai');
    expect(result.reply).toBe('AI da tra loi dung nghiep vu.');
  });
});
