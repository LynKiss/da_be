import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { StockAdjustmentItemEntity } from './stock-adjustment-item.entity';

export enum AdjustmentReason {
  DAMAGE = 'damage',
  LOSS = 'loss',
  INVENTORY_COUNT = 'inventory_count',
  SAMPLE = 'sample',
  INTERNAL_USE = 'internal_use',
  OTHER = 'other',
}

export enum AdjustmentStatus {
  DRAFT = 'draft',
  APPROVED = 'approved',
  CANCELLED = 'cancelled',
}

@Entity({ name: 'stock_adjustments' })
export class StockAdjustmentEntity {
  @PrimaryColumn({ name: 'adjustment_id', type: 'char', length: 36 })
  adjustmentId!: string;

  @Column({ name: 'adjustment_code', type: 'varchar', length: 50, unique: true })
  adjustmentCode!: string;

  @Column({ name: 'warehouse_id', type: 'char', length: 36, nullable: true })
  warehouseId!: string | null;

  @Column({ name: 'reason', type: 'enum', enum: AdjustmentReason })
  reason!: AdjustmentReason;

  @Column({ name: 'status', type: 'enum', enum: AdjustmentStatus, default: AdjustmentStatus.DRAFT })
  status!: AdjustmentStatus;

  @Column({ name: 'adjustment_date', type: 'date', nullable: true })
  adjustmentDate!: Date | null;

  @Column({ name: 'notes', type: 'text', nullable: true })
  notes!: string | null;

  @Column({ name: 'approved_by', type: 'char', length: 36, nullable: true })
  approvedBy!: string | null;

  @Column({ name: 'approved_at', type: 'datetime', nullable: true })
  approvedAt!: Date | null;

  @Column({ name: 'created_by', type: 'char', length: 36, nullable: true })
  createdBy!: string | null;

  @OneToMany(() => StockAdjustmentItemEntity, (item) => item.adjustment, { cascade: true, eager: false })
  items!: StockAdjustmentItemEntity[];

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt!: Date;
}
