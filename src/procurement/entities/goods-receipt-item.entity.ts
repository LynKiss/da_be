import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { GoodsReceiptEntity } from './goods-receipt.entity';

@Entity({ name: 'goods_receipt_items' })
export class GoodsReceiptItemEntity {
  @PrimaryGeneratedColumn({ name: 'item_id', type: 'bigint', unsigned: true })
  itemId!: string;

  @Column({ name: 'gr_id', type: 'char', length: 36 })
  grId!: string;

  @Column({ name: 'product_id', type: 'char', length: 36 })
  productId!: string;

  @Column({ name: 'unit', type: 'varchar', length: 50, default: 'cái' })
  unit!: string;

  @Column({ name: 'unit_per_base', type: 'int', default: 1 })
  unitPerBase!: number;

  @Column({ name: 'qty_ordered', type: 'int', default: 0 })
  qtyOrdered!: number;

  @Column({ name: 'qty_received', type: 'int', default: 0 })
  qtyReceived!: number;

  @Column({ name: 'qty_defective', type: 'int', default: 0 })
  qtyDefective!: number;

  @Column({ name: 'qty_returned', type: 'int', default: 0 })
  qtyReturned!: number;

  @Column({ name: 'refund_amount', type: 'decimal', precision: 15, scale: 2, default: 0 })
  refundAmount!: string;

  @Column({ name: 'has_refund', type: 'tinyint', width: 1, default: 1 })
  hasRefund!: boolean;

  @Column({ name: 'unit_price', type: 'decimal', precision: 15, scale: 2 })
  unitPrice!: string;

  @Column({ name: 'landed_cost', type: 'decimal', precision: 15, scale: 2, default: 0 })
  landedCost!: string;

  @Column({ name: 'notes', type: 'text', nullable: true })
  notes!: string | null;

  @ManyToOne(() => GoodsReceiptEntity, (r) => r.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'gr_id' })
  receipt!: GoodsReceiptEntity;
}
