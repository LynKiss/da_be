import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { SupplierReturnEntity } from './supplier-return.entity';

@Entity({ name: 'supplier_return_items' })
export class SupplierReturnItemEntity {
  @PrimaryGeneratedColumn({ name: 'item_id', type: 'bigint', unsigned: true })
  itemId!: string;

  @Column({ name: 'sr_id', type: 'char', length: 36 })
  srId!: string;

  @Column({ name: 'product_id', type: 'char', length: 36 })
  productId!: string;

  @Column({ name: 'qty_returned', type: 'int', default: 0 })
  qtyReturned!: number;

  @Column({ name: 'unit_price', type: 'decimal', precision: 15, scale: 2 })
  unitPrice!: string;

  @Column({ name: 'has_refund', type: 'tinyint', width: 1, default: 1 })
  hasRefund!: boolean;

  @Column({ name: 'refund_amount', type: 'decimal', precision: 15, scale: 2, default: 0 })
  refundAmount!: string;

  @Column({ name: 'reason', type: 'varchar', length: 500, nullable: true })
  reason!: string | null;

  @ManyToOne(() => SupplierReturnEntity, (r) => r.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sr_id' })
  supplierReturn!: SupplierReturnEntity;
}
