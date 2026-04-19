import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, MoreThanOrEqual, LessThanOrEqual, Repository } from 'typeorm';
import { CouponUsageEntity } from '../discounts/entities/coupon-usage.entity';
import { DiscountEntity } from '../discounts/entities/discount.entity';
import { OrderItemEntity } from '../orders/entities/order-item.entity';
import {
  OrderEntity,
  OrderStatus,
  PaymentStatus,
} from '../orders/entities/order.entity';
import { InventoryTransactionEntity } from '../products/entities/inventory-transaction.entity';
import { ProductEntity } from '../products/entities/product.entity';
import { UserEntity } from '../users/entities/user.entity';
import { QueryCouponUsageDto } from './dto/query-coupon-usage.dto';
import { QuerySalesSummaryDto } from './dto/query-sales-summary.dto';

@Injectable()
export class ReportsService {
  constructor(
    @InjectRepository(OrderEntity)
    private readonly ordersRepository: Repository<OrderEntity>,
    @InjectRepository(OrderItemEntity)
    private readonly orderItemsRepository: Repository<OrderItemEntity>,
    @InjectRepository(ProductEntity)
    private readonly productsRepository: Repository<ProductEntity>,
    @InjectRepository(UserEntity)
    private readonly usersRepository: Repository<UserEntity>,
    @InjectRepository(InventoryTransactionEntity)
    private readonly inventoryTransactionsRepository: Repository<InventoryTransactionEntity>,
    @InjectRepository(DiscountEntity)
    private readonly discountsRepository: Repository<DiscountEntity>,
    @InjectRepository(CouponUsageEntity)
    private readonly couponUsageRepository: Repository<CouponUsageEntity>,
  ) {}

  async getDashboard() {
    const [
      totalUsers,
      totalProducts,
      totalOrders,
      pendingOrders,
      paidOrders,
      revenueRow,
      lowStockProducts,
      activeDiscounts,
      couponUsageCount,
    ] = await Promise.all([
      this.usersRepository.count(),
      this.productsRepository.count(),
      this.ordersRepository.count(),
      this.ordersRepository.count({
        where: { orderStatus: OrderStatus.PENDING },
      }),
      this.ordersRepository.count({
        where: { paymentStatus: PaymentStatus.PAID },
      }),
      this.ordersRepository
        .createQueryBuilder('order')
        .select('COALESCE(SUM(order.total_payment), 0)', 'revenue')
        .where('order.order_status IN (:...statuses)', {
          statuses: [
            OrderStatus.CONFIRMED,
            OrderStatus.PROCESSING,
            OrderStatus.SHIPPING,
            OrderStatus.DELIVERED,
          ],
        })
        .getRawOne<{ revenue: string }>(),
      this.productsRepository.count({
        where: { quantityAvailable: LessThanOrEqual(10) },
      }),
      this.discountsRepository.count({
        where: { isActive: true },
      }),
      this.couponUsageRepository.count(),
    ]);

    const topProducts = await this.orderItemsRepository
      .createQueryBuilder('item')
      .select('item.product_id', 'productId')
      .addSelect('item.product_name', 'productName')
      .addSelect('SUM(item.quantity)', 'soldQuantity')
      .addSelect('SUM(item.line_total)', 'revenue')
      .groupBy('item.product_id')
      .addGroupBy('item.product_name')
      .orderBy('SUM(item.quantity)', 'DESC')
      .limit(5)
      .getRawMany();

    const inventorySummary = await this.inventoryTransactionsRepository
      .createQueryBuilder('transaction')
      .select('transaction.transaction_type', 'transactionType')
      .addSelect('COUNT(*)', 'count')
      .groupBy('transaction.transaction_type')
      .getRawMany();

    const salesByDay = await this.ordersRepository
      .createQueryBuilder('order')
      .select('DATE(order.created_at)', 'date')
      .addSelect('COUNT(*)', 'orders')
      .addSelect('COALESCE(SUM(order.total_payment), 0)', 'revenue')
      .where('order.order_status IN (:...statuses)', {
        statuses: [
          OrderStatus.CONFIRMED,
          OrderStatus.PROCESSING,
          OrderStatus.SHIPPING,
          OrderStatus.DELIVERED,
        ],
      })
      .groupBy('DATE(order.created_at)')
      .orderBy('DATE(order.created_at)', 'ASC')
      .getRawMany();

    const topCustomers = await this.ordersRepository
      .createQueryBuilder('order')
      .select('order.user_id', 'userId')
      .addSelect('order.full_name', 'fullName')
      .addSelect('order.phone', 'phone')
      .addSelect('COUNT(*)', 'orders')
      .addSelect('COALESCE(SUM(order.total_payment), 0)', 'revenue')
      .where('order.order_status IN (:...statuses)', {
        statuses: [
          OrderStatus.CONFIRMED,
          OrderStatus.PROCESSING,
          OrderStatus.SHIPPING,
          OrderStatus.DELIVERED,
        ],
      })
      .groupBy('order.user_id')
      .addGroupBy('order.full_name')
      .addGroupBy('order.phone')
      .orderBy('COALESCE(SUM(order.total_payment), 0)', 'DESC')
      .limit(5)
      .getRawMany();

    return {
      totals: {
        users: totalUsers,
        products: totalProducts,
        orders: totalOrders,
        pendingOrders,
        paidOrders,
        revenue: revenueRow?.revenue ?? '0',
        lowStockProducts,
        activeDiscounts,
        couponUsageCount,
      },
      topProducts,
      inventorySummary,
      salesByDay,
      topCustomers,
    };
  }

  async getSalesSummary(query: QuerySalesSummaryDto) {
    const where = this.buildDateRangeWhere(query);

    const [
      orders,
      orderStatusSummary,
      paymentSummary,
      salesByDay,
      topCustomers,
    ] = await Promise.all([
      this.ordersRepository.find({
        where,
        order: { createdAt: 'DESC' },
      }),
      this.ordersRepository
        .createQueryBuilder('order')
        .select('order.order_status', 'status')
        .addSelect('COUNT(*)', 'count')
        .where(this.buildDateRangeSql('order.created_at', query))
        .groupBy('order.order_status')
        .getRawMany(),
      this.ordersRepository
        .createQueryBuilder('order')
        .select('order.payment_status', 'paymentStatus')
        .addSelect('COUNT(*)', 'count')
        .where(this.buildDateRangeSql('order.created_at', query))
        .groupBy('order.payment_status')
        .getRawMany(),
      this.ordersRepository
        .createQueryBuilder('order')
        .select('DATE(order.created_at)', 'date')
        .addSelect('COUNT(*)', 'orders')
        .addSelect('COALESCE(SUM(order.total_payment), 0)', 'revenue')
        .where(this.buildDateRangeSql('order.created_at', query))
        .groupBy('DATE(order.created_at)')
        .orderBy('DATE(order.created_at)', 'ASC')
        .getRawMany(),
      this.ordersRepository
        .createQueryBuilder('order')
        .select('order.user_id', 'userId')
        .addSelect('order.full_name', 'fullName')
        .addSelect('order.phone', 'phone')
        .addSelect('COUNT(*)', 'orders')
        .addSelect('COALESCE(SUM(order.total_payment), 0)', 'revenue')
        .where(this.buildDateRangeSql('order.created_at', query))
        .groupBy('order.user_id')
        .addGroupBy('order.full_name')
        .addGroupBy('order.phone')
        .orderBy('COALESCE(SUM(order.total_payment), 0)', 'DESC')
        .limit(10)
        .getRawMany(),
    ]);

    const totalRevenue = orders
      .filter((order) =>
        [
          OrderStatus.CONFIRMED,
          OrderStatus.PROCESSING,
          OrderStatus.SHIPPING,
          OrderStatus.DELIVERED,
        ].includes(order.orderStatus),
      )
      .reduce((sum, order) => sum + Number(order.totalPayment), 0);

    const totalDiscount = orders.reduce(
      (sum, order) => sum + Number(order.discountAmount),
      0,
    );

    const totalDeliveryRevenue = orders.reduce(
      (sum, order) => sum + Number(order.deliveryCost),
      0,
    );

    return {
      filters: {
        from: query.from ?? null,
        to: query.to ?? null,
      },
      summary: {
        orders: orders.length,
        revenue: totalRevenue.toFixed(2),
        discountAmount: totalDiscount.toFixed(2),
        deliveryRevenue: totalDeliveryRevenue.toFixed(2),
      },
      orderStatusSummary,
      paymentSummary,
      salesByDay,
      topCustomers,
    };
  }

  async getCouponUsage(query: QueryCouponUsageDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const queryBuilder = this.couponUsageRepository
      .createQueryBuilder('usage')
      .leftJoin(
        DiscountEntity,
        'discount',
        'discount.discount_id = usage.discount_id',
      )
      .leftJoin(UserEntity, 'user', 'user.user_id = usage.user_id')
      .select([
        'usage.couponUsageId AS id',
        'usage.discountId AS discountId',
        'usage.userId AS userId',
        'usage.orderId AS orderId',
        'usage.createdAt AS createdAt',
        'discount.discount_code AS discountCode',
        'discount.discount_name AS discountName',
        'user.username AS username',
        'user.email AS email',
      ]);

    if (query.discountId) {
      queryBuilder.andWhere('usage.discount_id = :discountId', {
        discountId: query.discountId,
      });
    }

    if (query.userId) {
      queryBuilder.andWhere('usage.user_id = :userId', {
        userId: query.userId,
      });
    }

    if (query.from) {
      queryBuilder.andWhere('usage.created_at >= :from', { from: query.from });
    }

    if (query.to) {
      queryBuilder.andWhere('usage.created_at <= :to', { to: query.to });
    }

    queryBuilder
      .orderBy('usage.created_at', 'DESC')
      .offset((page - 1) * limit)
      .limit(limit);

    const [items, total, summary] = await Promise.all([
      queryBuilder.getRawMany(),
      queryBuilder.getCount(),
      this.couponUsageRepository
        .createQueryBuilder('usage')
        .select('usage.discount_id', 'discountId')
        .addSelect('COUNT(*)', 'timesUsed')
        .groupBy('usage.discount_id')
        .orderBy('COUNT(*)', 'DESC')
        .getRawMany(),
    ]);

    return {
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      summary,
      items,
    };
  }

  private buildDateRangeWhere(query: QuerySalesSummaryDto) {
    if (query.from && query.to) {
      return {
        createdAt: Between(new Date(query.from), new Date(query.to)),
      };
    }

    if (query.from) {
      return {
        createdAt: MoreThanOrEqual(new Date(query.from)),
      };
    }

    if (query.to) {
      return {
        createdAt: LessThanOrEqual(new Date(query.to)),
      };
    }

    return {};
  }

  private buildDateRangeSql(column: string, query: QuerySalesSummaryDto) {
    if (query.from && query.to) {
      return `${column} BETWEEN '${query.from}' AND '${query.to}'`;
    }

    if (query.from) {
      return `${column} >= '${query.from}'`;
    }

    if (query.to) {
      return `${column} <= '${query.to}'`;
    }

    return '1=1';
  }
}
