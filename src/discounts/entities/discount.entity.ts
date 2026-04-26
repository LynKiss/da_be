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

/**
 * Trạng thái duyệt cho discount giảm sâu (>30%).
 *  - NOT_REQUIRED: discount thường, không cần duyệt
 *  - PENDING_APPROVAL: chờ admin duyệt (discount > 30%)
 *  - APPROVED: đã duyệt, có thể dùng
 *  - REJECTED: từ chối, không thể dùng
 */
export enum DiscountApprovalStatus {
  NOT_REQUIRED = 'not_required',
  PENDING_APPROVAL = 'pending_approval',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

export const DISCOUNT_APPROVAL_THRESHOLD_PCT = 30;
export const DISCOUNT_APPROVAL_THRESHOLD_FIXED = 1_000_000;

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

  @Column({
    name: 'approval_status',
    type: 'enum',
    enum: DiscountApprovalStatus,
    default: DiscountApprovalStatus.NOT_REQUIRED,
  })
  approvalStatus: DiscountApprovalStatus;

  @Column({ name: 'approved_by', type: 'char', length: 36, nullable: true })
  approvedBy: string | null;

  @Column({ name: 'approved_at', type: 'datetime', nullable: true })
  approvedAt: Date | null;

  @Column({ name: 'approval_note', type: 'varchar', length: 500, nullable: true })
  approvalNote: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;
}
