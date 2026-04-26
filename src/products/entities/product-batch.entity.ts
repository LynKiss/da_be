import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Lô hàng (Batch/Lot) — phục vụ FEFO (First Expired First Out).
 *
 * Mỗi lần nhập GR có thể tạo 1+ batch với:
 *  - batchCode: mã lô do NCC đặt hoặc auto-gen
 *  - mfgDate / expDate: ngày sản xuất / hết hạn
 *  - qtyReceived: số lượng nhập
 *  - qtyRemaining: số còn lại sau xuất
 *
 * Khi xuất kho cho đơn hàng (chỉ áp dụng khi enable FEFO):
 *   pick các batch sắp hết hạn nhất trước (expDate ASC, NULL last).
 */
@Entity({ name: 'product_batches' })
export class ProductBatchEntity {
  @PrimaryColumn({ name: 'batch_id', type: 'char', length: 36 })
  batchId: string;

  @Index('idx_batch_product')
  @Column({ name: 'product_id', type: 'char', length: 36 })
  productId: string;

  @Column({ name: 'gr_id', type: 'char', length: 36, nullable: true })
  grId: string | null;

  @Column({ name: 'batch_code', type: 'varchar', length: 100 })
  batchCode: string;

  @Column({ name: 'mfg_date', type: 'date', nullable: true })
  mfgDate: Date | null;

  @Index('idx_batch_exp')
  @Column({ name: 'exp_date', type: 'date', nullable: true })
  expDate: Date | null;

  @Column({ name: 'qty_received', type: 'int' })
  qtyReceived: number;

  @Column({ name: 'qty_remaining', type: 'int' })
  qtyRemaining: number;

  @Column({
    name: 'unit_cost',
    type: 'decimal',
    precision: 15,
    scale: 4,
    default: 0,
  })
  unitCost: string;

  @Column({ name: 'note', type: 'varchar', length: 500, nullable: true })
  note: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;
}
