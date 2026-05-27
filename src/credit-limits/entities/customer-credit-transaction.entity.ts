import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

export enum CustomerCreditTransactionType {
  PAYMENT_RECEIVED = 'payment_received',
  SYNC_ADJUSTMENT = 'sync_adjustment',
  ORDER_PAYMENT_ALLOCATED = 'order_payment_allocated',
}

@Entity({ name: 'customer_credit_transactions' })
@Index('idx_credit_tx_user_created', ['userId', 'createdAt'])
@Index('idx_credit_tx_order', ['orderId'])
export class CustomerCreditTransactionEntity {
  @PrimaryColumn({ name: 'transaction_id', type: 'char', length: 36 })
  transactionId: string;

  @Column({ name: 'user_id', type: 'char', length: 36 })
  userId: string;

  @Column({ name: 'order_id', type: 'char', length: 36, nullable: true })
  orderId: string | null;

  @Column({
    name: 'type',
    type: 'enum',
    enum: CustomerCreditTransactionType,
  })
  type: CustomerCreditTransactionType;

  @Column({
    name: 'amount',
    type: 'decimal',
    precision: 15,
    scale: 2,
    default: 0,
  })
  amount: string;

  @Column({
    name: 'balance_before',
    type: 'decimal',
    precision: 15,
    scale: 2,
    default: 0,
  })
  balanceBefore: string;

  @Column({
    name: 'balance_after',
    type: 'decimal',
    precision: 15,
    scale: 2,
    default: 0,
  })
  balanceAfter: string;

  @Column({ name: 'reference_no', type: 'varchar', length: 120, nullable: true })
  referenceNo: string | null;

  @Column({ name: 'note', type: 'varchar', length: 500, nullable: true })
  note: string | null;

  @Column({ name: 'created_by', type: 'char', length: 36, nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;
}
