import { ConfigService } from '@nestjs/config';
import { OrdersService } from '../orders/orders.service';
import { ProductsService } from '../products/products.service';
import { SupportBotService } from './support-bot.service';

describe('SupportBotService', () => {
  let service: SupportBotService;
  let configService: { get: jest.Mock };
  let productsService: { findAll: jest.Mock };
  let ordersService: { findGuestOrder: jest.Mock };
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

    service = new SupportBotService(
      configService as unknown as ConfigService,
      productsService as unknown as ProductsService,
      ordersService as unknown as OrdersService,
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
