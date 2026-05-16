import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { MembershipTier, UserEntity } from '../users/entities/user.entity';
import {
  DiscountApplyTarget,
  DiscountApprovalStatus,
  DiscountEntity,
  DiscountType,
} from '../discounts/entities/discount.entity';
import { OrderEntity, OrderStatus } from '../orders/entities/order.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationChannel } from '../notifications/entities/notification.entity';
import { SettingsService, MembershipTierSetting } from '../settings/settings.service';

@Injectable()
export class MembershipService {
  private readonly logger = new Logger(MembershipService.name);

  constructor(
    @InjectRepository(UserEntity)
    private readonly usersRepo: Repository<UserEntity>,
    @InjectRepository(OrderEntity)
    private readonly ordersRepo: Repository<OrderEntity>,
    @InjectRepository(DiscountEntity)
    private readonly discountsRepo: Repository<DiscountEntity>,
    private readonly notificationsService: NotificationsService,
    private readonly settingsService: SettingsService,
  ) {}

  private async getTierConfigs(): Promise<MembershipTierSetting[]> {
    return this.settingsService.getMembershipTierSettings();
  }

  private calcTierFromConfig(totalSpent: number, configs: MembershipTierSetting[]): MembershipTierSetting | null {
    const sorted = [...configs].sort((a, b) => b.minSpent - a.minSpent);
    return sorted.find((c) => totalSpent >= c.minSpent) ?? null;
  }

  async recalculateAndReward(userId: string): Promise<void> {
    try {
      const user = await this.usersRepo.findOne({ where: { userId } });
      if (!user) return;

      // FIX HIGH: include cả DELIVERED + PARTIAL_DELIVERED + PARTIAL_RETURNED
      // (PARTIAL_RETURNED vẫn còn doanh thu thật của phần đã giao + chưa refund)
      const completedOrders = await this.ordersRepo
        .createQueryBuilder('o')
        .where('o.user_id = :userId', { userId })
        .andWhere('o.order_status IN (:...statuses)', {
          statuses: [
            OrderStatus.DELIVERED,
            OrderStatus.PARTIAL_DELIVERED,
            OrderStatus.PARTIAL_RETURNED,
          ],
        })
        .getMany();

      const grossSpent = completedOrders.reduce(
        (sum, o) => sum + parseFloat(o.totalPayment),
        0,
      );

      // Trừ refund amounts đã hoàn cho user này (return.status = REFUNDED)
      const refundRow = await this.ordersRepo.manager
        .createQueryBuilder()
        .select('COALESCE(SUM(r.refund_amount), 0)', 'total')
        .from('returns', 'r')
        .where('r.user_id = :uid', { uid: userId })
        .andWhere(`r.return_status = 'refunded'`)
        .getRawOne<{ total: string }>();
      const refunded = Number(refundRow?.total ?? 0);
      const totalSpent = Math.max(0, grossSpent - refunded);

      const configs = await this.getTierConfigs();
      const oldTier = user.membershipTier;
      const newTierCfg = this.calcTierFromConfig(totalSpent, configs);
      const newTier = (newTierCfg?.tier as MembershipTier) ?? MembershipTier.NONE;

      user.totalSpent = totalSpent.toFixed(2);
      user.membershipTier = newTier;
      await this.usersRepo.save(user);

      if (newTierCfg && newTier !== MembershipTier.NONE && newTier !== oldTier && this.tierRank(newTier) > this.tierRank(oldTier)) {
        await this.issueLoyaltyCoupon(user, newTierCfg);
      }
    } catch (err) {
      this.logger.error(`Membership recalc failed for user ${userId}: ${err}`);
    }
  }

  private tierRank(tier: MembershipTier): number {
    const order = [MembershipTier.NONE, MembershipTier.SILVER, MembershipTier.GOLD, MembershipTier.DIAMOND];
    return order.indexOf(tier);
  }

  private async issueLoyaltyCoupon(user: UserEntity, tierCfg: MembershipTierSetting): Promise<void> {
    const code = `MEMBER-${tierCfg.tier.toUpperCase()}-${randomUUID().slice(0, 8).toUpperCase()}`;
    const now = new Date();
    const expireDate = new Date(now);
    expireDate.setDate(expireDate.getDate() + tierCfg.couponValidDays);

    const discount = this.discountsRepo.create({
      discountCode: code,
      discountName: `Ưu đãi thành viên ${tierCfg.label}`,
      discountDescription: `Phần thưởng nâng hạng lên ${tierCfg.label} — giảm ${tierCfg.discountPercent}% cho đơn hàng tiếp theo.`,
      discountType: DiscountType.PERCENT,
      discountValue: String(tierCfg.discountPercent),
      appliesTo: DiscountApplyTarget.ORDER,
      userId: user.userId,
      startAt: now,
      expireDate,
      isActive: true,
      usageLimit: 1,
      usedCount: 0,
      minOrderValue: '0.00',
      maxDiscountAmount: null,
      approvalStatus: DiscountApprovalStatus.NOT_REQUIRED,
      approvedBy: null,
      approvedAt: null,
      approvalNote: null,
    });

    await this.discountsRepo.save(discount);

    const title = `Chúc mừng! Bạn đã lên hạng ${tierCfg.label} 🎉`;
    const message =
      `Cảm ơn bạn đã ủng hộ chúng tôi. Bạn vừa được nâng lên hạng thành viên **${tierCfg.label}**.\n` +
      `Mã giảm giá độc quyền dành riêng cho bạn: **${code}** — giảm ${tierCfg.discountPercent}% cho đơn hàng tiếp theo.\n` +
      `Mã có hiệu lực đến ${expireDate.toLocaleDateString('vi-VN')}.`;

    await this.notificationsService.createNotification({
      userId: user.userId,
      email: user.email,
      channel: NotificationChannel.SYSTEM,
      title,
      message,
      metadata: { couponCode: code, tier: tierCfg.tier, discountPercent: tierCfg.discountPercent },
    });

    await this.notificationsService.createNotification({
      userId: user.userId,
      email: user.email,
      channel: NotificationChannel.EMAIL,
      title,
      message,
      metadata: { couponCode: code, tier: tierCfg.tier, discountPercent: tierCfg.discountPercent },
    });

    this.logger.log(`Issued loyalty coupon ${code} (${tierCfg.tier}) to user ${user.userId}`);
  }

  async getAdminOverview(query: { tier?: string; page?: number; limit?: number; search?: string }) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const qb = this.usersRepo.createQueryBuilder('u');
    if (query.tier && query.tier !== 'all') {
      qb.andWhere('u.membership_tier = :tier', { tier: query.tier });
    }
    if (query.search) {
      qb.andWhere('(u.email LIKE :s OR u.full_name LIKE :s OR u.username LIKE :s)', {
        s: `%${query.search}%`,
      });
    }
    qb.orderBy('u.total_spent', 'DESC');

    const [users, total] = await qb.skip(skip).take(limit).getManyAndCount();

    const stats = await this.usersRepo
      .createQueryBuilder('u')
      .select('u.membership_tier', 'tier')
      .addSelect('COUNT(*)', 'count')
      .groupBy('u.membership_tier')
      .getRawMany<{ tier: string; count: string }>();

    const tierStats: Record<string, number> = {};
    for (const s of stats) tierStats[s.tier] = parseInt(s.count, 10);

    const configs = await this.getTierConfigs();

    return {
      data: users.map((u) => {
        const cfg = configs.find((c) => c.tier === u.membershipTier);
        return {
          userId: u.userId,
          username: u.username,
          email: u.email,
          fullName: u.fullName,
          avatarUrl: u.avatarUrl,
          tier: u.membershipTier,
          label: cfg?.label ?? 'Thường',
          totalSpent: parseFloat(u.totalSpent),
          discountPercent: cfg?.discountPercent ?? 0,
        };
      }),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
      tierStats,
    };
  }

  async recalculateAll(): Promise<{ updated: number }> {
    const users = await this.usersRepo.find({ select: ['userId'] });
    for (const u of users) {
      await this.recalculateAndReward(u.userId);
    }
    return { updated: users.length };
  }

  async adminSetTier(userId: string, tier: string): Promise<void> {
    const user = await this.usersRepo.findOne({ where: { userId } });
    if (!user) return;
    user.membershipTier = tier as import('../users/entities/user.entity').MembershipTier;
    await this.usersRepo.save(user);
  }

  async getMyTier(userId: string) {
    const user = await this.usersRepo.findOne({ where: { userId } });
    if (!user) return null;

    const configs = await this.getTierConfigs();
    const spent = parseFloat(user.totalSpent);
    const currentCfg = configs.find((c) => c.tier === user.membershipTier);
    const sortedAsc = [...configs].sort((a, b) => a.minSpent - b.minSpent);
    const nextCfg = sortedAsc.find((c) => c.minSpent > spent);

    return {
      tier: user.membershipTier,
      label: currentCfg?.label ?? 'Thường',
      totalSpent: spent,
      discountPercent: currentCfg?.discountPercent ?? 0,
      nextTier: nextCfg
        ? { tier: nextCfg.tier, label: nextCfg.label, minSpent: nextCfg.minSpent, remaining: nextCfg.minSpent - spent }
        : null,
    };
  }

  async getTierConfig() {
    return this.settingsService.getMembershipTierSettings();
  }

  async saveTierConfig(value: unknown) {
    return this.settingsService.saveMembershipTierSettings(value);
  }
}
