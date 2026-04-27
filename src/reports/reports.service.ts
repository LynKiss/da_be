import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, MoreThanOrEqual, LessThanOrEqual, Repository } from 'typeorm';
import { CategoryEntity } from '../categories/entities/category.entity';
import { CommentEntity, ProductCommentStatus } from '../comments/entities/comment.entity';
import { SimpleCacheService } from '../common/simple-cache.service';
import { CouponUsageEntity } from '../discounts/entities/coupon-usage.entity';
import { DiscountEntity } from '../discounts/entities/discount.entity';
import { OrderItemEntity } from '../orders/entities/order-item.entity';
import {
  OrderEntity,
  OrderStatus,
  PaymentStatus,
} from '../orders/entities/order.entity';
import { PurchaseOrderEntity, PurchaseOrderStatus } from '../procurement/entities/purchase-order.entity';
import { InventoryTransactionEntity } from '../products/entities/inventory-transaction.entity';
import { ProductEntity } from '../products/entities/product.entity';
import { RiceDiagnosisHistoryEntity } from '../rice-diagnosis/entities/rice-diagnosis-history.entity';
import { UserEntity, UserRole } from '../users/entities/user.entity';
import { QueryCouponUsageDto } from './dto/query-coupon-usage.dto';
import { QueryInventoryLedgerDto, QueryProfitabilityDto, QueryAgingDebtDto, RecordPoPaymentDto } from './dto/query-inventory-ledger.dto';
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
    @InjectRepository(CategoryEntity)
    private readonly categoriesRepository: Repository<CategoryEntity>,
    @InjectRepository(CommentEntity)
    private readonly commentsRepository: Repository<CommentEntity>,
    @InjectRepository(RiceDiagnosisHistoryEntity)
    private readonly riceDiagnosisHistoryRepository: Repository<RiceDiagnosisHistoryEntity>,

    @InjectRepository(PurchaseOrderEntity)
    private readonly poRepository: Repository<PurchaseOrderEntity>,

    private readonly cache: SimpleCacheService,
  ) {}

  async getDashboard() {
    const revenueStatuses = [
      OrderStatus.CONFIRMED,
      OrderStatus.PROCESSING,
      OrderStatus.SHIPPING,
      OrderStatus.DELIVERED,
      OrderStatus.PARTIAL_DELIVERED,
    ];

    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);

    const last7DaysStart = new Date(todayStart);
    last7DaysStart.setDate(last7DaysStart.getDate() - 6);

    const last30DaysStart = new Date(todayStart);
    last30DaysStart.setDate(last30DaysStart.getDate() - 29);

    const next30Days = new Date(todayStart);
    next30Days.setDate(next30Days.getDate() + 30);

    const revenueQuery = (from?: Date, to?: Date) => {
      const qb = this.ordersRepository
        .createQueryBuilder('order')
        .select('COALESCE(SUM(order.total_payment), 0)', 'revenue')
        .where('order.order_status IN (:...statuses)', {
          statuses: revenueStatuses,
        });

      if (from) {
        qb.andWhere('order.created_at >= :from', { from });
      }

      if (to) {
        qb.andWhere('order.created_at < :to', { to });
      }

      return qb.getRawOne<{ revenue: string }>();
    };

    const [
      totalUsers,
      totalCustomers,
      activeCustomers,
      totalProducts,
      totalCategories,
      totalOrders,
      pendingOrders,
      cancelledOrders,
      deliveredOrders,
      paidOrders,
      revenueRow,
      todayOrders,
      todayRevenueRow,
      yesterdayRevenueRow,
      last7RevenueRow,
      last30RevenueRow,
      lowStockProducts,
      outOfStockProducts,
      expiredSoonProducts,
      activeDiscounts,
      couponUsageCount,
      inventoryValueRow,
      visibleReviews,
      avgReviewRow,
      totalDiagnoses,
    ] = await Promise.all([
      this.usersRepository.count(),
      this.usersRepository.count({ where: { role: UserRole.CUSTOMER } }),
      this.usersRepository.count({
        where: { role: UserRole.CUSTOMER, isActive: true },
      }),
      this.productsRepository.count(),
      this.categoriesRepository.count(),
      this.ordersRepository.count(),
      this.ordersRepository.count({
        where: { orderStatus: OrderStatus.PENDING },
      }),
      this.ordersRepository.count({
        where: { orderStatus: OrderStatus.CANCELLED },
      }),
      this.ordersRepository.count({
        where: { orderStatus: OrderStatus.DELIVERED },
      }),
      this.ordersRepository.count({
        where: { paymentStatus: PaymentStatus.PAID },
      }),
      revenueQuery(),
      this.ordersRepository
        .createQueryBuilder('order')
        .where('order.created_at >= :todayStart', { todayStart })
        .getCount(),
      revenueQuery(todayStart),
      revenueQuery(yesterdayStart, todayStart),
      revenueQuery(last7DaysStart),
      revenueQuery(last30DaysStart),
      this.productsRepository.count({
        where: { quantityAvailable: LessThanOrEqual(10) },
      }),
      this.productsRepository.count({
        where: { quantityAvailable: LessThanOrEqual(0) },
      }),
      this.productsRepository
        .createQueryBuilder('product')
        .where('product.expired_at IS NOT NULL')
        .andWhere('product.expired_at <= :next30Days', { next30Days })
        .getCount(),
      this.discountsRepository.count({
        where: { isActive: true },
      }),
      this.couponUsageRepository.count(),
      this.productsRepository
        .createQueryBuilder('product')
        .select('COALESCE(SUM(product.quantity_available), 0)', 'availableUnits')
        .addSelect('COALESCE(SUM(product.quantity_reserved), 0)', 'reservedUnits')
        .addSelect(
          'COALESCE(SUM(product.quantity_available * COALESCE(product.avg_cost, 0)), 0)',
          'inventoryValue',
        )
        .addSelect(
          'COALESCE(SUM(product.quantity_available * product.product_price), 0)',
          'potentialRevenue',
        )
        .getRawOne<{
          availableUnits: string;
          reservedUnits: string;
          inventoryValue: string;
          potentialRevenue: string;
        }>(),
      this.commentsRepository.count({
        where: { status: ProductCommentStatus.VISIBLE },
      }),
      this.commentsRepository
        .createQueryBuilder('comment')
        .select('COALESCE(AVG(comment.rating), 0)', 'averageRating')
        .where('comment.status = :status', {
          status: ProductCommentStatus.VISIBLE,
        })
        .andWhere('comment.rating IS NOT NULL')
        .getRawOne<{ averageRating: string }>(),
      this.riceDiagnosisHistoryRepository.count(),
    ]);

    const topProducts = await this.orderItemsRepository
      .createQueryBuilder('item')
      .innerJoin(OrderEntity, 'order', 'order.order_id = item.order_id')
      .select('item.product_id', 'productId')
      .addSelect('item.product_name', 'productName')
      .addSelect('SUM(item.quantity)', 'soldQuantity')
      .addSelect('SUM(item.line_total)', 'revenue')
      .where('order.order_status IN (:...statuses)', {
        statuses: revenueStatuses,
      })
      .groupBy('item.product_id')
      .addGroupBy('item.product_name')
      .orderBy('SUM(item.quantity)', 'DESC')
      .limit(10)
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
        statuses: revenueStatuses,
      })
      .andWhere('order.created_at >= :from', { from: last30DaysStart })
      .groupBy('DATE(order.created_at)')
      .orderBy('DATE(order.created_at)', 'ASC')
      .getRawMany();

    const salesByMonth = await this.ordersRepository
      .createQueryBuilder('order')
      .select("DATE_FORMAT(order.created_at, '%Y-%m')", 'period')
      .addSelect('COUNT(*)', 'orders')
      .addSelect('COALESCE(SUM(order.total_payment), 0)', 'revenue')
      .where('order.order_status IN (:...statuses)', {
        statuses: revenueStatuses,
      })
      .andWhere('order.created_at >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)')
      .groupBy('period')
      .orderBy('period', 'ASC')
      .getRawMany();

    const salesByHour = await this.ordersRepository
      .createQueryBuilder('order')
      .select('HOUR(order.created_at)', 'hour')
      .addSelect('COUNT(*)', 'orders')
      .addSelect('COALESCE(SUM(order.total_payment), 0)', 'revenue')
      .where('order.order_status IN (:...statuses)', {
        statuses: revenueStatuses,
      })
      .andWhere('order.created_at >= :from', { from: last30DaysStart })
      .groupBy('hour')
      .orderBy('hour', 'ASC')
      .getRawMany();

    const orderStatusSummary = await this.ordersRepository
      .createQueryBuilder('order')
      .select('order.order_status', 'status')
      .addSelect('COUNT(*)', 'count')
      .addSelect('COALESCE(SUM(order.total_payment), 0)', 'revenue')
      .groupBy('order.order_status')
      .orderBy('COUNT(*)', 'DESC')
      .getRawMany();

    const paymentSummary = await this.ordersRepository
      .createQueryBuilder('order')
      .select('order.payment_status', 'paymentStatus')
      .addSelect('COUNT(*)', 'count')
      .addSelect('COALESCE(SUM(order.total_payment), 0)', 'revenue')
      .groupBy('order.payment_status')
      .orderBy('COUNT(*)', 'DESC')
      .getRawMany();

    const paymentMethodSummary = await this.ordersRepository
      .createQueryBuilder('order')
      .select('order.payment_method', 'paymentMethod')
      .addSelect('COUNT(*)', 'count')
      .addSelect('COALESCE(SUM(order.total_payment), 0)', 'revenue')
      .groupBy('order.payment_method')
      .orderBy('COUNT(*)', 'DESC')
      .getRawMany();

    const categoryRevenue = await this.orderItemsRepository
      .createQueryBuilder('item')
      .innerJoin(OrderEntity, 'order', 'order.order_id = item.order_id')
      .innerJoin(ProductEntity, 'product', 'product.product_id = item.product_id')
      .leftJoin(CategoryEntity, 'category', 'category.category_id = product.category_id')
      .select("COALESCE(category.category_name, 'Chua phan loai')", 'categoryName')
      .addSelect('COUNT(DISTINCT order.order_id)', 'orders')
      .addSelect('SUM(item.quantity)', 'soldQuantity')
      .addSelect('COALESCE(SUM(item.line_total), 0)', 'revenue')
      .where('order.order_status IN (:...statuses)', {
        statuses: revenueStatuses,
      })
      .groupBy('category.category_id')
      .addGroupBy('category.category_name')
      .orderBy('SUM(item.line_total)', 'DESC')
      .limit(8)
      .getRawMany();

    const inventoryByCategory = await this.productsRepository
      .createQueryBuilder('product')
      .leftJoin(CategoryEntity, 'category', 'category.category_id = product.category_id')
      .select("COALESCE(category.category_name, 'Chua phan loai')", 'categoryName')
      .addSelect('COUNT(*)', 'products')
      .addSelect('COALESCE(SUM(product.quantity_available), 0)', 'availableUnits')
      .addSelect('COALESCE(SUM(product.quantity_reserved), 0)', 'reservedUnits')
      .addSelect(
        'COALESCE(SUM(product.quantity_available * COALESCE(product.avg_cost, 0)), 0)',
        'inventoryValue',
      )
      .groupBy('category.category_id')
      .addGroupBy('category.category_name')
      .orderBy('SUM(product.quantity_available)', 'DESC')
      .limit(8)
      .getRawMany();

    const stockHealth = await this.productsRepository
      .createQueryBuilder('product')
      .select(
        `CASE
          WHEN product.quantity_available <= 0 THEN 'out'
          WHEN product.quantity_available <= 10 THEN 'low'
          WHEN product.quantity_available <= 50 THEN 'medium'
          ELSE 'healthy'
        END`,
        'level',
      )
      .addSelect('COUNT(*)', 'count')
      .addSelect('COALESCE(SUM(product.quantity_available), 0)', 'quantity')
      .groupBy('level')
      .orderBy('COUNT(*)', 'DESC')
      .getRawMany();

    const lowStockProductList = await this.productsRepository
      .createQueryBuilder('product')
      .select('product.product_id', 'productId')
      .addSelect('product.product_name', 'productName')
      .addSelect('product.quantity_available', 'quantityAvailable')
      .addSelect('product.quantity_reserved', 'quantityReserved')
      .addSelect('product.product_price', 'productPrice')
      .where('product.quantity_available <= :threshold', { threshold: 10 })
      .orderBy('product.quantity_available', 'ASC')
      .limit(10)
      .getRawMany();

    const stockRiskProducts = await this.orderItemsRepository
      .createQueryBuilder('item')
      .innerJoin(OrderEntity, 'order', 'order.order_id = item.order_id')
      .innerJoin(ProductEntity, 'product', 'product.product_id = item.product_id')
      .select('item.product_id', 'productId')
      .addSelect('item.product_name', 'productName')
      .addSelect('product.quantity_available', 'quantityAvailable')
      .addSelect('SUM(item.quantity)', 'soldLast30')
      .addSelect(
        'ROUND(product.quantity_available / NULLIF(SUM(item.quantity) / 30, 0), 1)',
        'daysOfCover',
      )
      .where('order.order_status IN (:...statuses)', {
        statuses: revenueStatuses,
      })
      .andWhere('order.created_at >= :from', { from: last30DaysStart })
      .groupBy('item.product_id')
      .addGroupBy('item.product_name')
      .addGroupBy('product.quantity_available')
      .having('SUM(item.quantity) > 0')
      .orderBy('daysOfCover', 'ASC')
      .limit(8)
      .getRawMany();

    const topCustomers = await this.ordersRepository
      .createQueryBuilder('order')
      .select('order.user_id', 'userId')
      .addSelect('order.full_name', 'fullName')
      .addSelect('order.phone', 'phone')
      .addSelect('COUNT(*)', 'orders')
      .addSelect('COALESCE(SUM(order.total_payment), 0)', 'revenue')
      .where('order.order_status IN (:...statuses)', {
        statuses: revenueStatuses,
      })
      .groupBy('order.user_id')
      .addGroupBy('order.full_name')
      .addGroupBy('order.phone')
      .orderBy('COALESCE(SUM(order.total_payment), 0)', 'DESC')
      .limit(10)
      .getRawMany();

    const customerSpendRows = await this.ordersRepository
      .createQueryBuilder('order')
      .select('order.user_id', 'userId')
      .addSelect('COUNT(*)', 'orders')
      .addSelect('COALESCE(SUM(order.total_payment), 0)', 'revenue')
      .where('order.order_status IN (:...statuses)', {
        statuses: revenueStatuses,
      })
      .groupBy('order.user_id')
      .getRawMany<{ userId: string; orders: string; revenue: string }>();

    const customerSegments = [
      {
        segment: 'Chua mua',
        count: Math.max(totalCustomers - customerSpendRows.length, 0),
        revenue: '0',
      },
      {
        segment: 'Mua 1 lan',
        count: customerSpendRows.filter((row) => Number(row.orders) === 1).length,
        revenue: customerSpendRows
          .filter((row) => Number(row.orders) === 1)
          .reduce((sum, row) => sum + Number(row.revenue), 0)
          .toFixed(2),
      },
      {
        segment: 'Lap lai',
        count: customerSpendRows.filter((row) => {
          const orders = Number(row.orders);
          return orders >= 2 && orders <= 4;
        }).length,
        revenue: customerSpendRows
          .filter((row) => {
            const orders = Number(row.orders);
            return orders >= 2 && orders <= 4;
          })
          .reduce((sum, row) => sum + Number(row.revenue), 0)
          .toFixed(2),
      },
      {
        segment: 'Than thiet',
        count: customerSpendRows.filter((row) => Number(row.orders) >= 5).length,
        revenue: customerSpendRows
          .filter((row) => Number(row.orders) >= 5)
          .reduce((sum, row) => sum + Number(row.revenue), 0)
          .toFixed(2),
      },
    ];

    const newCustomersByDay = await this.usersRepository
      .createQueryBuilder('user')
      .select('DATE(user.created_at)', 'date')
      .addSelect('COUNT(*)', 'customers')
      .where('user.role = :role', { role: UserRole.CUSTOMER })
      .andWhere('user.created_at >= :from', { from: last30DaysStart })
      .groupBy('DATE(user.created_at)')
      .orderBy('DATE(user.created_at)', 'ASC')
      .getRawMany();

    const couponEffectiveness = await this.discountsRepository
      .createQueryBuilder('discount')
      .leftJoin(CouponUsageEntity, 'usage', 'usage.discount_id = discount.discount_id')
      .leftJoin(OrderEntity, 'order', 'order.order_id = usage.order_id')
      .select('discount.discount_id', 'discountId')
      .addSelect('discount.discount_code', 'discountCode')
      .addSelect('discount.discount_name', 'discountName')
      .addSelect('discount.discount_type', 'discountType')
      .addSelect('discount.discount_value', 'discountValue')
      .addSelect('COUNT(usage.usage_id)', 'timesUsed')
      .addSelect('COALESCE(SUM(order.discount_amount), 0)', 'discountGiven')
      .addSelect('COALESCE(SUM(order.total_payment), 0)', 'orderRevenue')
      .groupBy('discount.discount_id')
      .addGroupBy('discount.discount_code')
      .addGroupBy('discount.discount_name')
      .addGroupBy('discount.discount_type')
      .addGroupBy('discount.discount_value')
      .orderBy('COUNT(usage.usage_id)', 'DESC')
      .limit(8)
      .getRawMany();

    const reviewSummary = await this.commentsRepository
      .createQueryBuilder('comment')
      .select('comment.rating', 'rating')
      .addSelect('COUNT(*)', 'count')
      .where('comment.status = :status', {
        status: ProductCommentStatus.VISIBLE,
      })
      .andWhere('comment.rating IS NOT NULL')
      .groupBy('comment.rating')
      .orderBy('comment.rating', 'ASC')
      .getRawMany();

    const diagnosesByDisease = await this.riceDiagnosisHistoryRepository
      .createQueryBuilder('diagnosis')
      .select(
        "COALESCE(diagnosis.predicted_disease_key, diagnosis.predicted_label, 'unknown')",
        'disease',
      )
      .addSelect('COUNT(*)', 'count')
      .addSelect('COALESCE(AVG(diagnosis.confidence), 0)', 'avgConfidence')
      .groupBy('disease')
      .orderBy('COUNT(*)', 'DESC')
      .limit(8)
      .getRawMany();

    const recentOrders = await this.ordersRepository.find({
      order: { createdAt: 'DESC' },
      take: 8,
    });

    const totalRevenue = Number(revenueRow?.revenue ?? 0);
    const todayRevenue = Number(todayRevenueRow?.revenue ?? 0);
    const yesterdayRevenue = Number(yesterdayRevenueRow?.revenue ?? 0);

    return {
      refreshedAt: now.toISOString(),
      filters: {
        salesFrom: last30DaysStart.toISOString(),
        salesTo: now.toISOString(),
      },
      totals: {
        users: totalUsers,
        customers: totalCustomers,
        activeCustomers,
        products: totalProducts,
        categories: totalCategories,
        orders: totalOrders,
        pendingOrders,
        cancelledOrders,
        deliveredOrders,
        paidOrders,
        revenue: totalRevenue.toFixed(2),
        todayOrders,
        todayRevenue: todayRevenue.toFixed(2),
        yesterdayRevenue: yesterdayRevenue.toFixed(2),
        revenueChangePct:
          yesterdayRevenue > 0
            ? Number((((todayRevenue - yesterdayRevenue) / yesterdayRevenue) * 100).toFixed(2))
            : todayRevenue > 0
              ? 100
              : 0,
        last7Revenue: Number(last7RevenueRow?.revenue ?? 0).toFixed(2),
        last30Revenue: Number(last30RevenueRow?.revenue ?? 0).toFixed(2),
        averageOrderValue:
          totalOrders > 0 ? (totalRevenue / totalOrders).toFixed(2) : '0.00',
        lowStockProducts,
        outOfStockProducts,
        expiredSoonProducts,
        activeDiscounts,
        couponUsageCount,
        availableUnits: Number(inventoryValueRow?.availableUnits ?? 0),
        reservedUnits: Number(inventoryValueRow?.reservedUnits ?? 0),
        inventoryValue: Number(inventoryValueRow?.inventoryValue ?? 0).toFixed(2),
        potentialRevenue: Number(inventoryValueRow?.potentialRevenue ?? 0).toFixed(2),
        visibleReviews,
        averageRating: Number(avgReviewRow?.averageRating ?? 0).toFixed(2),
        totalDiagnoses,
      },
      topProducts,
      inventorySummary,
      salesByDay,
      salesByMonth,
      salesByHour,
      orderStatusSummary,
      paymentSummary,
      paymentMethodSummary,
      categoryRevenue,
      inventoryByCategory,
      stockHealth,
      lowStockProductList,
      stockRiskProducts,
      topCustomers,
      customerSegments,
      newCustomersByDay,
      couponEffectiveness,
      reviewSummary,
      diagnosesByDisease,
      recentOrders: recentOrders.map((order) => ({
        id: order.orderId,
        orderId: order.orderId,
        fullName: order.fullName,
        totalPayment: order.totalPayment,
        status: order.orderStatus,
        paymentStatus: order.paymentStatus,
        createdAt: order.createdAt,
      })),
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

  // ─── Báo Cáo Giá Trị Tồn Kho ──────────────────────────────────────────────
  /**
   * Tổng giá trị tồn kho theo Moving Average Cost.
   * Mỗi sản phẩm: totalValue = quantityAvailable × avgCost
   * Total inventory value = SUM(qty × cost) trên toàn bộ catalog có tồn > 0
   * Dùng cho báo cáo tài chính, kiểm kê tài sản, đối soát kho.
   */
  async getInventoryValuation() {
    return this.cache.getOrCompute(
      'reports:inventory-valuation',
      120, // TTL 2 phút — không cần realtime tuyệt đối
      () => this.computeInventoryValuation(),
    );
  }

  private async computeInventoryValuation() {
    const products = await this.productsRepository
      .createQueryBuilder('p')
      .select([
        'p.product_id AS productId',
        'p.product_name AS productName',
        'p.quantity_available AS qtyAvailable',
        'p.quantity_reserved AS qtyReserved',
        'p.avg_cost AS avgCost',
        'p.cost_price AS lastCost',
        'p.product_price AS retailPrice',
      ])
      .where('p.quantity_available > 0 OR p.quantity_reserved > 0')
      .orderBy('p.quantity_available', 'DESC')
      .getRawMany<{
        productId: string;
        productName: string;
        qtyAvailable: number;
        qtyReserved: number;
        avgCost: string;
        lastCost: string | null;
        retailPrice: string;
      }>();

    const items = products.map((p) => {
      const qtyAvail = Number(p.qtyAvailable) || 0;
      const qtyResv = Number(p.qtyReserved) || 0;
      const avgCost = Number(p.avgCost) || 0;
      const retail = Number(p.retailPrice) || 0;
      const totalQty = qtyAvail + qtyResv;
      const totalValue = totalQty * avgCost;
      const potentialRevenue = totalQty * retail;
      const potentialProfit = potentialRevenue - totalValue;
      return {
        productId: p.productId,
        productName: p.productName,
        qtyAvailable: qtyAvail,
        qtyReserved: qtyResv,
        totalQty,
        avgCost,
        lastCost: Number(p.lastCost ?? 0),
        retailPrice: retail,
        totalValue,
        potentialRevenue,
        potentialProfit,
      };
    });

    const summary = items.reduce(
      (acc, it) => ({
        totalProducts: acc.totalProducts + 1,
        totalQty: acc.totalQty + it.totalQty,
        totalValue: acc.totalValue + it.totalValue,
        potentialRevenue: acc.potentialRevenue + it.potentialRevenue,
        potentialProfit: acc.potentialProfit + it.potentialProfit,
      }),
      {
        totalProducts: 0,
        totalQty: 0,
        totalValue: 0,
        potentialRevenue: 0,
        potentialProfit: 0,
      },
    );

    return {
      asOf: new Date(),
      summary,
      items,
    };
  }

  // ─── Sổ Kho Chi Tiết ──────────────────────────────────────────────────────

  async getInventoryLedger(query: QueryInventoryLedgerDto) {
    const { page = 1, limit = 30 } = query;

    const qb = this.inventoryTransactionsRepository
      .createQueryBuilder('tx')
      .orderBy('tx.createdAt', 'DESC');

    if (query.productId) qb.andWhere('tx.productId = :pid', { pid: query.productId });
    if (query.transactionType) qb.andWhere('tx.transactionType = :tt', { tt: query.transactionType });
    if (query.from) qb.andWhere('tx.createdAt >= :from', { from: query.from });
    if (query.to) qb.andWhere('tx.createdAt <= :to', { to: query.to });

    const total = await qb.getCount();
    const txs = await qb.skip((page - 1) * limit).take(limit).getMany();

    // Enrich with product names
    const productIds = [...new Set(txs.map((t) => t.productId))];
    let productMap: Record<string, string> = {};
    if (productIds.length > 0) {
      const products = await this.productsRepository.findBy({ productId: In(productIds) });
      productMap = Object.fromEntries(products.map((p) => [p.productId, p.productName]));
    }

    const items = txs.map((tx) => ({
      ...tx,
      productName: productMap[tx.productId] ?? tx.productId,
    }));

    return { items, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  // ─── Lợi Nhuận Thật ───────────────────────────────────────────────────────

  async getProfitability(query: QueryProfitabilityDto) {
    const { groupBy = 'product' } = query;

    const completedStatuses = [
      OrderStatus.CONFIRMED,
      OrderStatus.PROCESSING,
      OrderStatus.SHIPPING,
      OrderStatus.DELIVERED,
    ];

    const qb = this.orderItemsRepository
      .createQueryBuilder('item')
      .innerJoin(OrderEntity, 'o', 'o.order_id = item.order_id')
      .where('o.order_status IN (:...statuses)', { statuses: completedStatuses });

    if (query.from) qb.andWhere('o.created_at >= :from', { from: query.from });
    if (query.to) qb.andWhere('o.created_at <= :to', { to: query.to });

    if (groupBy === 'product') {
      const { page = 1, limit = 30 } = query;
      qb
        .select('item.product_id', 'productId')
        .addSelect('item.product_name', 'productName')
        .addSelect('SUM(item.quantity)', 'soldQty')
        .addSelect('SUM(item.line_total)', 'revenue')
        .groupBy('item.product_id')
        .addGroupBy('item.product_name')
        .orderBy('SUM(item.line_total)', 'DESC');

      const total = await qb.getCount();
      const rows = await qb.offset((page - 1) * limit).limit(limit).getRawMany<{
        productId: string;
        productName: string;
        soldQty: string;
        revenue: string;
      }>();

      const productIds = rows.map((r) => r.productId);
      const products = productIds.length
        ? await this.productsRepository.findByIds(productIds)
        : [];

      // COGS chính xác: tính từ inventory_transactions với unit_cost_at_time của từng lần xuất
      // Fallback: avgCost (moving average) hoặc costPrice (last cost) trên ProductEntity
      const txCogsRows = productIds.length
        ? await this.inventoryTransactionsRepository
            .createQueryBuilder('tx')
            .select('tx.product_id', 'productId')
            .addSelect(
              'SUM(ABS(tx.quantity_change) * COALESCE(tx.unit_cost_at_time, 0))',
              'totalCogs',
            )
            .addSelect(
              'SUM(CASE WHEN tx.unit_cost_at_time IS NOT NULL THEN ABS(tx.quantity_change) ELSE 0 END)',
              'qtyWithCost',
            )
            .where('tx.transaction_type = :type', { type: 'export' })
            .andWhere('tx.product_id IN (:...pids)', { pids: productIds })
            .andWhere('tx.related_order_id IS NOT NULL')
            .groupBy('tx.product_id')
            .getRawMany<{
              productId: string;
              totalCogs: string;
              qtyWithCost: string;
            }>()
        : [];

      const cogsMap = Object.fromEntries(
        txCogsRows.map((r) => [
          r.productId,
          {
            totalCogs: Number(r.totalCogs ?? 0),
            qtyWithCost: Number(r.qtyWithCost ?? 0),
          },
        ]),
      );

      const fallbackCostMap = Object.fromEntries(
        products.map((p) => [
          p.productId,
          Number(p.avgCost ?? 0) || Number(p.costPrice ?? 0),
        ]),
      );

      const items = rows.map((r) => {
        const revenue = Number(r.revenue);
        const soldQty = Number(r.soldQty);
        const txData = cogsMap[r.productId];
        const fallbackCost = fallbackCostMap[r.productId] ?? 0;

        // Nếu có dữ liệu unit_cost_at_time từ inventory_transactions → ưu tiên
        // Nếu thiếu (đơn cũ trước khi feature có) → dùng avgCost làm fallback cho phần còn thiếu
        let cogs: number;
        if (txData && txData.qtyWithCost > 0) {
          const qtyMissingCost = Math.max(0, soldQty - txData.qtyWithCost);
          cogs = txData.totalCogs + qtyMissingCost * fallbackCost;
        } else {
          cogs = soldQty * fallbackCost;
        }

        const grossProfit = revenue - cogs;
        const marginPct = revenue > 0 ? (grossProfit / revenue) * 100 : 0;
        return {
          productId: r.productId,
          productName: r.productName,
          soldQty,
          revenue,
          cogs,
          grossProfit,
          marginPct: Math.round(marginPct * 100) / 100,
        };
      });

      return { items, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
    }

    // Nhóm theo ngày hoặc tháng
    const dateFormat = groupBy === 'month' ? '%Y-%m' : '%Y-%m-%d';
    qb
      .select(`DATE_FORMAT(o.created_at, '${dateFormat}')`, 'period')
      .addSelect('SUM(item.line_total)', 'revenue')
      .addSelect('SUM(item.quantity)', 'soldQty')
      .groupBy('period')
      .orderBy('period', 'ASC');

    const rows = await qb.getRawMany<{ period: string; revenue: string; soldQty: string }>();
    return { items: rows.map((r) => ({ ...r, revenue: Number(r.revenue), soldQty: Number(r.soldQty) })) };
  }

  // ─── Báo Cáo Tuổi Nợ NCC ──────────────────────────────────────────────────

  async getAgingDebt(query: QueryAgingDebtDto) {
    const asOf = query.asOf ? new Date(query.asOf) : new Date();

    const qb = this.poRepository
      .createQueryBuilder('po')
      .where('po.payment_status != :paid', { paid: 'paid' })
      .andWhere('po.status NOT IN (:...excl)', {
        excl: [PurchaseOrderStatus.DRAFT, PurchaseOrderStatus.CANCELLED],
      })
      .orderBy('po.orderDate', 'ASC');

    if (query.supplierId) qb.andWhere('po.supplierId = :sid', { sid: query.supplierId });

    const pos = await qb.getMany();

    const buckets = {
      current: [] as typeof pos,
      days1_7: [] as typeof pos,
      days8_30: [] as typeof pos,
      days31_60: [] as typeof pos,
      days61_90: [] as typeof pos,
      over90: [] as typeof pos,
    };

    for (const po of pos) {
      const refDate = po.orderDate ? new Date(po.orderDate) : new Date(po.createdAt);
      const diffDays = Math.floor((asOf.getTime() - refDate.getTime()) / (1000 * 60 * 60 * 24));
      const outstanding = Number(po.totalAmount) - Number(po.paidAmount);

      const enriched = { ...po, diffDays, outstanding };
      if (diffDays <= 0) buckets.current.push(enriched as typeof po);
      else if (diffDays <= 7) buckets.days1_7.push(enriched as typeof po);
      else if (diffDays <= 30) buckets.days8_30.push(enriched as typeof po);
      else if (diffDays <= 60) buckets.days31_60.push(enriched as typeof po);
      else if (diffDays <= 90) buckets.days61_90.push(enriched as typeof po);
      else buckets.over90.push(enriched as typeof po);
    }

    const sumOutstanding = (arr: typeof pos) =>
      arr.reduce((s, po) => s + Number((po as any).outstanding ?? Number(po.totalAmount) - Number(po.paidAmount)), 0);

    const summary = {
      asOf: asOf.toISOString().split('T')[0],
      totalPos: pos.length,
      totalOutstanding: sumOutstanding(pos),
      buckets: {
        current:    { count: buckets.current.length,    total: sumOutstanding(buckets.current) },
        days1_7:    { count: buckets.days1_7.length,    total: sumOutstanding(buckets.days1_7) },
        days8_30:   { count: buckets.days8_30.length,   total: sumOutstanding(buckets.days8_30) },
        days31_60:  { count: buckets.days31_60.length,  total: sumOutstanding(buckets.days31_60) },
        days61_90:  { count: buckets.days61_90.length,  total: sumOutstanding(buckets.days61_90) },
        over90:     { count: buckets.over90.length,     total: sumOutstanding(buckets.over90) },
      },
    };

    return { summary, items: pos };
  }

  async recordPoPayment(dto: RecordPoPaymentDto, userId?: string) {
    const po = await this.poRepository.findOne({ where: { poId: dto.poId } });
    if (!po) throw new NotFoundException('Không tìm thấy đơn đặt hàng');

    const newPaid = Number(po.paidAmount) + Number(dto.amount);
    const total = Number(po.totalAmount);
    const paymentStatus = newPaid >= total ? 'paid' : newPaid > 0 ? 'partial' : 'unpaid';

    await this.poRepository.update({ poId: dto.poId }, {
      paidAmount: String(newPaid),
      paidDate: new Date(),
      paymentStatus: paymentStatus as 'unpaid' | 'partial' | 'paid',
      paymentNotes: dto.notes ?? null,
    });

    return this.poRepository.findOne({ where: { poId: dto.poId } });
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
