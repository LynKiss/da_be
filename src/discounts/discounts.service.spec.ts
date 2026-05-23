import { BadRequestException } from '@nestjs/common';
import { DiscountsService } from './discounts.service';
import {
  DiscountApplyTarget,
  DiscountApprovalStatus,
  DiscountType,
} from './entities/discount.entity';

type MockRepository = {
  find?: jest.Mock;
  findOne?: jest.Mock;
  findOneBy?: jest.Mock;
  findBy?: jest.Mock;
  save?: jest.Mock;
  create?: jest.Mock;
  delete?: jest.Mock;
  remove?: jest.Mock;
  countBy?: jest.Mock;
  createQueryBuilder?: jest.Mock;
};

const createRepositoryMock = (): MockRepository => ({
  find: jest.fn(),
  findOne: jest.fn(),
  findOneBy: jest.fn(),
  findBy: jest.fn(),
  save: jest.fn((value) => Promise.resolve(value)),
  create: jest.fn((value) => value),
  delete: jest.fn(),
  remove: jest.fn(),
  countBy: jest.fn(),
  createQueryBuilder: jest.fn(),
});

const activeDiscount = (overrides: Record<string, unknown> = {}) => ({
  discountId: '1',
  discountCode: 'NPK10',
  discountName: 'NPK 10%',
  discountType: DiscountType.PERCENT,
  appliesTo: DiscountApplyTarget.ORDER,
  startAt: new Date('2026-01-01T00:00:00.000Z'),
  expireDate: new Date('2027-01-01T00:00:00.000Z'),
  userId: null,
  discountDescription: null,
  discountValue: '10.00',
  isActive: true,
  usageLimit: null,
  usedCount: 0,
  minOrderValue: '0.00',
  maxDiscountAmount: null,
  approvalStatus: DiscountApprovalStatus.NOT_REQUIRED,
  approvedBy: null,
  approvedAt: null,
  approvalNote: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  ...overrides,
});

describe('DiscountsService voucher business rules', () => {
  let service: DiscountsService;
  let discountsRepository: MockRepository;
  let discountCategoriesRepository: MockRepository;
  let discountProductsRepository: MockRepository;
  let couponUsageRepository: MockRepository;
  let savedVoucherRepository: MockRepository;
  let productsRepository: MockRepository;

  beforeEach(() => {
    discountsRepository = createRepositoryMock();
    discountCategoriesRepository = createRepositoryMock();
    discountProductsRepository = createRepositoryMock();
    couponUsageRepository = createRepositoryMock();
    savedVoucherRepository = createRepositoryMock();
    productsRepository = createRepositoryMock();

    service = new DiscountsService(
      discountsRepository as never,
      discountCategoriesRepository as never,
      discountProductsRepository as never,
      couponUsageRepository as never,
      savedVoucherRepository as never,
      createRepositoryMock() as never,
      productsRepository as never,
    );
  });

  it('calculates product voucher discount only from eligible cart lines', async () => {
    discountsRepository.findOneBy?.mockResolvedValue(
      activeDiscount({
        appliesTo: DiscountApplyTarget.PRODUCT,
        discountValue: '10.00',
      }),
    );
    couponUsageRepository.countBy?.mockResolvedValue(0);
    productsRepository.find?.mockResolvedValue([
      { productId: 'p-1', categoryId: 'c-1' },
      { productId: 'p-2', categoryId: 'c-2' },
    ]);
    discountProductsRepository.find?.mockResolvedValue([
      { discountId: '1', productId: 'p-1' },
    ]);

    const result = await service.validateCoupon('user-1', {
      discountCode: 'npk10',
      orderValue: '300000',
      productIds: ['p-1', 'p-2'],
      items: [
        { productId: 'p-1', quantity: '1', unitPrice: '100000' },
        { productId: 'p-2', quantity: '1', unitPrice: '200000' },
      ],
    });

    expect(result.discountAmount).toBe('10000.00');
    expect(result.finalPrice).toBe('290000.00');
  });

  it('rejects active but unapproved deep-discount vouchers', async () => {
    discountsRepository.findOneBy?.mockResolvedValue(
      activeDiscount({
        approvalStatus: DiscountApprovalStatus.PENDING_APPROVAL,
      }),
    );

    await expect(
      service.validateCoupon('user-1', {
        discountCode: 'NPK10',
        orderValue: '300000',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('deactivates instead of deleting a voucher that already has usage history', async () => {
    const discount = activeDiscount();
    discountsRepository.findOneBy?.mockResolvedValue(discount);
    discountCategoriesRepository.find?.mockResolvedValue([]);
    discountProductsRepository.find?.mockResolvedValue([]);
    couponUsageRepository.countBy?.mockResolvedValue(2);
    couponUsageRepository.createQueryBuilder?.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ count: '1' }),
    });

    const result = await service.remove('1');

    expect(result).toMatchObject({ success: true, archived: true });
    expect(discountsRepository.remove).not.toHaveBeenCalled();
    expect(discountsRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ isActive: false }),
    );
  });
});
