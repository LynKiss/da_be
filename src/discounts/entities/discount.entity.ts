import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum DiscountType {
  PERCENT = 'percent',
  FIXED = 'fixed',
}

export enum DiscountApplyTarget {
  ORDER = 'order',
  CATEGORY = 'category',
  PRODUCT = 'product',
}

@Entity({ name: 'discounts' })
export class DiscountEntity {
  @PrimaryGeneratedColumn({
    name: 'discount_id',
    type: 'bigint',
    unsigned: true,
  })
  discountId: string;

  @Column({ name: 'discount_code', type: 'varchar', length: 50 })
  discountCode: string;

  @Column({ name: 'discount_name', type: 'varchar', length: 255 })
  discountName: string;

  @Column({
    name: 'discount_type',
    type: 'enum',
    enum: DiscountType,
    default: DiscountType.PERCENT,
  })
  discountType: DiscountType;

  @Column({
    name: 'applies_to',
    type: 'enum',
    enum: DiscountApplyTarget,
    default: DiscountApplyTarget.ORDER,
  })
  appliesTo: DiscountApplyTarget;

  @Column({ name: 'start_at', type: 'datetime' })
  startAt: Date;

  @Column({ name: 'user_id', type: 'char', length: 36, nullable: true })
  userId: string | null;

  @Column({ name: 'discount_description', type: 'text', nullable: true })
  discountDescription: string | null;

  @Column({
    name: 'discount_value',
    type: 'decimal',
    precision: 15,
    scale: 2,
  })
  discountValue: string;

  @Column({ name: 'expire_date', type: 'datetime' })
  expireDate: Date;

  @Column({ name: 'is_active', type: 'tinyint', width: 1, default: () => '1' })
  isActive: boolean;

  @Column({ name: 'usage_limit', type: 'int', nullable: true })
  usageLimit: number | null;

  @Column({ name: 'used_count', type: 'int', default: 0 })
  usedCount: number;

  @Column({
    name: 'min_order_value',
    type: 'decimal',
    precision: 15,
    scale: 2,
    default: '0.00',
  })
  minOrderValue: string;

  @Column({
    name: 'max_discount_amount',
    type: 'decimal',
    precision: 15,
    scale: 2,
    nullable: true,
  })
  maxDiscountAmount: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;
}
