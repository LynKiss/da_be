import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, MoreThanOrEqual, LessThanOrEqual, Repository } from 'typeorm';
import { CategoryEntity } from '../categories/entities/category.entity';
import { CommentEntity, ProductCommentStatus } from '../comments/entities/comment.entity';
import { SimpleCacheService } from '../common/simple-cache.service';
import { CouponUsageEntity } from '../discounts/entities/coupon-usage.entity';
import { DiscountEntity } from '../discounts/entities/discount.entity';
import { OrderItemEntity } from '../orders/entities/order-item.entity';
import { OrderStatusHistoryEntity } from '../orders/entities/order-status-history.entity';
import {
  OrderRefundEntity,
  OrderRefundStatus,
} from '../orders/entities/order-refund.entity';
import { ReturnEntity } from '../orders/entities/return.entity';
import {
  OrderEntity,
  OrderStatus,
  PaymentStatus,
} from '../orders/entities/order.entity';
import { ProductBatchEntity } from '../products/entities/product-batch.entity';
import { PurchaseOrderEntity, PurchaseOrderStatus } from '../procurement/entities/purchase-order.entity';
import { InventoryTransactionEntity } from '../products/entities/inventory-transaction.entity';
import { ProductEntity } from '../products/entities/product.entity';
import { RiceDiagnosisHistoryEntity } from '../rice-diagnosis/entities/rice-diagnosis-history.entity';
import { SupplierEntity } from '../suppliers/entities/supplier.entity';
import { UserEntity, UserRole } from '../users/entities/user.entity';
import { QueryCouponUsageDto } from './dto/query-coupon-usage.dto';
import {
  QueryInventoryLedgerDto,
  QueryProfitabilityDto,
  QueryAgingDebtDto,
  QueryInventoryReconciliationDto,
  RecordPoPaymentDto,
} from './dto/query-inventory-ledger.dto';
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

    @InjectRepository(SupplierEntity)
    private readonly suppliersRepository: Repository<SupplierEntity>,

    @InjectRepository(ReturnEntity)
    private readonly returnsRepository: Repository<ReturnEntity>,

    @InjectRepository(OrderRefundEntity)
    private readonly refundsRepository: Repository<OrderRefundEntity>,

    @InjectRepository(OrderStatusHistoryEntity)
    private readonly orderStatusHistoryRepository: Repository<OrderStatusHistoryEntity>,

    @InjectRepository(ProductBatchEntity)
    private readonly batchRepository: Repository<ProductBatchEntity>,

    private readonly cache: SimpleCacheService,
  ) {}

  private buildSupplierCreditInfo(supplier?: SupplierEntity | null) {
    const creditLimit = Number(supplier?.creditLimit ?? 0);
    const currentDebt = Number(supplier?.currentDebt ?? 0);
    const hasLimit = creditLimit > 0;
    const availableCredit = hasLimit ? Math.max(0, creditLimit - currentDebt) : null;
    const debtUsagePct = hasLimit ? Math.round((currentDebt / creditLimit) * 1000) / 10 : 0;
    const creditStatus =
      hasLimit && currentDebt >= creditLimit
        ? 'over_limit'
        : hasLimit && debtUsagePct >= 80
          ? 'near_limit'
          : 'normal';

    return { creditLimit, currentDebt, availableCredit, debtUsagePct, creditStatus };
  }

  private async syncSupplierDebt(supplierId: string) {
    const row = await this.poRepository
      .createQueryBuilder('po')
      .select('SUM(GREATEST(CAST(po.totalAmount AS DECIMAL(15,2)) - CAST(po.paidAmount AS DECIMAL(15,2)), 0))', 'debt')
      .where('po.supplierId = :supplierId', { supplierId })
      .andWhere('po.status IN (:...statuses)', {
        statuses: [
          PurchaseOrderStatus.ORDERED,
          PurchaseOrderStatus.PARTIAL,
          PurchaseOrderStatus.RECEIVED,
        ],
      })
      .getRawOne<{ debt: string | null }>();
    const debt = Number(row?.debt ?? 0);
    await this.suppliersRepository.update({ supplierId }, { currentDebt: String(debt) });
    return debt;
  }

  private readonly financialRevenueStatuses = [
    OrderStatus.DELIVERED,
    OrderStatus.PARTIAL_DELIVERED,
    OrderStatus.PARTIAL_RETURNED,
  ];
  private readonly revenuePolicy =
    'financial_v1_completed_fulfillment_less_completed_refunds';

  private readonly revenueRecognitionStatuses = [
    OrderStatus.DELIVERED,
    OrderStatus.PARTIAL_DELIVERED,
  ];

  private revenueRecognitionDateSql(orderAlias: string) {
    return `COALESCE(revenue_recognition.recognizedAt, ${orderAlias}.created_at)`;
  }

  private joinRevenueRecognition(qb: any, orderAlias: string) {
    return qb.leftJoin(
      (historyQb) =>
        historyQb
          .select('history.order_id', 'orderId')
          .addSelect('MIN(history.created_at)', 'recognizedAt')
          .from(OrderStatusHistoryEntity, 'history')
          .where('history.new_status IN (:...recognitionStatuses)', {
            recognitionStatuses: this.revenueRecognitionStatuses,
          })
          .groupBy('history.order_id'),
      'revenue_recognition',
      `revenue_recognition.orderId = ${orderAlias}.order_id`,
    );
  }

  private fulfilledLineRevenueSql(orderAlias: string, itemAlias: string) {
    return `COALESCE(NULLIF(${itemAlias}.net_line_total, 0), ${itemAlias}.line_total)
      * CASE
          WHEN ${orderAlias}.order_status = '${OrderStatus.PARTIAL_DELIVERED}' AND ${itemAlias}.quantity > 0
            THEN ${itemAlias}.quantity_delivered / ${itemAlias}.quantity
          ELSE 1
        END`;
  }

  private joinCompletedRefunds(
    qb: any,
    orderAlias: string,
  ) {
    return qb.leftJoin(
      (refundQb) =>
        refundQb
          .select('refund.order_id', 'orderId')
          .addSelect('SUM(refund.amount)', 'completedRefund')
          .from(OrderRefundEntity, 'refund')
          .where('refund.refund_status = :completedRefundStatus', {
            completedRefundStatus: OrderRefundStatus.COMPLETED,
          })
          .groupBy('refund.order_id'),
      'completed_refunds',
      `completed_refunds.orderId = ${orderAlias}.order_id`,
    );
  }

  private joinCompletedLineRefunds(
    qb: any,
    itemAlias: string,
  ) {
    return qb.leftJoin(
      (refundQb) =>
        refundQb
          .select('ret.order_item_id', 'orderItemId')
          .addSelect('SUM(refund.amount)', 'completedRefund')
          .addSelect('SUM(ret.return_quantity)', 'completedReturnQty')
          .from(OrderRefundEntity, 'refund')
          .innerJoin(ReturnEntity, 'ret', 'ret.return_id = refund.return_id')
          .where('refund.refund_status = :completedRefundStatus', {
            completedRefundStatus: OrderRefundStatus.COMPLETED,
          })
          .groupBy('ret.order_item_id'),
      'completed_line_refunds',
      `completed_line_refunds.orderItemId = ${itemAlias}.order_item_id`,
    );
  }

  private async getCompletedRefundsByOrderIds(orderIds: string[]) {
    if (orderIds.length === 0) {
      return new Map<string, number>();
    }

    const rows = await this.refundsRepository
      .createQueryBuilder('refund')
      .select('refund.order_id', 'orderId')
      .addSelect('SUM(refund.amount)', 'amount')
      .where('refund.order_id IN (:...orderIds)', { orderIds })
      .andWhere('refund.refund_status = :status', {
        status: OrderRefundStatus.COMPLETED,
      })
      .groupBy('refund.order_id')
      .getRawMany<{ orderId: string; amount: string }>();

    return new Map(rows.map((row) => [row.orderId, Number(row.amount ?? 0)]));
  }

  private async getUnallocatedCompletedRefundAmount(query: QueryProfitabilityDto) {
    const qb = this.refundsRepository
      .createQueryBuilder('refund')
      .select('COALESCE(SUM(refund.amount), 0)', 'amount')
      .where('refund.refund_status = :status', {
        status: OrderRefundStatus.COMPLETED,
      })
      .andWhere('refund.return_id IS NULL');

    if (query.from) qb.andWhere('refund.updated_at >= :from', { from: query.from });
    if (query.to) qb.andWhere('refund.updated_at <= :to', { to: query.to });

    const row = await qb.getRawOne<{ amount: string }>();
    return Number(row?.amount ?? 0);
  }

  private profitabilityMeta(
    query: QueryProfitabilityDto,
    unallocatedRefund: number,
    paging?: { page: number; limit: number; total: number; totalPages: number },
    totals?: Record<string, unknown>,
  ) {
    return {
      ...(paging ?? {}),
      ...(totals ?? {}),
      revenuePolicy: this.revenuePolicy,
      refundPolicy:
        'only completed refunds reduce revenue; return-linked refunds are allocated by return line, unlinked refunds are exposed as unallocatedRefund',
      cogsPolicy:
        'COGS prefers order-linked inventory export/return_in transactions with positive unit_cost_at_time; legacy rows fall back to product avgCost/costPrice and missing costs are reported as warnings',
      unallocatedRefund,
    };
  }

  async getDashboard() {
    // Revenue statuses: include partial-returned (vẫn còn phần đã giao = doanh thu thật)
    // KHÔNG include fully RETURNED hay CANCELLED.
    // PARTIAL_RETURNED có doanh thu = totalPayment - SUM(refunded returns).
    const revenueStatuses = this.financialRevenueStatuses;

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
      const recognizedAtSql = this.revenueRecognitionDateSql('order');
      const qb = this.joinRevenueRecognition(
        this.joinCompletedRefunds(
        this.ordersRepository
        .createQueryBuilder('order')
        .select(
          'COALESCE(SUM(GREATEST(0, order.total_payment - COALESCE(completed_refunds.completedRefund, 0))), 0)',
          'revenue',
        )
        .where('order.order_status IN (:...statuses)', {
          statuses: revenueStatuses,
        }),
        'order',
        ),
        'order',
      );

      if (from) {
        qb.andWhere(`${recognizedAtSql} >= :from`, { from });
      }

      if (to) {
        qb.andWhere(`${recognizedAtSql} < :to`, { to });
      }

      return qb.getRawOne() as Promise<{ revenue: string }>;
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

    const topProductsQb = this.joinCompletedLineRefunds(
      this.orderItemsRepository
      .createQueryBuilder('item')
        .innerJoin(OrderEntity, 'order', 'order.order_id = item.order_id'),
      'item',
    );
    const topProducts = await topProductsQb
      .select('item.product_id', 'productId')
      .addSelect('item.product_name', 'productName')
      .addSelect(`SUM(CASE
        WHEN order.order_status = '${OrderStatus.PARTIAL_DELIVERED}'
          THEN item.quantity_delivered
        ELSE item.quantity
      END)`, 'soldQuantity')
      .addSelect(
        `SUM(GREATEST(0, ${this.fulfilledLineRevenueSql('order', 'item')} - COALESCE(completed_line_refunds.completedRefund, 0)))`,
        'revenue',
      )
      .where('order.order_status IN (:...statuses)', {
        statuses: revenueStatuses,
      })
      .groupBy('item.product_id')
      .addGroupBy('item.product_name')
      .orderBy('soldQuantity', 'DESC')
      .limit(10)
      .getRawMany();

    const inventorySummary = await this.inventoryTransactionsRepository
      .createQueryBuilder('transaction')
      .select('transaction.transaction_type', 'transactionType')
      .addSelect('COUNT(*)', 'count')
      .groupBy('transaction.transaction_type')
      .getRawMany();

    const recognizedAtSql = this.revenueRecognitionDateSql('order');
    const salesByDay = await this.joinRevenueRecognition(
      this.joinCompletedRefunds(
      this.ordersRepository
      .createQueryBuilder('order')
        .select(`DATE(${recognizedAtSql})`, 'date')
        .addSelect('COUNT(*)', 'orders')
        .addSelect(
          'COALESCE(SUM(GREATEST(0, order.total_payment - COALESCE(completed_refunds.completedRefund, 0))), 0)',
          'revenue',
        ),
      'order',
      ),
      'order',
    )
      .where('order.order_status IN (:...statuses)', {
        statuses: revenueStatuses,
      })
      .andWhere(`${recognizedAtSql} >= :from`, { from: last30DaysStart })
      .groupBy(`DATE(${recognizedAtSql})`)
      .orderBy(`DATE(${recognizedAtSql})`, 'ASC')
      .getRawMany();

    const salesByMonth = await this.joinRevenueRecognition(
      this.joinCompletedRefunds(
      this.ordersRepository
      .createQueryBuilder('order')
        .select(`DATE_FORMAT(${recognizedAtSql}, '%Y-%m')`, 'period')
        .addSelect('COUNT(*)', 'orders')
        .addSelect(
          'COALESCE(SUM(GREATEST(0, order.total_payment - COALESCE(completed_refunds.completedRefund, 0))), 0)',
          'revenue',
        ),
      'order',
      ),
      'order',
    )
      .where('order.order_status IN (:...statuses)', {
        statuses: revenueStatuses,
      })
      .andWhere(`${recognizedAtSql} >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)`)
      .groupBy('period')
      .orderBy('period', 'ASC')
      .getRawMany();

    const salesByHour = await this.joinRevenueRecognition(
      this.joinCompletedRefunds(
      this.ordersRepository
      .createQueryBuilder('order')
        .select(`HOUR(${recognizedAtSql})`, 'hour')
        .addSelect('COUNT(*)', 'orders')
        .addSelect(
          'COALESCE(SUM(GREATEST(0, order.total_payment - COALESCE(completed_refunds.completedRefund, 0))), 0)',
          'revenue',
        ),
      'order',
      ),
      'order',
    )
      .where('order.order_status IN (:...statuses)', {
        statuses: revenueStatuses,
      })
      .andWhere(`${recognizedAtSql} >= :from`, { from: last30DaysStart })
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

    const categoryRevenueQb = this.joinCompletedLineRefunds(
      this.orderItemsRepository
      .createQueryBuilder('item')
      .innerJoin(OrderEntity, 'order', 'order.order_id = item.order_id')
      .innerJoin(ProductEntity, 'product', 'product.product_id = item.product_id')
        .leftJoin(CategoryEntity, 'category', 'category.category_id = product.category_id'),
      'item',
    );
    const categoryRevenue = await categoryRevenueQb
      .select("COALESCE(category.category_name, 'Chua phan loai')", 'categoryName')
      .addSelect('COUNT(DISTINCT order.order_id)', 'orders')
      .addSelect(`SUM(CASE
        WHEN order.order_status = '${OrderStatus.PARTIAL_DELIVERED}'
          THEN item.quantity_delivered
        ELSE item.quantity
      END)`, 'soldQuantity')
      .addSelect(
        `COALESCE(SUM(GREATEST(0, ${this.fulfilledLineRevenueSql('order', 'item')} - COALESCE(completed_line_refunds.completedRefund, 0))), 0)`,
        'revenue',
      )
      .where('order.order_status IN (:...statuses)', {
        statuses: revenueStatuses,
      })
      .groupBy('category.category_id')
      .addGroupBy('category.category_name')
      .orderBy('revenue', 'DESC')
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
      .leftJoin(
        (refundQb) =>
          refundQb
            .select('refund.order_id', 'orderId')
            .addSelect('SUM(refund.amount)', 'completedRefund')
            .from(OrderRefundEntity, 'refund')
            .where('refund.refund_status = :completedRefundStatus', {
              completedRefundStatus: OrderRefundStatus.COMPLETED,
            })
            .groupBy('refund.order_id'),
        'completed_refunds',
        'completed_refunds.orderId = order.order_id',
      )
      .select('discount.discount_id', 'discountId')
      .addSelect('discount.discount_code', 'discountCode')
      .addSelect('discount.discount_name', 'discountName')
      .addSelect('discount.discount_type', 'discountType')
      .addSelect('discount.discount_value', 'discountValue')
      .addSelect('COUNT(usage.usage_id)', 'timesUsed')
      .addSelect('COALESCE(SUM(order.discount_amount), 0)', 'discountGiven')
      .addSelect(
        'COALESCE(SUM(GREATEST(0, order.total_payment - COALESCE(completed_refunds.completedRefund, 0))), 0)',
        'orderRevenue',
      )
      .where(
        '(order.order_id IS NULL OR order.order_status IN (:...revenueStatuses))',
        { revenueStatuses },
      )
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

    // Trừ refund (PARTIAL_REFUNDED + REFUNDED) khỏi doanh thu thực tế.
    // SUM(refunds.refund_amount WHERE return_status = REFUNDED) — chỉ tính các return ĐÃ hoàn tiền.
    const [grossRevenue, grossToday, grossYesterday] = await Promise.all([
      Promise.resolve(Number(revenueRow?.revenue ?? 0)),
      Promise.resolve(Number(todayRevenueRow?.revenue ?? 0)),
      Promise.resolve(Number(yesterdayRevenueRow?.revenue ?? 0)),
    ]);
    const totalRevenue = Math.max(0, grossRevenue);
    const todayRevenue = Math.max(0, grossToday);
    const yesterdayRevenue = Math.max(0, grossYesterday);

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
        revenuePolicy: this.revenuePolicy,
        revenueRecognitionPolicy:
          'recognized_at_first_delivered_or_partial_delivered_status_history_fallback_order_created_at',
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
      this.joinCompletedRefunds(
        this.ordersRepository
        .createQueryBuilder('order'),
        'order',
      )
        .select('DATE(order.created_at)', 'date')
        .addSelect('COUNT(*)', 'orders')
        .addSelect(
          'COALESCE(SUM(GREATEST(0, order.total_payment - COALESCE(completed_refunds.completedRefund, 0))), 0)',
          'revenue',
        )
        .where(this.buildDateRangeSql('order.created_at', query))
        .andWhere('order.order_status IN (:...financialRevenueStatuses)', {
          financialRevenueStatuses: this.financialRevenueStatuses,
        })
        .groupBy('DATE(order.created_at)')
        .orderBy('DATE(order.created_at)', 'ASC')
        .getRawMany(),
      this.joinCompletedRefunds(
        this.ordersRepository
        .createQueryBuilder('order'),
        'order',
      )
        .select('order.user_id', 'userId')
        .addSelect('order.full_name', 'fullName')
        .addSelect('order.phone', 'phone')
        .addSelect('COUNT(*)', 'orders')
        .addSelect(
          'COALESCE(SUM(GREATEST(0, order.total_payment - COALESCE(completed_refunds.completedRefund, 0))), 0)',
          'revenue',
        )
        .where(this.buildDateRangeSql('order.created_at', query))
        .andWhere('order.order_status IN (:...financialRevenueStatuses)', {
          financialRevenueStatuses: this.financialRevenueStatuses,
        })
        .groupBy('order.user_id')
        .addGroupBy('order.full_name')
        .addGroupBy('order.phone')
        .orderBy('COALESCE(SUM(order.total_payment), 0)', 'DESC')
        .limit(10)
        .getRawMany(),
    ]);

    const completedOrders = orders.filter((order) =>
      this.financialRevenueStatuses.includes(order.orderStatus),
    );
    const completedRefunds = await this.getCompletedRefundsByOrderIds(
      completedOrders.map((order) => order.orderId),
    );
    const totalRevenue = completedOrders.reduce(
      (sum, order) =>
        sum +
        Math.max(
          0,
          Number(order.totalPayment) -
            (completedRefunds.get(order.orderId) ?? 0),
        ),
      0,
    );

    const totalDiscount = completedOrders.reduce(
      (sum, order) => sum + Number(order.discountAmount),
      0,
    );

    const totalDeliveryRevenue = completedOrders.reduce(
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
        revenuePolicy:
          'financial_v1_completed_fulfillment_less_completed_refunds',
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
        'usage.usage_id AS id',
        'usage.discount_id AS discountId',
        'usage.user_id AS userId',
        'usage.order_id AS orderId',
        'usage.used_at AS usedAt',
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

    // Tính FIFO valuation theo batches (chuẩn hơn avgCost).
    // SUM(qty_remaining × unit_cost) per product, chỉ batches còn hàng.
    const batchValuations = await this.batchRepository
      .createQueryBuilder('b')
      .select('b.product_id', 'productId')
      .addSelect('SUM(b.qty_remaining)', 'totalBatchQty')
      .addSelect('SUM(b.qty_remaining * b.unit_cost)', 'totalBatchValue')
      .where('b.qty_remaining > 0')
      .groupBy('b.product_id')
      .getRawMany<{ productId: string; totalBatchQty: string; totalBatchValue: string }>();
    const batchMap = new Map<string, { qty: number; value: number }>();
    for (const r of batchValuations) {
      batchMap.set(r.productId, { qty: Number(r.totalBatchQty), value: Number(r.totalBatchValue) });
    }
    const defaultWarehouseRows = (await this.productsRepository.manager.query(
      `SELECT ws.product_id AS productId, SUM(ws.quantity) AS quantity
       FROM warehouse_stock ws
       INNER JOIN warehouses w ON w.warehouse_id = ws.warehouse_id
       WHERE w.is_default = 1
       GROUP BY ws.product_id`,
    )) as Array<{ productId: string; quantity: string | number }>;
    const defaultWarehouseMap = new Map(
      defaultWarehouseRows.map((row) => [row.productId, Number(row.quantity)]),
    );

    const items = products.map((p) => {
      const qtyAvail = Number(p.qtyAvailable) || 0;
      const qtyResv = Number(p.qtyReserved) || 0;
      const avgCost = Number(p.avgCost) || 0;
      const retail = Number(p.retailPrice) || 0;
      const totalQty = qtyAvail + qtyResv;
      // FIX HIGH: nếu có batch data → dùng FIFO valuation; nếu không → fallback avgCost.
      const batchEntry = batchMap.get(p.productId);
      const fifoValue = batchEntry ? batchEntry.value : null;
      const totalValue = fifoValue ?? qtyAvail * avgCost;
      const potentialRevenue = totalQty * retail;
      const potentialProfit = potentialRevenue - totalValue;
      const defaultWarehouseQty = defaultWarehouseMap.get(p.productId) ?? null;
      const reconciliationWarnings = [
        batchEntry && batchEntry.qty !== qtyAvail
          ? `batch_qty(${batchEntry.qty}) != available(${qtyAvail})`
          : null,
        defaultWarehouseQty !== null && defaultWarehouseQty !== qtyAvail
          ? `default_warehouse(${defaultWarehouseQty}) != available(${qtyAvail})`
          : null,
      ].filter(Boolean);
      return {
        productId: p.productId,
        productName: p.productName,
        qtyAvailable: qtyAvail,
        qtyReserved: qtyResv,
        totalQty,
        avgCost,
        lastCost: Number(p.lastCost ?? 0),
        retailPrice: retail,
        // valuationMethod: 'fifo' nếu có batch data, 'avg' nếu fallback (cho audit)
        valuationMethod: fifoValue !== null ? 'fifo' : 'avg',
        batchQty: batchEntry?.qty ?? null,
        defaultWarehouseQty,
        reconciliationOk: reconciliationWarnings.length === 0,
        reconciliationWarnings,
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
        reconciliationWarnings:
          acc.reconciliationWarnings + (it.reconciliationOk ? 0 : 1),
      }),
      {
        totalProducts: 0,
        totalQty: 0,
        totalValue: 0,
        potentialRevenue: 0,
        potentialProfit: 0,
        reconciliationWarnings: 0,
      },
    );

    return {
      asOf: new Date(),
      valuationPolicy:
        'batch_remaining_or_available_avg_cost; reserved was allocated at checkout',
      summary,
      items,
    };
  }

  // ─── Sổ Kho Chi Tiết ──────────────────────────────────────────────────────

  async getInventoryReconciliation(query: QueryInventoryReconciliationDto) {
    const page = Math.max(1, Number(query.page ?? 1));
    const limit = Math.min(200, Math.max(1, Number(query.limit ?? 30)));
    const onlyMismatch = String(query.onlyMismatch ?? '').toLowerCase() === 'true';

    const productsQb = this.productsRepository
      .createQueryBuilder('p')
      .select([
        'p.product_id AS productId',
        'p.product_name AS productName',
        'p.quantity_available AS quantityAvailable',
        'p.quantity_reserved AS quantityReserved',
      ])
      .orderBy('p.product_name', 'ASC');

    if (query.productId) {
      productsQb.where('p.product_id = :productId', { productId: query.productId });
    }

    const products = await productsQb.getRawMany<{
      productId: string;
      productName: string;
      quantityAvailable: string | number;
      quantityReserved: string | number;
    }>();

    const productIds = products.map((product) => product.productId);
    const [batchRows, defaultWarehouseRows] = await Promise.all([
      productIds.length
        ? this.batchRepository
            .createQueryBuilder('b')
            .select('b.product_id', 'productId')
            .addSelect('SUM(b.qty_remaining)', 'quantity')
            .where('b.product_id IN (:...productIds)', { productIds })
            .groupBy('b.product_id')
            .getRawMany<{ productId: string; quantity: string | number }>()
        : [],
      productIds.length
        ? (this.productsRepository.manager.query(
            `SELECT ws.product_id AS productId, SUM(ws.quantity) AS quantity
             FROM warehouse_stock ws
             INNER JOIN warehouses w ON w.warehouse_id = ws.warehouse_id
             WHERE w.is_default = 1 AND ws.product_id IN (?)
             GROUP BY ws.product_id`,
            [productIds],
          ) as Promise<Array<{ productId: string; quantity: string | number }>>)
        : [],
    ]);

    const batchMap = new Map<string, number>(
      batchRows.map((row) => [row.productId, Number(row.quantity ?? 0)] as [string, number]),
    );
    const defaultWarehouseMap = new Map<string, number>(
      defaultWarehouseRows.map((row) => [
        row.productId,
        Number(row.quantity ?? 0),
      ] as [string, number]),
    );

    const allItems = products.map((product) => {
      const quantityAvailable = Number(product.quantityAvailable ?? 0);
      const quantityReserved = Number(product.quantityReserved ?? 0);
      const batchRemainingQty = batchMap.get(product.productId) ?? 0;
      const defaultWarehouseQty = defaultWarehouseMap.get(product.productId) ?? 0;
      const hasBatch = batchMap.has(product.productId);
      const hasDefaultWarehouse = defaultWarehouseMap.has(product.productId);
      const deltaBatch = batchRemainingQty - quantityAvailable;
      const deltaWarehouse = defaultWarehouseQty - quantityAvailable;
      const warnings = [
        !hasBatch && quantityAvailable > 0
          ? 'MISSING_BATCH_FOR_AVAILABLE_STOCK'
          : null,
        deltaBatch !== 0
          ? `BATCH_REMAINING_DIFF:${deltaBatch}`
          : null,
        !hasDefaultWarehouse && quantityAvailable > 0
          ? 'MISSING_DEFAULT_WAREHOUSE_STOCK'
          : null,
        deltaWarehouse !== 0
          ? `DEFAULT_WAREHOUSE_DIFF:${deltaWarehouse}`
          : null,
      ].filter(Boolean) as string[];
      const severity =
        Math.abs(deltaBatch) > 0 || Math.abs(deltaWarehouse) > 0
          ? Math.abs(deltaBatch) > 5 || Math.abs(deltaWarehouse) > 5
            ? 'CRITICAL'
            : 'WARNING'
          : 'OK';

      return {
        productId: product.productId,
        productName: product.productName,
        quantityAvailable,
        quantityReserved,
        batchRemainingQty,
        defaultWarehouseQty,
        deltaBatch,
        deltaWarehouse,
        severity,
        warnings,
        warningsText: warnings.join('; '),
      };
    });

    const filtered = onlyMismatch
      ? allItems.filter((item) => item.severity !== 'OK')
      : allItems;
    const total = filtered.length;
    const items = filtered.slice((page - 1) * limit, page * limit);
    const mismatchItems = allItems.filter((item) => item.severity !== 'OK');

    return {
      summary: {
        totalProducts: allItems.length,
        totalMismatches: mismatchItems.length,
        missingBatch: allItems.filter((item) =>
          item.warnings.includes('MISSING_BATCH_FOR_AVAILABLE_STOCK'),
        ).length,
        warehouseMismatches: allItems.filter((item) =>
          item.warnings.some((warning) => warning.startsWith('DEFAULT_WAREHOUSE')),
        ).length,
        critical: allItems.filter((item) => item.severity === 'CRITICAL').length,
        warning: allItems.filter((item) => item.severity === 'WARNING').length,
        ok: allItems.filter((item) => item.severity === 'OK').length,
      },
      items,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        asOf: new Date(),
        policy:
          'product.quantityAvailable must match remaining sellable batches and default warehouse stock',
      },
    };
  }

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

  private async getProfitabilityV2(query: QueryProfitabilityDto) {
    const { groupBy = 'product' } = query;
    const completedStatuses = this.financialRevenueStatuses;
    const unallocatedRefund = await this.getUnallocatedCompletedRefundAmount(query);

    const fulfilledQtySql = `CASE
      WHEN o.order_status = '${OrderStatus.PARTIAL_DELIVERED}'
        THEN item.quantity_delivered
      ELSE item.quantity
    END`;
    const fulfilledRatioSql = `CASE
      WHEN o.order_status = '${OrderStatus.PARTIAL_DELIVERED}' AND item.quantity > 0
        THEN item.quantity_delivered / item.quantity
      ELSE 1
    END`;
    const fulfilledGrossSql =
      `COALESCE(NULLIF(item.gross_line_total, 0), item.line_total) * ${fulfilledRatioSql}`;
    const fulfilledDiscountSql = `COALESCE(item.discount_allocated, 0) * ${fulfilledRatioSql}`;
    const fulfilledNetSql = this.fulfilledLineRevenueSql('o', 'item');
    const dateFormat = groupBy === 'month' ? '%Y-%m' : '%Y-%m-%d';
    const periodSql = `DATE_FORMAT(o.created_at, '${dateFormat}')`;

    const revenueQb = this.joinCompletedLineRefunds(
      this.orderItemsRepository
        .createQueryBuilder('item')
        .innerJoin(OrderEntity, 'o', 'o.order_id = item.order_id'),
      'item',
    )
      .select('item.product_id', 'productId')
      .addSelect('item.product_name', 'productName')
      .addSelect(`SUM(${fulfilledQtySql})`, 'soldQty')
      .addSelect('SUM(COALESCE(completed_line_refunds.completedReturnQty, 0))', 'returnedQty')
      .addSelect(`SUM(${fulfilledGrossSql})`, 'grossRevenue')
      .addSelect(`SUM(${fulfilledDiscountSql})`, 'discountAllocated')
      .addSelect(`SUM(${fulfilledNetSql})`, 'revenueBeforeRefund')
      .addSelect('SUM(COALESCE(completed_line_refunds.completedRefund, 0))', 'refundAllocated')
      .addSelect(
        `SUM(GREATEST(0, ${fulfilledNetSql} - COALESCE(completed_line_refunds.completedRefund, 0)))`,
        'revenue',
      )
      .where('o.order_status IN (:...statuses)', { statuses: completedStatuses });

    revenueQb.groupBy('item.product_id').addGroupBy('item.product_name');
    if (groupBy !== 'product') {
      revenueQb.addSelect(periodSql, 'period').addGroupBy('period');
    }
    if (query.from) revenueQb.andWhere('o.created_at >= :from', { from: query.from });
    if (query.to) revenueQb.andWhere('o.created_at <= :to', { to: query.to });
    revenueQb.orderBy(groupBy === 'product' ? 'revenue' : 'period', groupBy === 'product' ? 'DESC' : 'ASC');

    const revenueRows = (await revenueQb.getRawMany()) as Array<{
      productId: string;
      productName: string;
      period?: string;
      soldQty: string;
      returnedQty: string;
      grossRevenue: string;
      discountAllocated: string;
      revenueBeforeRefund: string;
      refundAllocated: string;
      revenue: string;
    }>;

    const productIds = [...new Set(revenueRows.map((row) => row.productId).filter(Boolean))];
    const products = productIds.length
      ? await this.productsRepository.findBy({ productId: In(productIds) })
      : [];
    const fallbackCostMap = new Map(
      products.map((product) => [
        product.productId,
        Number(product.avgCost ?? 0) || Number(product.costPrice ?? 0),
      ]),
    );

    const cogsRows = productIds.length
      ? await (() => {
          const txQb = this.inventoryTransactionsRepository
            .createQueryBuilder('tx')
            .select('tx.product_id', 'productId')
            .addSelect(
              `SUM(CASE
                WHEN tx.transaction_type = 'export' AND tx.unit_cost_at_time > 0
                  THEN ABS(tx.quantity_change) * tx.unit_cost_at_time
                WHEN tx.transaction_type = 'return_in' AND tx.unit_cost_at_time > 0
                  THEN -ABS(tx.quantity_change) * tx.unit_cost_at_time
                ELSE 0
              END)`,
              'transactionCogs',
            )
            .addSelect(
              `SUM(CASE
                WHEN tx.transaction_type = 'export' AND tx.unit_cost_at_time > 0
                  THEN ABS(tx.quantity_change)
                WHEN tx.transaction_type = 'return_in' AND tx.unit_cost_at_time > 0
                  THEN -ABS(tx.quantity_change)
                ELSE 0
              END)`,
              'qtyWithTransactionCost',
            )
            .addSelect(
              `SUM(CASE
                WHEN tx.transaction_type = 'export'
                  THEN ABS(tx.quantity_change)
                WHEN tx.transaction_type = 'return_in'
                  THEN -ABS(tx.quantity_change)
                ELSE 0
              END)`,
              'transactionQty',
            )
            .addSelect(
              `SUM(CASE
                WHEN tx.unit_cost_at_time IS NULL OR tx.unit_cost_at_time <= 0
                  THEN ABS(tx.quantity_change)
                ELSE 0
              END)`,
              'zeroCostTransactionQty',
            )
            .innerJoin(OrderEntity, 'co', 'co.order_id = tx.related_order_id')
            .where('tx.transaction_type IN (:...types)', {
              types: ['export', 'return_in'],
            })
            .andWhere('tx.product_id IN (:...pids)', { pids: productIds })
            .andWhere('tx.related_order_id IS NOT NULL')
            .andWhere('co.order_status IN (:...statuses)', {
              statuses: completedStatuses,
            });

          txQb.groupBy('tx.product_id');
          if (groupBy !== 'product') {
            txQb.addSelect(`DATE_FORMAT(co.created_at, '${dateFormat}')`, 'period').addGroupBy('period');
          }
          if (query.from) txQb.andWhere('co.created_at >= :from', { from: query.from });
          if (query.to) txQb.andWhere('co.created_at <= :to', { to: query.to });
          return txQb.getRawMany();
        })()
      : [];

    const makeKey = (productId: string, period?: string) =>
      groupBy === 'product' ? productId : `${productId}::${period ?? ''}`;
    const cogsMap = new Map(
      cogsRows.map((row: any) => [
        makeKey(row.productId, row.period),
        {
          transactionCogs: Number(row.transactionCogs ?? 0),
          qtyWithTransactionCost: Math.max(0, Number(row.qtyWithTransactionCost ?? 0)),
          transactionQty: Number(row.transactionQty ?? 0),
          zeroCostTransactionQty: Math.max(0, Number(row.zeroCostTransactionQty ?? 0)),
        },
      ]),
    );

    const items = revenueRows.map((row) => {
      const soldQty = Number(row.soldQty ?? 0);
      const returnedQty = Math.min(Number(row.returnedQty ?? 0), soldQty);
      const netSoldQty = Math.max(0, soldQty - returnedQty);
      const revenue = Number(row.revenue ?? 0);
      const fallbackUnitCost = fallbackCostMap.get(row.productId) ?? 0;
      const txData = cogsMap.get(makeKey(row.productId, row.period));
      const transactionCoveredQty = Math.min(
        netSoldQty,
        Math.max(0, Number(txData?.qtyWithTransactionCost ?? 0)),
      );
      const fallbackCostQty = Math.max(0, netSoldQty - transactionCoveredQty);
      const missingCostQty = fallbackUnitCost > 0 ? 0 : fallbackCostQty;
      const fallbackCostUsed = fallbackUnitCost > 0 ? fallbackCostQty * fallbackUnitCost : 0;
      const transactionCogs = Math.max(0, Number(txData?.transactionCogs ?? 0));
      const cogs = transactionCogs + fallbackCostUsed;
      const cogsCoveragePct =
        netSoldQty > 0
          ? ((transactionCoveredQty + (fallbackUnitCost > 0 ? fallbackCostQty : 0)) / netSoldQty) * 100
          : 100;
      const warnings = [
        missingCostQty > 0 ? 'MISSING_COST_SOURCE' : null,
        fallbackCostQty > 0 && fallbackUnitCost > 0 ? 'USED_FALLBACK_AVG_COST' : null,
        Number(txData?.zeroCostTransactionQty ?? 0) > 0 ? 'ZERO_COST_INVENTORY_TRANSACTION' : null,
        Number(txData?.transactionQty ?? 0) > netSoldQty ? 'COGS_QTY_EXCEEDS_NET_SOLD' : null,
      ].filter(Boolean) as string[];
      const cogsSource =
        netSoldQty <= 0 || transactionCoveredQty >= netSoldQty
          ? 'transaction'
          : transactionCoveredQty > 0 && fallbackUnitCost > 0
            ? 'mixed'
            : fallbackUnitCost > 0
              ? 'fallback_avg_cost'
              : 'missing';
      const grossProfit = revenue - cogs;
      const marginPct = revenue > 0 ? (grossProfit / revenue) * 100 : 0;

      return {
        productId: row.productId,
        productName: row.productName,
        period: row.period,
        soldQty,
        returnedQty,
        netSoldQty,
        grossRevenue: Number(row.grossRevenue ?? 0),
        discountAllocated: Number(row.discountAllocated ?? 0),
        revenueBeforeRefund: Number(row.revenueBeforeRefund ?? 0),
        refundAllocated: Number(row.refundAllocated ?? 0),
        revenue,
        cogs,
        transactionCogs,
        fallbackCostUsed,
        fallbackUnitCost,
        missingCostQty,
        fallbackCostQty,
        transactionCoveredQty,
        cogsCoveragePct: Math.round(cogsCoveragePct * 100) / 100,
        cogsSource,
        warnings,
        grossProfit,
        marginPct: Math.round(marginPct * 100) / 100,
      };
    });

    const totalsBase = items.reduce(
      (acc, item) => {
        acc.totalGrossRevenue += item.grossRevenue;
        acc.totalDiscountAllocated += item.discountAllocated;
        acc.totalLineRevenueBeforeRefund += item.revenueBeforeRefund;
        acc.totalLineRevenue += item.revenue;
        acc.totalLineRefund += item.refundAllocated;
        acc.totalCOGS += item.cogs;
        acc.totalSoldQty += item.soldQty;
        acc.totalReturnedQty += item.returnedQty;
        acc.totalNetSoldQty += item.netSoldQty;
        acc.transactionCoveredQty += item.transactionCoveredQty;
        acc.fallbackCostQty += item.fallbackCostQty;
        acc.missingCostQty += item.missingCostQty;
        acc.zeroCostRows += item.warnings.includes('ZERO_COST_INVENTORY_TRANSACTION') ? 1 : 0;
        acc.fallbackRows += item.cogsSource === 'fallback_avg_cost' || item.cogsSource === 'mixed' ? 1 : 0;
        acc.missingCostRows += item.cogsSource === 'missing' || item.missingCostQty > 0 ? 1 : 0;
        return acc;
      },
      {
        totalGrossRevenue: 0,
        totalDiscountAllocated: 0,
        totalLineRevenueBeforeRefund: 0,
        totalLineRevenue: 0,
        totalLineRefund: 0,
        totalCOGS: 0,
        totalSoldQty: 0,
        totalReturnedQty: 0,
        totalNetSoldQty: 0,
        transactionCoveredQty: 0,
        fallbackCostQty: 0,
        missingCostQty: 0,
        zeroCostRows: 0,
        fallbackRows: 0,
        missingCostRows: 0,
      },
    );
    const totalRevenue = Math.max(0, totalsBase.totalLineRevenue - unallocatedRefund);
    const grossProfit = totalRevenue - totalsBase.totalCOGS;
    const cogsCoveragePct =
      totalsBase.totalNetSoldQty > 0
        ? ((totalsBase.transactionCoveredQty + totalsBase.fallbackCostQty - totalsBase.missingCostQty) /
            totalsBase.totalNetSoldQty) *
          100
        : 100;
    const dataQualityWarnings = [
      totalsBase.missingCostQty > 0 ? 'Có sản phẩm đã bán nhưng thiếu nguồn giá vốn.' : null,
      totalsBase.fallbackRows > 0 ? 'Một phần giá vốn đang dùng avgCost/costPrice fallback.' : null,
      unallocatedRefund > 0 ? 'Có refund chưa gắn được vào dòng sản phẩm.' : null,
    ].filter(Boolean);
    const totals = {
      totalGrossRevenue: totalsBase.totalGrossRevenue,
      totalDiscountAllocated: totalsBase.totalDiscountAllocated,
      totalRevenueBeforeRefund: totalsBase.totalLineRevenueBeforeRefund,
      totalRefund: totalsBase.totalLineRefund + unallocatedRefund,
      totalLineRefund: totalsBase.totalLineRefund,
      totalRevenue,
      totalCOGS: totalsBase.totalCOGS,
      grossProfit,
      grossMargin: totalRevenue > 0 ? Math.round((grossProfit / totalRevenue) * 10000) / 100 : 0,
      totalSoldQty: totalsBase.totalSoldQty,
      totalReturnedQty: totalsBase.totalReturnedQty,
      totalNetSoldQty: totalsBase.totalNetSoldQty,
      cogsCoveragePct: Math.max(0, Math.min(100, Math.round(cogsCoveragePct * 100) / 100)),
      transactionCoveredQty: totalsBase.transactionCoveredQty,
      fallbackCostQty: totalsBase.fallbackCostQty,
      missingCostQty: totalsBase.missingCostQty,
      zeroCostRows: totalsBase.zeroCostRows,
      fallbackRows: totalsBase.fallbackRows,
      missingCostRows: totalsBase.missingCostRows,
      unreliableCogs:
        totalsBase.missingCostQty > 0 || totalsBase.fallbackRows > 0 || unallocatedRefund > 0,
      dataQualityWarnings,
    };

    if (groupBy === 'product') {
      const page = Math.max(1, Number(query.page) || 1);
      const limit = Math.min(500, Math.max(1, Number(query.limit) || 30));
      const total = items.length;
      return {
        items: items.slice((page - 1) * limit, page * limit),
        meta: this.profitabilityMeta(
          query,
          unallocatedRefund,
          { page, limit, total, totalPages: Math.ceil(total / limit) },
          totals,
        ),
      };
    }

    const periodMap = new Map<string, any>();
    for (const item of items) {
      const period = item.period ?? 'unknown';
      const current = periodMap.get(period) ?? {
        period,
        soldQty: 0,
        returnedQty: 0,
        netSoldQty: 0,
        grossRevenue: 0,
        discountAllocated: 0,
        refundAllocated: 0,
        revenue: 0,
        cogs: 0,
        grossProfit: 0,
        missingCostQty: 0,
        warnings: [] as string[],
      };
      current.soldQty += item.soldQty;
      current.returnedQty += item.returnedQty;
      current.netSoldQty += item.netSoldQty;
      current.grossRevenue += item.grossRevenue;
      current.discountAllocated += item.discountAllocated;
      current.refundAllocated += item.refundAllocated;
      current.revenue += item.revenue;
      current.cogs += item.cogs;
      current.grossProfit += item.grossProfit;
      current.missingCostQty += item.missingCostQty;
      current.warnings = [...new Set([...current.warnings, ...item.warnings])];
      periodMap.set(period, current);
    }

    const periodItems = [...periodMap.values()]
      .sort((a, b) => String(a.period).localeCompare(String(b.period)))
      .map((item) => ({
        ...item,
        marginPct: item.revenue > 0 ? Math.round((item.grossProfit / item.revenue) * 10000) / 100 : 0,
      }));

    return {
      items: periodItems,
      meta: this.profitabilityMeta(query, unallocatedRefund, undefined, totals),
    };
  }

  async getProfitability(query: QueryProfitabilityDto) {
    return this.getProfitabilityV2(query);

    const { groupBy = 'product' } = query;

    const completedStatuses = this.financialRevenueStatuses;
    const unallocatedRefund = await this.getUnallocatedCompletedRefundAmount(query);

    const qb = this.joinCompletedLineRefunds(
      this.orderItemsRepository
      .createQueryBuilder('item')
        .innerJoin(OrderEntity, 'o', 'o.order_id = item.order_id'),
      'item',
    )
      .where('o.order_status IN (:...statuses)', { statuses: completedStatuses });

    if (query.from) qb.andWhere('o.created_at >= :from', { from: query.from });
    if (query.to) qb.andWhere('o.created_at <= :to', { to: query.to });

    if (groupBy === 'product') {
      const { page = 1, limit = 30 } = query;
      qb
        .select('item.product_id', 'productId')
        .addSelect('item.product_name', 'productName')
        .addSelect(
          `SUM(CASE
            WHEN o.order_status = '${OrderStatus.PARTIAL_DELIVERED}'
              THEN item.quantity_delivered
            ELSE item.quantity
          END)`,
          'soldQty',
        )
        .addSelect(
          `SUM(GREATEST(0, ${this.fulfilledLineRevenueSql('o', 'item')} - COALESCE(completed_line_refunds.completedRefund, 0)))`,
          'revenue',
        )
        .groupBy('item.product_id')
        .addGroupBy('item.product_name')
        .orderBy('revenue', 'DESC');

      const total = await qb.getCount();
      const rows = (await qb.offset((page - 1) * limit).limit(limit).getRawMany()) as Array<{
        productId: string;
        productName: string;
        soldQty: string;
        revenue: string;
      }>;

      const productIds = rows.map((r) => r.productId);
      const products = productIds.length
        ? await this.productsRepository.findByIds(productIds)
        : [];

      // COGS chính xác: tính từ inventory_transactions với unit_cost_at_time của từng lần xuất
      // Fallback: avgCost (moving average) hoặc costPrice (last cost) trên ProductEntity
      let txCogsRows: Array<{
        productId: string;
        totalCogs: string;
        qtyWithCost: string;
      }> = [];
      if (productIds.length) {
        const txCogsQb = this.inventoryTransactionsRepository
          .createQueryBuilder('tx')
          .select('tx.product_id', 'productId')
          .addSelect(
            `SUM(CASE
              WHEN tx.transaction_type = 'export'
                THEN ABS(tx.quantity_change) * COALESCE(tx.unit_cost_at_time, 0)
              WHEN tx.transaction_type = 'return_in'
                THEN -ABS(tx.quantity_change) * COALESCE(tx.unit_cost_at_time, 0)
              ELSE 0
            END)`,
            'totalCogs',
          )
          .addSelect(
            `SUM(CASE
              WHEN tx.unit_cost_at_time IS NULL THEN 0
              WHEN tx.transaction_type = 'export' THEN ABS(tx.quantity_change)
              WHEN tx.transaction_type = 'return_in' THEN -ABS(tx.quantity_change)
              ELSE 0
            END)`,
            'qtyWithCost',
          )
          .innerJoin(OrderEntity, 'co', 'co.order_id = tx.related_order_id')
          .where('tx.transaction_type IN (:...types)', {
            types: ['export', 'return_in'],
          })
          .andWhere('tx.product_id IN (:...pids)', { pids: productIds })
          .andWhere('tx.related_order_id IS NOT NULL')
          .andWhere('co.order_status IN (:...statuses)', {
            statuses: completedStatuses,
          })
          .groupBy('tx.product_id');
        if (query.from) txCogsQb.andWhere('co.created_at >= :from', { from: query.from });
        if (query.to) txCogsQb.andWhere('co.created_at <= :to', { to: query.to });
        txCogsRows = await txCogsQb.getRawMany();
      }

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
        let cogsSource: 'transaction' | 'fallback_avg_cost' | 'mixed';
        if (txData && txData.qtyWithCost > 0) {
          const qtyMissingCost = Math.max(0, soldQty - txData.qtyWithCost);
          cogs = txData.totalCogs + qtyMissingCost * fallbackCost;
          cogsSource = qtyMissingCost > 0 ? 'mixed' : 'transaction';
        } else {
          cogs = soldQty * fallbackCost;
          cogsSource = 'fallback_avg_cost';
        }

        const grossProfit = revenue - cogs;
        const marginPct = revenue > 0 ? (grossProfit / revenue) * 100 : 0;
        return {
          productId: r.productId,
          productName: r.productName,
          soldQty,
          revenue,
          cogs,
          cogsSource,
          grossProfit,
          marginPct: Math.round(marginPct * 100) / 100,
        };
      });

      return {
        items,
        meta: this.profitabilityMeta(query, unallocatedRefund, {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        }),
      };
    }

    // Nhóm theo ngày hoặc tháng
    const dateFormat = groupBy === 'month' ? '%Y-%m' : '%Y-%m-%d';
    qb
      .select(`DATE_FORMAT(o.created_at, '${dateFormat}')`, 'period')
      .addSelect(
        `SUM(GREATEST(0, ${this.fulfilledLineRevenueSql('o', 'item')} - COALESCE(completed_line_refunds.completedRefund, 0)))`,
        'revenue',
      )
      .addSelect(
        `SUM(CASE
          WHEN o.order_status = '${OrderStatus.PARTIAL_DELIVERED}'
            THEN item.quantity_delivered
          ELSE item.quantity
        END)`,
        'soldQty',
      )
      .groupBy('period')
      .orderBy('period', 'ASC');

    const rows = (await qb.getRawMany()) as Array<{
      period: string;
      revenue: string;
      soldQty: string;
    }>;
    return {
      items: rows.map((r) => ({
        ...r,
        revenue: Number(r.revenue),
        soldQty: Number(r.soldQty),
      })),
      meta: this.profitabilityMeta(query, unallocatedRefund),
    };
  }

  // ─── Báo Cáo Tuổi Nợ NCC ──────────────────────────────────────────────────

  async getAgingDebt(query: QueryAgingDebtDto) {
    const asOf = query.asOf ? new Date(query.asOf) : new Date();
    const asOfDate = asOf.toISOString().split('T')[0];
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const normalizedSearch = query.search?.trim().toLowerCase();
    const onlyOutstanding = String(query.onlyOutstanding ?? '').toLowerCase() === 'true';

    const qb = this.poRepository
      .createQueryBuilder('po')
      .where('po.status NOT IN (:...excl)', {
        excl: [PurchaseOrderStatus.DRAFT, PurchaseOrderStatus.CANCELLED],
      })
      .andWhere('(po.orderDate IS NULL OR po.orderDate <= :asOfDate)', {
        asOfDate,
      })
      .orderBy('po.orderDate', 'ASC');

    if (query.supplierId) qb.andWhere('po.supplierId = :sid', { sid: query.supplierId });
    if (query.paymentStatus && query.paymentStatus !== 'all') {
      qb.andWhere('po.paymentStatus = :paymentStatus', { paymentStatus: query.paymentStatus });
    }
    if (query.poStatus && query.poStatus !== 'all') {
      qb.andWhere('po.status = :poStatus', { poStatus: query.poStatus });
    }
    if (query.from) qb.andWhere('po.orderDate >= :from', { from: query.from });
    if (query.to) qb.andWhere('po.orderDate <= :to', { to: query.to });

    const pos = await qb.getMany();
    const supplierIds = [...new Set(pos.map((po) => po.supplierId))];
    const suppliers = supplierIds.length
      ? await this.suppliersRepository.find({ where: { supplierId: In(supplierIds) } })
      : [];
    const supplierById = new Map(suppliers.map((supplier) => [supplier.supplierId, supplier]));

    const buckets = {
      current: [] as Array<{ outstanding: number }>,
      days1_7: [] as Array<{ outstanding: number }>,
      days8_30: [] as Array<{ outstanding: number }>,
      days31_60: [] as Array<{ outstanding: number }>,
      days61_90: [] as Array<{ outstanding: number }>,
      over90: [] as Array<{ outstanding: number }>,
    };

    const enrichedItems = pos.map((po) => {
      const supplier = supplierById.get(po.supplierId);
      const supplierCredit = this.buildSupplierCreditInfo(supplier);
      const refDate = po.orderDate ? new Date(po.orderDate) : new Date(po.createdAt);
      const diffDays = Math.floor((asOf.getTime() - refDate.getTime()) / (1000 * 60 * 60 * 24));
      const totalAmount = Number(po.totalAmount);
      const paidAmount = Number(po.paidAmount);
      const outstanding = Math.max(0, totalAmount - paidAmount);
      const ageBucket =
        diffDays <= 0 ? 'current'
        : diffDays <= 7 ? 'days1_7'
        : diffDays <= 30 ? 'days8_30'
        : diffDays <= 60 ? 'days31_60'
        : diffDays <= 90 ? 'days61_90'
        : 'over90';

      const enriched = {
        ...po,
        supplierName: supplier?.name ?? null,
        supplierCode: supplier?.code ?? null,
        supplierCreditLimit: supplierCredit.creditLimit,
        supplierCurrentDebt: supplierCredit.currentDebt,
        supplierAvailableCredit: supplierCredit.availableCredit,
        supplierDebtUsagePct: supplierCredit.debtUsagePct,
        supplierCreditStatus: supplierCredit.creditStatus,
        diffDays,
        outstanding,
        ageBucket,
        statusLabel: this.getPoStatusLabel(po.status),
        paymentStatusLabel: this.getPoPaymentStatusLabel(po.paymentStatus),
        canRecordPayment: outstanding > 0 && po.paymentStatus !== 'paid',
      };

      return enriched;
    });

    const filteredItems = enrichedItems.filter((po) => {
      if (onlyOutstanding && po.outstanding <= 0) return false;
      if (normalizedSearch) {
        const haystack = [
          po.poCode,
          po.supplierName,
          po.supplierCode,
          po.paymentNotes,
          po.notes,
        ].filter(Boolean).join(' ').toLowerCase();
        if (!haystack.includes(normalizedSearch)) return false;
      }
      return true;
    });

    const sumOutstanding = (arr: Array<{ outstanding: number }>) =>
      arr.reduce((s, po) => s + Number(po.outstanding ?? 0), 0);
    const summaryBase = filteredItems;
    summaryBase
      .filter((po) => po.outstanding > 0)
      .forEach((po) =>
        buckets[po.ageBucket as keyof typeof buckets].push({ outstanding: po.outstanding }),
      );
    const paidTotal = summaryBase.reduce((sum, po) => sum + Number(po.paidAmount), 0);
    const summarySupplierIds = [...new Set(summaryBase.map((po) => po.supplierId))];
    const summarySupplierCredit = summarySupplierIds.map((id) => this.buildSupplierCreditInfo(supplierById.get(id)));

    const summary = {
      asOf: asOfDate,
      totalPos: summaryBase.length,
      totalOutstanding: summaryBase.reduce((sum, po) => sum + po.outstanding, 0),
      totalPaid: paidTotal,
      totalSupplierCreditLimit: summarySupplierCredit.reduce((sum, credit) => sum + credit.creditLimit, 0),
      totalSupplierCurrentDebt: summarySupplierCredit.reduce((sum, credit) => sum + credit.currentDebt, 0),
      nearLimitSupplierCount: summarySupplierCredit.filter((credit) => credit.creditStatus === 'near_limit').length,
      overLimitSupplierCount: summarySupplierCredit.filter((credit) => credit.creditStatus === 'over_limit').length,
      unpaidCount: summaryBase.filter((po) => po.paymentStatus === 'unpaid').length,
      partialCount: summaryBase.filter((po) => po.paymentStatus === 'partial').length,
      paidCount: summaryBase.filter((po) => po.paymentStatus === 'paid').length,
      buckets: {
        current:    { count: buckets.current.length,    total: sumOutstanding(buckets.current) },
        days1_7:    { count: buckets.days1_7.length,    total: sumOutstanding(buckets.days1_7) },
        days8_30:   { count: buckets.days8_30.length,   total: sumOutstanding(buckets.days8_30) },
        days31_60:  { count: buckets.days31_60.length,  total: sumOutstanding(buckets.days31_60) },
        days61_90:  { count: buckets.days61_90.length,  total: sumOutstanding(buckets.days61_90) },
        over90:     { count: buckets.over90.length,     total: sumOutstanding(buckets.over90) },
      },
    };

    const total = filteredItems.length;
    return {
      summary,
      items: filteredItems.slice((page - 1) * limit, page * limit),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  private getPoStatusLabel(status: PurchaseOrderStatus | string) {
    const labels: Record<string, string> = {
      draft: 'Nháp',
      ordered: 'Đã đặt hàng',
      partial: 'Nhập một phần',
      received: 'Đã nhập đủ',
      cancelled: 'Đã hủy',
    };
    return labels[String(status).toLowerCase()] ?? String(status);
  }

  private getPoPaymentStatusLabel(status: string) {
    const labels: Record<string, string> = {
      unpaid: 'Chưa thanh toán',
      partial: 'Thanh toán một phần',
      paid: 'Đã thanh toán',
    };
    return labels[String(status).toLowerCase()] ?? status;
  }

  async recordPoPayment(dto: RecordPoPaymentDto, userId?: string) {
    const po = await this.poRepository.findOne({ where: { poId: dto.poId } });
    if (!po) throw new NotFoundException('Không tìm thấy đơn đặt hàng');

    const amount = Number(dto.amount);
    const paid = Number(po.paidAmount);
    const total = Number(po.totalAmount);
    const outstanding = total - paid;

    if (po.paymentStatus === 'paid' || outstanding <= 0) {
      throw new BadRequestException('Đơn đặt hàng đã thanh toán đủ');
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('Số tiền thanh toán phải lớn hơn 0');
    }

    if (amount > outstanding) {
      throw new BadRequestException('Số tiền thanh toán không được vượt quá số còn nợ');
    }

    const newPaid = paid + amount;
    const paymentStatus = newPaid >= total ? 'paid' : newPaid > 0 ? 'partial' : 'unpaid';

    await this.poRepository.update({ poId: dto.poId }, {
      paidAmount: String(newPaid),
      paidDate: new Date(),
      paymentStatus: paymentStatus as 'unpaid' | 'partial' | 'paid',
      paymentNotes: dto.notes ?? null,
    });

    await this.syncSupplierDebt(po.supplierId);

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
