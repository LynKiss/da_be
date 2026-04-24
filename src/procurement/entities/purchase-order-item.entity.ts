import { Column, Entity, ManyToOne, PrimaryGeneratedColumn, JoinColumn } from 'typeorm';
import { PurchaseOrderEntity } from './purchase-order.entity';

@Entity({ name: 'purchase_order_items' })
export class PurchaseOrderItemEntity {
  @PrimaryGeneratedColumn({ name: 'item_id', type: 'bigint', unsigned: true })
  itemId!: string;

  @Column({ name: 'po_id', type: 'char', length: 36 })
  poId!: string;

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

  @Column({ name: 'unit_price', type: 'decimal', precision: 15, scale: 2 })
  unitPrice!: string;

  @Column({ name: 'notes', type: 'text', nullable: true })
  notes!: string | null;

  @ManyToOne(() => PurchaseOrderEntity, (po) => po.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'po_id' })
  po!: PurchaseOrderEntity;
}
