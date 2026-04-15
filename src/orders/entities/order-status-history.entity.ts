import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { OrderStatus } from './order.entity';

@Entity({ name: 'order_status_history' })
export class OrderStatusHistoryEntity {
  @PrimaryGeneratedColumn({
    name: 'history_id',
    type: 'bigint',
    unsigned: true,
  })
  historyId: string;

  @Column({ name: 'order_id', type: 'char', length: 36 })
  orderId: string;

  @Column({
    name: 'old_status',
    type: 'enum',
    enum: OrderStatus,
    nullable: true,
  })
  oldStatus: OrderStatus | null;

  @Column({
    name: 'new_status',
    type: 'enum',
    enum: OrderStatus,
  })
  newStatus: OrderStatus;

  @Column({ name: 'changed_by', type: 'char', length: 36, nullable: true })
  changedBy: string | null;

  @Column({ name: 'note', type: 'varchar', length: 500, nullable: true })
  note: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;
}
