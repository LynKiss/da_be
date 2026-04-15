import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'coupon_usage' })
export class CouponUsageEntity {
  @PrimaryGeneratedColumn({
    name: 'usage_id',
    type: 'bigint',
    unsigned: true,
  })
  usageId: string;

  @Column({ name: 'discount_id', type: 'bigint', unsigned: true })
  discountId: string;

  @Column({ name: 'user_id', type: 'char', length: 36 })
  userId: string;

  @Column({ name: 'order_id', type: 'char', length: 36 })
  orderId: string;

  @CreateDateColumn({ name: 'used_at', type: 'datetime' })
  usedAt: Date;
}
