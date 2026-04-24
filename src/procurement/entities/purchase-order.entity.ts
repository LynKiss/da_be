import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { PurchaseOrderItemEntity } from './purchase-order-item.entity';

export enum PurchaseOrderStatus {
  DRAFT = 'draft',
  ORDERED = 'ordered',
  PARTIAL = 'partial',
  RECEIVED = 'received',
  CANCELLED = 'cancelled',
}

@Entity({ name: 'purchase_orders' })
export class PurchaseOrderEntity {
  @PrimaryColumn({ name: 'po_id', type: 'char', length: 36 })
  poId!: string;

  @Column({ name: 'po_code', type: 'varchar', length: 50, unique: true })
  poCode!: string;

  @Column({ name: 'supplier_id', type: 'char', length: 36 })
  supplierId!: string;

  @Column({ name: 'status', type: 'enum', enum: PurchaseOrderStatus, default: PurchaseOrderStatus.DRAFT })
  status!: PurchaseOrderStatus;

  @Column({ name: 'order_date', type: 'date', nullable: true })
  orderDate!: Date | null;

  @Column({ name: 'expected_date', type: 'date', nullable: true })
  expectedDate!: Date | null;

  @Column({ name: 'shipping_cost', type: 'decimal', precision: 15, scale: 2, default: 0 })
  shippingCost!: string;

  @Column({ name: 'other_cost', type: 'decimal', precision: 15, scale: 2, default: 0 })
  otherCost!: string;

  @Column({ name: 'total_amount', type: 'decimal', precision: 15, scale: 2, default: 0 })
  totalAmount!: string;

  @Column({ name: 'payment_status', type: 'enum', enum: ['unpaid', 'partial', 'paid'], default: 'unpaid' })
  paymentStatus!: 'unpaid' | 'partial' | 'paid';

  @Column({ name: 'paid_amount', type: 'decimal', precision: 15, scale: 2, default: 0 })
  paidAmount!: string;

  @Column({ name: 'paid_date', type: 'datetime', nullable: true })
  paidDate!: Date | null;

  @Column({ name: 'payment_notes', type: 'text', nullable: true })
  paymentNotes!: string | null;

  @Column({ name: 'notes', type: 'text', nullable: true })
  notes!: string | null;

  @Column({ name: 'created_by', type: 'char', length: 36, nullable: true })
  createdBy!: string | null;

  @OneToMany(() => PurchaseOrderItemEntity, (item) => item.po, { cascade: true, eager: false })
  items!: PurchaseOrderItemEntity[];

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt!: Date;
}
