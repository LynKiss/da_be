import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { GoodsReceiptItemEntity } from './goods-receipt-item.entity';

export enum GoodsReceiptStatus {
  DRAFT = 'draft',
  CONFIRMED = 'confirmed',
  CANCELLED = 'cancelled',
}

@Entity({ name: 'goods_receipts' })
export class GoodsReceiptEntity {
  @PrimaryColumn({ name: 'gr_id', type: 'char', length: 36 })
  grId!: string;

  @Column({ name: 'gr_code', type: 'varchar', length: 50, unique: true })
  grCode!: string;

  @Column({ name: 'po_id', type: 'char', length: 36, nullable: true })
  poId!: string | null;

  @Column({ name: 'supplier_id', type: 'char', length: 36 })
  supplierId!: string;

  @Column({ name: 'receipt_date', type: 'date' })
  receiptDate!: Date;

  @Column({ name: 'shipping_cost', type: 'decimal', precision: 15, scale: 2, default: 0 })
  shippingCost!: string;

  @Column({ name: 'other_cost', type: 'decimal', precision: 15, scale: 2, default: 0 })
  otherCost!: string;

  @Column({ name: 'status', type: 'enum', enum: GoodsReceiptStatus, default: GoodsReceiptStatus.DRAFT })
  status!: GoodsReceiptStatus;

  @Column({ name: 'notes', type: 'text', nullable: true })
  notes!: string | null;

  @Column({ name: 'created_by', type: 'char', length: 36, nullable: true })
  createdBy!: string | null;

  @OneToMany(() => GoodsReceiptItemEntity, (item) => item.receipt, { cascade: true, eager: false })
  items!: GoodsReceiptItemEntity[];

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt!: Date;
}
