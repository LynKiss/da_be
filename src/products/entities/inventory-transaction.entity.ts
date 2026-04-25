import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum InventoryTransactionType {
  IMPORT = 'import',
  EXPORT = 'export',
  ADJUSTMENT = 'adjustment',
  RETURN_IN = 'return_in',
  RETURN_OUT = 'return_out',
  DAMAGE = 'damage',
}

@Entity({ name: 'inventory_transactions' })
export class InventoryTransactionEntity {
  @PrimaryGeneratedColumn({
    name: 'transaction_id',
    type: 'bigint',
    unsigned: true,
  })
  transactionId: string;

  @Column({ name: 'product_id', type: 'char', length: 36 })
  productId: string;

  @Column({ name: 'performed_by', type: 'char', length: 36, nullable: true })
  performedBy: string | null;

  @Column({
    name: 'transaction_type',
    type: 'enum',
    enum: InventoryTransactionType,
  })
  transactionType: InventoryTransactionType;

  @Column({ name: 'quantity_change', type: 'int' })
  quantityChange: number;

  @Column({ name: 'quantity_before', type: 'int', nullable: true })
  quantityBefore: number | null;

  @Column({ name: 'quantity_after', type: 'int', nullable: true })
  quantityAfter: number | null;

  @Column({
    name: 'unit_cost_at_time',
    type: 'decimal',
    precision: 15,
    scale: 4,
    nullable: true,
  })
  unitCostAtTime: string | null;

  @Column({ name: 'reference_type', type: 'varchar', length: 50, nullable: true })
  referenceType: string | null;

  @Column({ name: 'reference_id', type: 'varchar', length: 36, nullable: true })
  referenceId: string | null;

  @Column({ name: 'note', type: 'varchar', length: 500, nullable: true })
  note: string | null;

  @Column({
    name: 'related_order_id',
    type: 'char',
    length: 36,
    nullable: true,
  })
  relatedOrderId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;
}
