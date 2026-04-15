import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'order_items' })
export class OrderItemEntity {
  @PrimaryGeneratedColumn({
    name: 'order_item_id',
    type: 'bigint',
    unsigned: true,
  })
  orderItemId: string;

  @Column({ name: 'order_id', type: 'char', length: 36 })
  orderId: string;

  @Column({ name: 'product_id', type: 'char', length: 36 })
  productId: string;

  @Column({ name: 'product_name', type: 'varchar', length: 255 })
  productName: string;

  @Column({ name: 'quantity', type: 'int' })
  quantity: number;

  @Column({
    name: 'unit_price',
    type: 'decimal',
    precision: 15,
    scale: 2,
  })
  unitPrice: string;

  @Column({
    name: 'line_total',
    type: 'decimal',
    precision: 15,
    scale: 2,
  })
  lineTotal: string;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;
}
