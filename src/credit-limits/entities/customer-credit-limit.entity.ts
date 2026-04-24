import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'customer_credit_limits' })
export class CustomerCreditLimitEntity {
  @PrimaryColumn({ name: 'limit_id', type: 'char', length: 36 })
  limitId: string;

  @Column({ name: 'user_id', type: 'char', length: 36, unique: true })
  userId: string;

  @Column({ name: 'credit_limit', type: 'decimal', precision: 15, scale: 2, default: 0 })
  creditLimit: string;

  @Column({ name: 'current_debt', type: 'decimal', precision: 15, scale: 2, nullable: true, default: 0 })
  currentDebt: string;

  @Column({ name: 'payment_terms', type: 'int', default: 30 })
  paymentTerms: number;

  @Column({ name: 'is_active', type: 'tinyint', width: 1, default: 1 })
  isActive: boolean;

  @Column({ name: 'notes', type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;
}
