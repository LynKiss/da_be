import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, MoreThanOrEqual, LessThanOrEqual, Repository } from 'typeorm';
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
import { UserEntity } from '../users/entities/user.entity';
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

    @InjectRepository(PurchaseOrderEntity)
    private readonly poRepository: Repository<PurchaseOrderEntity>,

    private readonly cache: SimpleCacheService,
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
