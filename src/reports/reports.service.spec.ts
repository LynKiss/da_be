import { OrderStatus } from '../orders/entities/order.entity';
import { ReportsService } from './reports.service';

const createQueryBuilder = (rawMany: unknown[] = []) => {
  const qb = {
    select: jest.fn(),
    addSelect: jest.fn(),
    where: jest.fn(),
    andWhere: jest.fn(),
    groupBy: jest.fn(),
    addGroupBy: jest.fn(),
    orderBy: jest.fn(),
    limit: jest.fn(),
    leftJoin: jest.fn(),
    getRawMany: jest.fn().mockResolvedValue(rawMany),
  };
  Object.values(qb)
    .filter((item) => typeof item === 'function')
    .forEach((item) => {
      if (item !== qb.getRawMany) {
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
