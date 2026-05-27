import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { OrderEntity, OrderStatus, PaymentMethod, PaymentStatus } from '../orders/entities/order.entity';
import {
  PaymentTransactionEntity,
  PaymentTransactionStatus,
} from '../orders/entities/payment-transaction.entity';
import { UserEntity } from '../users/entities/user.entity';
import { RecordPaymentDto, UpsertCreditLimitDto } from './dto/upsert-credit-limit.dto';
import {
  CustomerCreditTransactionEntity,
  CustomerCreditTransactionType,
} from './entities/customer-credit-transaction.entity';
import { CustomerCreditLimitEntity } from './entities/customer-credit-limit.entity';

type DebtStatusFilter = 'all' | 'outstanding' | 'near_limit' | 'over_limit';

@Injectable()
export class CreditLimitsService {
  constructor(
    @InjectRepository(CustomerCreditLimitEntity)
    private readonly repo: Repository<CustomerCreditLimitEntity>,

    @InjectRepository(CustomerCreditTransactionEntity)
    private readonly transactionRepo: Repository<CustomerCreditTransactionEntity>,

    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,

    @InjectRepository(OrderEntity)
    private readonly orderRepo: Repository<OrderEntity>,

    @InjectRepository(PaymentTransactionEntity)
    private readonly paymentTransactionRepo: Repository<PaymentTransactionEntity>,

    private readonly dataSource: DataSource,
  ) {}

  private mapLimit(limit: CustomerCreditLimitEntity, user?: UserEntity | null) {
    const creditLimit = Number(limit.creditLimit ?? 0);
    const currentDebt = Number(limit.currentDebt ?? 0);
    const availableCredit = Math.max(0, creditLimit - currentDebt);
    const usagePct = creditLimit > 0 ? Math.min(999, (currentDebt / creditLimit) * 100) : 0;
    return {
      ...limit,
      username: user?.username ?? null,
      email: user?.email ?? null,
      fullName: user?.fullName ?? null,
      creditLimit,
      currentDebt,
      availableCredit,
      usagePct,
      debtStatus:
        currentDebt <= 0
          ? 'clear'
          : currentDebt >= creditLimit && creditLimit > 0
            ? 'over_limit'
            : usagePct >= 80
              ? 'near_limit'
              : 'outstanding',
    };
  }

  private async loadUsers(userIds: string[]) {
    if (!userIds.length) return new Map<string, UserEntity>();
    const users = await this.userRepo.find({ where: { userId: In([...new Set(userIds)]) } });
    return new Map(users.map((user) => [user.userId, user]));
  }

  async findAll(
    page = 1,
    limit = 20,
    search?: string,
    debtStatus: DebtStatusFilter = 'all',
  ) {
    const safePage = Math.max(1, page);
    const safeLimit = Math.min(100, Math.max(1, limit));
    const qb = this.repo
      .createQueryBuilder('cl')
      .where('cl.is_active = :active', { active: true })
      .orderBy('cl.updated_at', 'DESC')
      .skip((safePage - 1) * safeLimit)
      .take(safeLimit);

    if (search?.trim()) {
      const keyword = `%${search.trim()}%`;
      const users = await this.userRepo
        .createQueryBuilder('u')
        .select(['u.userId'])
        .where('u.username LIKE :keyword OR u.email LIKE :keyword OR u.fullName LIKE :keyword', { keyword })
        .getMany();
      const userIds = users.map((user) => user.userId);
      if (!userIds.length) {
        return { items: [], meta: { page: safePage, limit: safeLimit, total: 0, totalPages: 0 } };
      }
      qb.andWhere('cl.user_id IN (:...userIds)', { userIds });
    }

    if (debtStatus === 'outstanding') {
      qb.andWhere('COALESCE(cl.current_debt, 0) > 0');
    } else if (debtStatus === 'near_limit') {
      qb.andWhere('cl.credit_limit > 0')
        .andWhere('COALESCE(cl.current_debt, 0) / cl.credit_limit >= 0.8')
        .andWhere('COALESCE(cl.current_debt, 0) < cl.credit_limit');
    } else if (debtStatus === 'over_limit') {
      qb.andWhere('cl.credit_limit > 0')
        .andWhere('COALESCE(cl.current_debt, 0) >= cl.credit_limit');
    }

    const [items, total] = await qb.getManyAndCount();
    const userMap = await this.loadUsers(items.map((item) => item.userId));

    return {
      items: items.map((item) => this.mapLimit(item, userMap.get(item.userId))),
      meta: { page: safePage, limit: safeLimit, total, totalPages: Math.ceil(total / safeLimit) },
    };
  }

  async findByUser(userId: string) {
    const limit = await this.repo.findOne({ where: { userId } });
    if (!limit) return null;
    const user = await this.userRepo.findOne({ where: { userId } });
    return this.mapLimit(limit, user);
  }

  async getUserDetail(userId: string) {
    const creditLimit = await this.findByUser(userId);
    if (!creditLimit) throw new NotFoundException('Chưa cài hạn mức cho người dùng này');

    const [orders, transactions] = await Promise.all([
      this.getCreditOrders(userId, 1, 20),
      this.getTransactions(userId, 1, 20),
    ]);

    const overdueOrders = orders.items.filter((order) => order.isOverdue).length;
    return {
      creditLimit,
      summary: {
        creditLimit: creditLimit.creditLimit,
        currentDebt: creditLimit.currentDebt,
        availableCredit: creditLimit.availableCredit,
        usagePct: creditLimit.usagePct,
        paymentTerms: creditLimit.paymentTerms,
        overdueOrders,
      },
      orders,
      transactions,
    };
  }

  async upsert(dto: UpsertCreditLimitDto) {
    const user = await this.userRepo.findOne({ where: { userId: dto.userId } });
    if (!user) throw new NotFoundException('Không tìm thấy người dùng');

    let existing = await this.repo.findOne({ where: { userId: dto.userId } });
    if (!existing) {
      existing = this.repo.create({
        limitId: uuidv4(),
        userId: dto.userId,
        creditLimit: String(dto.creditLimit),
        currentDebt: '0',
        paymentTerms: 30,
        isActive: true,
        notes: dto.notes ?? null,
      });
    } else {
      existing.creditLimit = String(dto.creditLimit);
      existing.isActive = true;
      if (dto.notes !== undefined) existing.notes = dto.notes;
    }

    await this.repo.save(existing);
    return this.findByUser(dto.userId);
  }

  private async calculateCreditDebt(userId: string, manager = this.dataSource.manager) {
    const orders = await manager.find(OrderEntity, {
      where: {
        userId,
        paymentMethod: PaymentMethod.CREDIT,
        paymentStatus: PaymentStatus.UNPAID,
      },
      order: { createdAt: 'ASC' },
    });
    const validOrders = orders.filter(
      (order) => ![OrderStatus.CANCELLED, OrderStatus.RETURNED].includes(order.orderStatus),
    );
    if (!validOrders.length) return 0;

    const orderIds = validOrders.map((order) => order.orderId);
    const allocations = await manager
      .getRepository(CustomerCreditTransactionEntity)
      .createQueryBuilder('tx')
      .select('tx.order_id', 'orderId')
      .addSelect('COALESCE(SUM(tx.amount), 0)', 'paid')
      .where('tx.type = :type', { type: CustomerCreditTransactionType.ORDER_PAYMENT_ALLOCATED })
      .andWhere('tx.order_id IN (:...orderIds)', { orderIds })
      .groupBy('tx.order_id')
      .getRawMany<{ orderId: string; paid: string }>();
    const paidMap = new Map(allocations.map((item) => [item.orderId, Number(item.paid ?? 0)]));

    return validOrders.reduce((sum, order) => {
      const paid = paidMap.get(order.orderId) ?? 0;
      return sum + Math.max(0, Number(order.totalPayment) - paid);
    }, 0);
  }

  async syncDebt(userId: string, createdBy?: string) {
    return this.dataSource.transaction(async (manager) => {
      const limitRepo = manager.getRepository(CustomerCreditLimitEntity);
      const txRepo = manager.getRepository(CustomerCreditTransactionEntity);
      const limit = await limitRepo.findOne({ where: { userId } });
      if (!limit) throw new NotFoundException('Chưa cài hạn mức cho người dùng này');

      const before = Number(limit.currentDebt ?? 0);
      const debt = await this.calculateCreditDebt(userId, manager);
      limit.currentDebt = debt.toFixed(2);
      await limitRepo.save(limit);

      if (Math.abs(before - debt) >= 1) {
        await txRepo.save(txRepo.create({
          transactionId: uuidv4(),
          userId,
          orderId: null,
          type: CustomerCreditTransactionType.SYNC_ADJUSTMENT,
          amount: (debt - before).toFixed(2),
          balanceBefore: before.toFixed(2),
          balanceAfter: debt.toFixed(2),
          referenceNo: null,
          note: 'Đối soát công nợ từ đơn hàng',
          createdBy: createdBy ?? null,
        }));
      }

      return this.findByUser(userId);
    });
  }

  async getMyLimit(userId: string) {
    const limit = await this.repo.findOne({ where: { userId, isActive: true as unknown as boolean } });
    if (!limit) return null;
    const availableCredit = Math.max(0, Number(limit.creditLimit) - Number(limit.currentDebt ?? 0));
    return {
      creditLimit: Number(limit.creditLimit),
      currentDebt: Number(limit.currentDebt ?? 0),
      availableCredit,
      isActive: limit.isActive,
    };
  }

  async recordPayment(dto: RecordPaymentDto, createdBy?: string) {
    if (dto.amount <= 0) {
      throw new BadRequestException({
        message: 'Số tiền thu phải lớn hơn 0.',
        error: 'CREDIT_PAYMENT_AMOUNT_INVALID',
      });
    }

    return this.dataSource.transaction(async (manager) => {
      const limitRepo = manager.getRepository(CustomerCreditLimitEntity);
      const txRepo = manager.getRepository(CustomerCreditTransactionEntity);
      const orderRepo = manager.getRepository(OrderEntity);
      const paymentTxRepo = manager.getRepository(PaymentTransactionEntity);

      const limit = await limitRepo.findOne({ where: { userId: dto.userId } });
      if (!limit || !limit.isActive) {
        throw new NotFoundException('Chưa cài hạn mức cho người dùng này');
      }

      const before = Number(limit.currentDebt ?? 0);
      if (before <= 0) {
        throw new BadRequestException({
          message: 'Khách hàng hiện không còn công nợ để thu.',
          error: 'CREDIT_NO_OUTSTANDING_DEBT',
        });
      }
      if (dto.amount > before) {
        throw new BadRequestException({
          message: 'Số tiền thu không được vượt quá công nợ hiện tại.',
          error: 'CREDIT_PAYMENT_EXCEEDS_DEBT',
        });
      }

      const after = Math.max(0, before - dto.amount);
      limit.currentDebt = after.toFixed(2);
      if (dto.notes) limit.notes = dto.notes;
      await limitRepo.save(limit);

      const referenceNo = dto.referenceNo?.trim() || `CREDIT-${Date.now()}`;
      await txRepo.save(txRepo.create({
        transactionId: uuidv4(),
        userId: dto.userId,
        orderId: null,
        type: CustomerCreditTransactionType.PAYMENT_RECEIVED,
        amount: dto.amount.toFixed(2),
        balanceBefore: before.toFixed(2),
        balanceAfter: after.toFixed(2),
        referenceNo,
        note: dto.notes ?? null,
        createdBy: createdBy ?? null,
      }));

      let remaining = dto.amount;
      const orders = await this.getRawCreditOrdersForAllocation(dto.userId, manager);
      for (const order of orders) {
        if (remaining <= 0) break;
        const allocated = Math.min(remaining, order.outstanding);
        if (allocated <= 0) continue;
        remaining -= allocated;

        await txRepo.save(txRepo.create({
          transactionId: uuidv4(),
          userId: dto.userId,
          orderId: order.orderId,
          type: CustomerCreditTransactionType.ORDER_PAYMENT_ALLOCATED,
          amount: allocated.toFixed(2),
          balanceBefore: before.toFixed(2),
          balanceAfter: after.toFixed(2),
          referenceNo,
          note: dto.notes ?? null,
          createdBy: createdBy ?? null,
        }));

        const totalAllocated = order.paidByCredit + allocated;
        if (totalAllocated >= Number(order.totalPayment) - 0.5) {
          await orderRepo.update(
            { orderId: order.orderId },
            { paymentStatus: PaymentStatus.PAID },
          );
        }

        await paymentTxRepo.save(paymentTxRepo.create({
          orderId: order.orderId,
          userId: dto.userId,
          provider: PaymentMethod.CREDIT,
          transactionRef: referenceNo,
          transactionStatus: PaymentTransactionStatus.SUCCESS,
          paymentStatus:
            totalAllocated >= Number(order.totalPayment) - 0.5
              ? PaymentStatus.PAID
              : PaymentStatus.UNPAID,
          amount: allocated.toFixed(2),
          gatewayCode: 'CREDIT_COLLECTION',
          gatewayMessage: dto.notes ?? 'Thu tiền công nợ khách sỉ',
          rawPayload: {
            allocationMode: dto.allocationMode ?? 'oldest_first',
            creditBalanceBefore: before,
            creditBalanceAfter: after,
          },
        }));
      }

      return this.getUserDetail(dto.userId);
    });
  }

  private async getRawCreditOrdersForAllocation(userId: string, manager = this.dataSource.manager) {
    const orders = await manager.find(OrderEntity, {
      where: {
        userId,
        paymentMethod: PaymentMethod.CREDIT,
        paymentStatus: PaymentStatus.UNPAID,
      },
      order: { createdAt: 'ASC' },
    });
    const validOrders = orders.filter(
      (order) => ![OrderStatus.CANCELLED, OrderStatus.RETURNED].includes(order.orderStatus),
    );
    if (!validOrders.length) return [];

    const orderIds = validOrders.map((order) => order.orderId);
    const allocations = await manager
      .getRepository(CustomerCreditTransactionEntity)
      .createQueryBuilder('tx')
      .select('tx.order_id', 'orderId')
      .addSelect('COALESCE(SUM(tx.amount), 0)', 'paid')
      .where('tx.type = :type', { type: CustomerCreditTransactionType.ORDER_PAYMENT_ALLOCATED })
      .andWhere('tx.order_id IN (:...orderIds)', { orderIds })
      .groupBy('tx.order_id')
      .getRawMany<{ orderId: string; paid: string }>();
    const paidMap = new Map(allocations.map((item) => [item.orderId, Number(item.paid ?? 0)]));

    return validOrders
      .map((order) => {
        const paidByCredit = paidMap.get(order.orderId) ?? 0;
        return {
          ...order,
          paidByCredit,
          outstanding: Math.max(0, Number(order.totalPayment) - paidByCredit),
        };
      })
      .filter((order) => order.outstanding > 0);
  }

  async getCreditOrders(userId: string, page = 1, limit = 20) {
    const safePage = Math.max(1, page);
    const safeLimit = Math.min(100, Math.max(1, limit));
    const qb = this.orderRepo
      .createQueryBuilder('o')
      .where('o.user_id = :userId', { userId })
      .andWhere('o.payment_method = :method', { method: PaymentMethod.CREDIT })
      .andWhere('o.order_status NOT IN (:...excluded)', {
        excluded: [OrderStatus.CANCELLED, OrderStatus.RETURNED],
      })
      .orderBy('o.created_at', 'DESC')
      .skip((safePage - 1) * safeLimit)
      .take(safeLimit);

    const [orders, total] = await qb.getManyAndCount();
    const orderIds = orders.map((order) => order.orderId);
    const allocations = orderIds.length
      ? await this.transactionRepo
        .createQueryBuilder('tx')
        .select('tx.order_id', 'orderId')
        .addSelect('COALESCE(SUM(tx.amount), 0)', 'paid')
        .where('tx.type = :type', { type: CustomerCreditTransactionType.ORDER_PAYMENT_ALLOCATED })
        .andWhere('tx.order_id IN (:...orderIds)', { orderIds })
        .groupBy('tx.order_id')
        .getRawMany<{ orderId: string; paid: string }>()
      : [];
    const paidMap = new Map(allocations.map((item) => [item.orderId, Number(item.paid ?? 0)]));
    const limitEntity = await this.repo.findOne({ where: { userId } });
    const paymentTerms = limitEntity?.paymentTerms ?? 30;
    const now = Date.now();

    return {
      items: orders.map((order) => {
        const paidByCredit = order.paymentStatus === PaymentStatus.PAID
          ? Number(order.totalPayment)
          : paidMap.get(order.orderId) ?? 0;
        const outstanding = Math.max(0, Number(order.totalPayment) - paidByCredit);
        const dueDate = new Date(order.createdAt);
        dueDate.setDate(dueDate.getDate() + paymentTerms);
        return {
          orderId: order.orderId,
          code: order.orderId.slice(0, 8).toUpperCase(),
          orderStatus: order.orderStatus,
          paymentStatus: order.paymentStatus,
          totalPayment: Number(order.totalPayment),
          paidByCredit,
          outstanding,
          createdAt: order.createdAt,
          dueDate,
          isOverdue: outstanding > 0 && dueDate.getTime() < now,
        };
      }),
      meta: { page: safePage, limit: safeLimit, total, totalPages: Math.ceil(total / safeLimit) },
    };
  }

  async getTransactions(userId: string, page = 1, limit = 20) {
    const safePage = Math.max(1, page);
    const safeLimit = Math.min(100, Math.max(1, limit));
    const [items, total] = await this.transactionRepo.findAndCount({
      where: { userId },
      order: { createdAt: 'DESC' },
      skip: (safePage - 1) * safeLimit,
      take: safeLimit,
    });

    return {
      items,
      meta: { page: safePage, limit: safeLimit, total, totalPages: Math.ceil(total / safeLimit) },
    };
  }

  async checkCreditAllowed(userId: string, orderAmount: number): Promise<{ allowed: boolean; message?: string }> {
    const limit = await this.repo.findOne({ where: { userId } });
    if (!limit || !limit.isActive) return { allowed: true };

    const available = Number(limit.creditLimit) - Number(limit.currentDebt ?? 0);
    if (orderAmount > available) {
      return {
        allowed: false,
        message: `Vượt hạn mức tín dụng. Hạn mức còn lại: ${available.toLocaleString('vi-VN')}đ`,
      };
    }
    return { allowed: true };
  }

  async remove(userId: string) {
    const limit = await this.repo.findOne({ where: { userId } });
    if (!limit) throw new NotFoundException('Không tìm thấy hạn mức');
    limit.isActive = false;
    await this.repo.save(limit);
    return { message: 'Đã vô hiệu hạn mức' };
  }

  async getCustomers(search?: string) {
    const qb = this.userRepo.createQueryBuilder('u')
      .select(['u.userId', 'u.username', 'u.email', 'u.fullName'])
      .where('u.isActive = :active', { active: true })
      .orderBy('u.createdAt', 'DESC')
      .take(100);
    if (search) {
      qb.andWhere('(u.username LIKE :s OR u.email LIKE :s OR u.fullName LIKE :s)', { s: `%${search}%` });
    }
    return qb.getMany();
  }
}
