import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { StockTransferItemEntity } from './stock-transfer-item.entity';

export enum StockTransferStatus {
  DRAFT = 'draft',
  SHIPPING = 'shipping',
  RECEIVED = 'received',
  CANCELLED = 'cancelled',
}

@Entity({ name: 'stock_transfers' })
export class StockTransferEntity {
  @PrimaryColumn({ name: 'transfer_id', type: 'char', length: 36 })
  transferId!: string;

  @Column({ name: 'transfer_code', type: 'varchar', length: 50, unique: true })
  transferCode!: string;

  @Column({ name: 'from_warehouse_id', type: 'char', length: 36 })
  fromWarehouseId!: string;

  @Column({ name: 'to_warehouse_id', type: 'char', length: 36 })
  toWarehouseId!: string;

  @Column({ name: 'status', type: 'enum', enum: StockTransferStatus, default: StockTransferStatus.DRAFT })
  status!: StockTransferStatus;

  @Column({ name: 'transfer_date', type: 'date', nullable: true })
  transferDate!: Date | null;

  @Column({ name: 'received_date', type: 'date', nullable: true })
  receivedDate!: Date | null;

  @Column({ name: 'notes', type: 'text', nullable: true })
  notes!: string | null;

  @Column({ name: 'created_by', type: 'char', length: 36, nullable: true })
  createdBy!: string | null;

  @OneToMany(() => StockTransferItemEntity, (item) => item.transfer, { cascade: true, eager: false })
  items!: StockTransferItemEntity[];

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt!: Date;
}
