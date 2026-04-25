import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum ReturnStatus {
  REQUESTED = 'requested',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  RECEIVED = 'received',
  INSPECTED = 'inspected',
  REFUNDED = 'refunded',
}

/**
 * Kết luận sau khi admin kiểm tra hàng trả về:
 * - PENDING:            chưa kiểm tra (mặc định khi RECEIVED)
 * - USABLE:             dùng được → nhập lại kho chính
 * - DAMAGED:            hỏng → ghi DAMAGE adjustment, KHÔNG nhập kho
 * - RETURN_TO_SUPPLIER: hàng lỗi từ NCC → cần tạo Supplier Return
 */
export enum ReturnInspectionStatus {
  PENDING = 'pending',
  USABLE = 'usable',
  DAMAGED = 'damaged',
  RETURN_TO_SUPPLIER = 'return_to_supplier',
}

@Entity({ name: 'returns' })
export class ReturnEntity {
  @PrimaryGeneratedColumn({
    name: 'return_id',
    type: 'bigint',
    unsigned: true,
  })
  returnId: string;

  @Column({ name: 'order_id', type: 'char', length: 36 })
  orderId: string;

  @Column({ name: 'order_item_id', type: 'bigint', unsigned: true })
  orderItemId: string;

  @Column({ name: 'user_id', type: 'char', length: 36 })
  userId: string;

  @Column({ name: 'reason', type: 'varchar', length: 255 })
  reason: string;

  @Column({ name: 'description', type: 'text', nullable: true })
  description: string | null;

  @Column({
    name: 'return_status',
    type: 'enum',
    enum: ReturnStatus,
    default: ReturnStatus.REQUESTED,
  })
  returnStatus: ReturnStatus;

  @Column({
    name: 'refund_amount',
    type: 'decimal',
    precision: 15,
    scale: 2,
    nullable: true,
  })
  refundAmount: string | null;

  @Column({
    name: 'inspection_status',
    type: 'enum',
    enum: ReturnInspectionStatus,
    default: ReturnInspectionStatus.PENDING,
  })
  inspectionStatus: ReturnInspectionStatus;

  @Column({ name: 'inspection_note', type: 'varchar', length: 500, nullable: true })
  inspectionNote: string | null;

  @Column({ name: 'inspected_by', type: 'char', length: 36, nullable: true })
  inspectedBy: string | null;

  @Column({ name: 'inspected_at', type: 'datetime', nullable: true })
  inspectedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;
}
