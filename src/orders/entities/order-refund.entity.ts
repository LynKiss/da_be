import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum OrderRefundReason {
  RETURN = 'return',
  CANCEL_PAID_ORDER = 'cancel_paid_order',
  SHORT_DELIVERY = 'short_delivery',
  MANUAL_ADJUSTMENT = 'manual_adjustment',
}

export enum OrderRefundStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

@Entity({ name: 'order_refunds' })
export class OrderRefundEntity {
  @PrimaryGeneratedColumn({
    name: 'refund_id',
    type: 'bigint',
    unsigned: true,
  })
  refundId: string;

  @Column({ name: 'order_id', type: 'char', length: 36 })
  orderId: string;

  @Column({
    name: 'return_id',
    type: 'bigint',
    unsigned: true,
    nullable: true,
  })
  returnId: string | null;

  @Column({
    name: 'reason',
    type: 'enum',
    enum: OrderRefundReason,
  })
  reason: OrderRefundReason;

  @Column({
    name: 'amount',
    type: 'decimal',
    precision: 15,
    scale: 2,
  })
  amount: string;

  @Column({
    name: 'refund_status',
    type: 'enum',
    enum: OrderRefundStatus,
    default: OrderRefundStatus.PENDING,
  })
  refundStatus: OrderRefundStatus;

  @Column({
    name: 'payment_provider',
    type: 'varchar',
    length: 50,
    nullable: true,
  })
  paymentProvider: string | null;

  @Column({
    name: 'manual_reference',
    type: 'varchar',
    length: 120,
    nullable: true,
  })
  manualReference: string | null;

  @Column({ name: 'created_by', type: 'char', length: 36, nullable: true })
  createdBy: string | null;

  @Column({ name: 'note', type: 'varchar', length: 500, nullable: true })
  note: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;
}

