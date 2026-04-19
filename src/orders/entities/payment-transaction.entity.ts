import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { PaymentMethod, PaymentStatus } from './order.entity';

export enum PaymentTransactionStatus {
  PENDING = 'pending',
  SUCCESS = 'success',
  FAILED = 'failed',
}

@Entity({ name: 'payment_transactions' })
export class PaymentTransactionEntity {
  @PrimaryGeneratedColumn({
    name: 'payment_transaction_id',
    type: 'bigint',
    unsigned: true,
  })
  paymentTransactionId: string;

  @Column({ name: 'order_id', type: 'char', length: 36 })
  orderId: string;

  @Column({ name: 'user_id', type: 'char', length: 36 })
  userId: string;

  @Column({
    name: 'provider',
    type: 'enum',
    enum: PaymentMethod,
  })
  provider: PaymentMethod;

  @Column({ name: 'transaction_ref', type: 'varchar', length: 120 })
  transactionRef: string;

  @Column({
    name: 'transaction_status',
    type: 'enum',
    enum: PaymentTransactionStatus,
    default: PaymentTransactionStatus.PENDING,
  })
  transactionStatus: PaymentTransactionStatus;

  @Column({
    name: 'payment_status',
    type: 'enum',
    enum: PaymentStatus,
    default: PaymentStatus.UNPAID,
  })
  paymentStatus: PaymentStatus;

  @Column({
    name: 'amount',
    type: 'decimal',
    precision: 15,
    scale: 2,
    default: '0.00',
  })
  amount: string;

  @Column({
    name: 'gateway_code',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  gatewayCode: string | null;

  @Column({
    name: 'gateway_message',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  gatewayMessage: string | null;

  @Column({ name: 'raw_payload', type: 'json', nullable: true })
  rawPayload: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;
}
