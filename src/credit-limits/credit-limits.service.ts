import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { OrderEntity, OrderStatus, PaymentStatus } from '../orders/entities/order.entity';
import { UserEntity } from '../users/entities/user.entity';
import { CustomerCreditLimitEntity } from './entities/customer-credit-limit.entity';
import { RecordPaymentDto, UpsertCreditLimitDto } from './dto/upsert-credit-limit.dto';

@Injectable()
export class CreditLimitsService {
  constructor(
    @InjectRepository(CustomerCreditLimitEntity)
    private readonly repo: Repository<CustomerCreditLimitEntity>,

    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,

    @InjectRepository(OrderEntity)
    private readonly orderRepo: Repository<OrderEntity>,
  ) {}

  async findAll(page = 1, limit = 20) {
    const [items, total] = await this.repo.findAndCount({
      where: { isActive: true as unknown as boolean },
      order: { updatedAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    const enriched = await Promise.all(
      items.map(async (item) => {
        const user = await this.userRepo.findOne({ where: { userId: item.userId } });
        return {
          ...item,
          username: user?.username ?? null,
          email: user?.email ?? null,
          availableCredit: Math.max(0, Number(item.creditLimit) - Number(item.currentDebt ?? 0)),
        };
      }),
    );

    return { items: enriched, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  async findByUser(userId: string) {
    const limit = await this.repo.findOne({ where: { userId } });
    if (!limit) return null;

    const user = await this.userRepo.findOne({ where: { userId } });
    const availableCredit = Math.max(0, Number(limit.creditLimit) - Number(limit.currentDebt ?? 0));

    return {
      ...limit,
      username: user?.username ?? null,
      email: user?.email ?? null,
      availableCredit,
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
      if (dto.notes !== undefined) existing.notes = dto.notes;
    }

    await this.repo.save(existing);
    return this.findByUser(dto.userId);
  }

  async syncDebt(userId: string) {
    const unpaidTotal = await this.orderRepo
      .createQueryBuilder('o')
      .select('COALESCE(SUM(o.total_payment), 0)', 'total')
      .where('o.user_id = :userId', { userId })
      .andWhere('o.payment_status = :ps', { ps: PaymentStatus.UNPAID })
      .andWhere('o.order_status NOT IN (:...cancelled)', {
        cancelled: [OrderStatus.CANCELLED, OrderStatus.RETURNED],
      })
      .getRawOne<{ total: string }>();

    const debt = Number(unpaidTotal?.total ?? 0);
    await this.repo.update({ userId }, { currentDebt: String(debt) });
    return this.findByUser(userId);
  }

  async recordPayment(dto: RecordPaymentDto) {
    const limit = await this.repo.findOne({ where: { userId: dto.userId } });
    if (!limit) throw new NotFoundException('Chưa cài hạn mức cho người dùng này');

    const newDebt = Math.max(0, Number(limit.currentDebt ?? 0) - dto.amount);
    limit.currentDebt = String(newDebt);
    if (dto.notes) limit.notes = dto.notes;
    await this.repo.save(limit);
    return this.findByUser(dto.userId);
  }

  async checkCreditAllowed(userId: string, orderAmount: number): Promise<{ allowed: boolean; message?: string }> {
    const limit = await this.repo.findOne({ where: { userId } });
    if (!limit || !limit.isActive) return { allowed: true };

    const available = Number(limit.creditLimit) - Number(limit.currentDebt ?? 0);
    if (orderAmount > available) {
      return {
        allowed: false,
        message: `Vượt hạn mức tín dụng. Hạn mức còn lại: ${available.toLocaleString('vi-VN')}₫`,
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
}
