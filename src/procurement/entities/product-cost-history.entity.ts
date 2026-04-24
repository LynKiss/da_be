import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'product_cost_history' })
export class ProductCostHistoryEntity {
  @PrimaryGeneratedColumn({ name: 'history_id', type: 'bigint', unsigned: true })
  historyId!: string;

  @Column({ name: 'product_id', type: 'char', length: 36 })
  productId!: string;

  @Column({ name: 'gr_id', type: 'char', length: 36, nullable: true })
  grId!: string | null;

  @Column({ name: 'cost_per_unit', type: 'decimal', precision: 15, scale: 2 })
  costPerUnit!: string;

  @Column({ name: 'qty_at_receipt', type: 'int', default: 0 })
  qtyAtReceipt!: number;

  @Column({ name: 'effective_date', type: 'datetime' })
  effectiveDate!: Date;

  @Column({ name: 'notes', type: 'text', nullable: true })
  notes!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;
}
