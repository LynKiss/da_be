import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'delivery_methods' })
export class DeliveryMethodEntity {
  @PrimaryGeneratedColumn({
    name: 'delivery_id',
    type: 'bigint',
    unsigned: true,
  })
  deliveryId: string;

  @Column({ name: 'name', type: 'varchar', length: 150 })
  name: string;

  @Column({ name: 'description', type: 'text', nullable: true })
  description: string | null;

  @Column({
    name: 'base_price',
    type: 'decimal',
    precision: 15,
    scale: 2,
    default: '0.00',
  })
  basePrice: string;

  @Column({
    name: 'min_order_amount',
    type: 'decimal',
    precision: 15,
    scale: 2,
    default: '0.00',
  })
  minOrderAmount: string;

  @Column({ name: 'region', type: 'varchar', length: 150, nullable: true })
  region: string | null;

  @Column({ name: 'is_active', type: 'tinyint', width: 1, default: () => '1' })
  isActive: boolean;

  @Column({
    name: 'is_default',
    type: 'tinyint',
    width: 1,
    default: () => '0',
  })
  isDefault: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;
}
