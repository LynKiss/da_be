import { OrderStatus } from '../orders/entities/order.entity';
import { ReportsService } from './reports.service';

const createQueryBuilder = (rawMany: unknown[] = [], rawOne: unknown = { amount: '0' }) => {
  const qb = {
    select: jest.fn(),
    addSelect: jest.fn(),
    where: jest.fn(),
    andWhere: jest.fn(),
    groupBy: jest.fn(),
    addGroupBy: jest.fn(),
    orderBy: jest.fn(),
    limit: jest.fn(),
    offset: jest.fn(),
    take: jest.fn(),
    skip: jest.fn(),
    leftJoin: jest.fn(),
    innerJoin: jest.fn(),
    getRawMany: jest.fn().mockResolvedValue(rawMany),
    getRawOne: jest.fn().mockResolvedValue(rawOne),
  };
  Object.values(qb)
    .filter((item) => typeof item === 'function')
    .forEach((item) => {
      if (item !== qb.getRawMany && item !== qb.getRawOne) {
        (item as jest.Mock).mockReturnValue(qb);
      }
    });
  return qb;
};

describe('ReportsService sales revenue policy', () => {
  it('subtracts completed refund ledger rows only for fulfilled orders', async () => {
    const orderBuilders = [
      createQueryBuilder(),
      createQueryBuilder(),
      createQueryBuilder(),
      createQueryBuilder(),
    ];
    const ordersRepository = {
      find: jest.fn().mockResolvedValue([
        {
          orderId: 'delivered-1',
          orderStatus: OrderStatus.DELIVERED,
          totalPayment: '100000.00',
          discountAmount: '5000.00',
          deliveryCost: '15000.00',
        },
        {
          orderId: 'pending-1',
          orderStatus: OrderStatus.PENDING,
          totalPayment: '900000.00',
          discountAmount: '0.00',
          deliveryCost: '0.00',
        },
      ]),
      createQueryBuilder: jest
        .fn()
        .mockImplementation(() => orderBuilders.shift() ?? createQueryBuilder()),
    };
    const refundsBuilder = createQueryBuilder([
      { orderId: 'delivered-1', amount: '25000.00' },
    ]);
    const refundsRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(refundsBuilder),
    };
    const emptyRepository = {};

    const service = new ReportsService(
      ordersRepository as never,
      emptyRepository as never,
      emptyRepository as never,
      emptyRepository as never,
      emptyRepository as never,
      emptyRepository as never,
      emptyRepository as never,
      emptyRepository as never,
      emptyRepository as never,
      emptyRepository as never,
      emptyRepository as never,
      emptyRepository as never,
      emptyRepository as never,
      refundsRepository as never,
      emptyRepository as never,
      {} as never,
    );

    await expect(service.getSalesSummary({})).resolves.toMatchObject({
      summary: {
        revenue: '75000.00',
        discountAmount: '5000.00',
        deliveryRevenue: '15000.00',
        revenuePolicy:
          'financial_v1_completed_fulfillment_less_completed_refunds',
      },
    });
    expect(refundsBuilder.andWhere).toHaveBeenCalledWith(
      'refund.refund_status = :status',
      expect.objectContaining({ status: 'completed' }),
    );
  });
});

describe('ReportsService profitability policy', () => {
  const buildService = ({
    revenueRows,
    cogsRows,
    products,
    unallocatedRefund = '0',
  }: {
    revenueRows: unknown[];
    cogsRows: unknown[];
    products: unknown[];
    unallocatedRefund?: string;
  }) => {
    const orderItemsRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(createQueryBuilder(revenueRows)),
    };
    const inventoryTransactionsRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(createQueryBuilder(cogsRows)),
    };
    const productsRepository = {
      findBy: jest.fn().mockResolvedValue(products),
    };
    const refundsRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(createQueryBuilder([], { amount: unallocatedRefund })),
    };
    const emptyRepository = {};

    return new ReportsService(
      emptyRepository as never,
      orderItemsRepository as never,
      productsRepository as never,
      emptyRepository as never,
      inventoryTransactionsRepository as never,
      emptyRepository as never,
      emptyRepository as never,
      emptyRepository as never,
      emptyRepository as never,
      emptyRepository as never,
      emptyRepository as never,
      emptyRepository as never,
      emptyRepository as never,
      refundsRepository as never,
      emptyRepository as never,
      {} as never,
    );
  };

  it('uses transaction COGS and report-wide totals independent of pagination', async () => {
    const service = buildService({
      revenueRows: [
        {
          productId: 'p1',
          productName: 'Phân hữu cơ',
          soldQty: '10',
          returnedQty: '2',
          grossRevenue: '1000',
          discountAllocated: '0',
          revenueBeforeRefund: '1000',
          refundAllocated: '200',
          revenue: '800',
        },
        {
          productId: 'p2',
          productName: 'Hạt giống',
          soldQty: '1',
          returnedQty: '0',
          grossRevenue: '300',
          discountAllocated: '0',
          revenueBeforeRefund: '300',
          refundAllocated: '0',
          revenue: '300',
        },
      ],
      cogsRows: [
        {
          productId: 'p1',
          transactionCogs: '500',
          qtyWithTransactionCost: '8',
          transactionQty: '8',
          zeroCostTransactionQty: '0',
        },
        {
          productId: 'p2',
          transactionCogs: '0',
          qtyWithTransactionCost: '0',
          transactionQty: '0',
          zeroCostTransactionQty: '1',
        },
      ],
      products: [
        { productId: 'p1', avgCost: '60', costPrice: '70' },
        { productId: 'p2', avgCost: '100', costPrice: '120' },
      ],
    });

    const result = await service.getProfitability({ groupBy: 'product', page: 1, limit: 1 });

    expect(result.items).toHaveLength(1);
    expect(result.meta).toMatchObject({
      total: 2,
      totalRevenue: 1100,
      totalCOGS: 600,
      grossProfit: 500,
      totalRefund: 200,
      fallbackRows: 1,
      unreliableCogs: true,
    });
    expect(result.items[0]).toMatchObject({
      productId: 'p1',
      netSoldQty: 8,
      cogs: 500,
      cogsSource: 'transaction',
      grossProfit: 300,
    });
  });

  it('keeps missing COGS visible instead of hiding it with zero-cost profit', async () => {
    const service = buildService({
      revenueRows: [
        {
          productId: 'p1',
          productName: 'Thuốc BVTV',
          soldQty: '3',
          returnedQty: '0',
          grossRevenue: '900',
          discountAllocated: '0',
          revenueBeforeRefund: '900',
          refundAllocated: '0',
          revenue: '900',
        },
      ],
      cogsRows: [],
      products: [{ productId: 'p1', avgCost: '0', costPrice: null }],
    });

    const result = await service.getProfitability({ groupBy: 'product' });

    expect(result.items[0]).toMatchObject({
      cogs: 0,
      cogsSource: 'missing',
      missingCostQty: 3,
      warnings: ['MISSING_COST_SOURCE'],
    });
    expect(result.meta).toMatchObject({
      missingCostQty: 3,
      unreliableCogs: true,
    });
  });

  it('returns COGS, profit, and margin for day/month grouping', async () => {
    const service = buildService({
      revenueRows: [
        {
          productId: 'p1',
          productName: 'Phân bón',
          period: '2026-05-26',
          soldQty: '2',
          returnedQty: '0',
          grossRevenue: '1000',
          discountAllocated: '0',
          revenueBeforeRefund: '1000',
          refundAllocated: '0',
          revenue: '1000',
        },
      ],
      cogsRows: [
        {
          productId: 'p1',
          period: '2026-05-26',
          transactionCogs: '600',
          qtyWithTransactionCost: '2',
          transactionQty: '2',
          zeroCostTransactionQty: '0',
        },
      ],
      products: [{ productId: 'p1', avgCost: '300', costPrice: '300' }],
    });

    const result = await service.getProfitability({ groupBy: 'day' });

    expect(result.items).toEqual([
      expect.objectContaining({
        period: '2026-05-26',
        revenue: 1000,
        cogs: 600,
        grossProfit: 400,
        marginPct: 40,
      }),
    ]);
  });
});
