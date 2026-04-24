import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { StockTransferEntity } from './stock-transfer.entity';

@Entity({ name: 'stock_transfer_items' })
export class StockTransferItemEntity {
  @PrimaryGeneratedColumn({ name: 'item_id', type: 'bigint', unsigned: true })
  itemId!: string;

  @Column({ name: 'transfer_id', type: 'char', length: 36 })
  transferId!: string;

  @Column({ name: 'product_id', type: 'char', length: 36 })
  productId!: string;

  @Column({ name: 'qty_requested', type: 'int', default: 0 })
  qtyRequested!: number;

  @Column({ name: 'qty_received', type: 'int', default: 0 })
  qtyReceived!: number;

  @Column({ name: 'notes', type: 'text', nullable: true })
  notes!: string | null;

  @ManyToOne(() => StockTransferEntity, (t) => t.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'transfer_id' })
  transfer!: StockTransferEntity;
}
