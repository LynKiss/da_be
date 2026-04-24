import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { StockAdjustmentEntity } from './stock-adjustment.entity';

@Entity({ name: 'stock_adjustment_items' })
export class StockAdjustmentItemEntity {
  @PrimaryGeneratedColumn({ name: 'item_id', type: 'bigint', unsigned: true })
  itemId!: string;

  @Column({ name: 'adjustment_id', type: 'char', length: 36 })
  adjustmentId!: string;

  @Column({ name: 'product_id', type: 'char', length: 36 })
  productId!: string;

  @Column({ name: 'qty_before', type: 'int', default: 0 })
  qtyBefore!: number;

  @Column({ name: 'qty_after', type: 'int', default: 0 })
  qtyAfter!: number;

  @Column({ name: 'qty_diff', type: 'int', default: 0 })
  qtyDiff!: number;

  @Column({ name: 'notes', type: 'text', nullable: true })
  notes!: string | null;

  @ManyToOne(() => StockAdjustmentEntity, (a) => a.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'adjustment_id' })
  adjustment!: StockAdjustmentEntity;
}
