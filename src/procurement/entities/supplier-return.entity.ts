import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { SupplierReturnItemEntity } from './supplier-return-item.entity';

export enum SupplierReturnStatus {
  DRAFT = 'draft',
  CONFIRMED = 'confirmed',
  CANCELLED = 'cancelled',
}

@Entity({ name: 'supplier_returns' })
export class SupplierReturnEntity {
  @PrimaryColumn({ name: 'sr_id', type: 'char', length: 36 })
  srId!: string;

  @Column({ name: 'sr_code', type: 'varchar', length: 50, unique: true })
  srCode!: string;

  @Column({ name: 'gr_id', type: 'char', length: 36, nullable: true })
  grId!: string | null;

  @Column({ name: 'supplier_id', type: 'char', length: 36 })
  supplierId!: string;

  @Column({ name: 'return_date', type: 'date' })
  returnDate!: Date;

  @Column({ name: 'status', type: 'enum', enum: SupplierReturnStatus, default: SupplierReturnStatus.DRAFT })
  status!: SupplierReturnStatus;

  @Column({ name: 'total_refund', type: 'decimal', precision: 15, scale: 2, default: 0 })
  totalRefund!: string;

  @Column({ name: 'notes', type: 'text', nullable: true })
  notes!: string | null;

  @Column({ name: 'created_by', type: 'char', length: 36, nullable: true })
  createdBy!: string | null;

  @OneToMany(() => SupplierReturnItemEntity, (item) => item.supplierReturn, { cascade: true, eager: false })
  items!: SupplierReturnItemEntity[];

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt!: Date;
}
