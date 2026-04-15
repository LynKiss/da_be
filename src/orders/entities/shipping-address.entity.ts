import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'shipping_addresses' })
export class ShippingAddressEntity {
  @PrimaryGeneratedColumn({
    name: 'shipping_address_id',
    type: 'bigint',
    unsigned: true,
  })
  shippingAddressId: string;

  @Column({ name: 'user_id', type: 'char', length: 36 })
  userId: string;

  @Column({ name: 'recipient_name', type: 'varchar', length: 150 })
  recipientName: string;

  @Column({ name: 'phone', type: 'varchar', length: 20 })
  phone: string;

  @Column({ name: 'address_line', type: 'varchar', length: 255 })
  addressLine: string;

  @Column({ name: 'ward', type: 'varchar', length: 120, nullable: true })
  ward: string | null;

  @Column({ name: 'district', type: 'varchar', length: 120, nullable: true })
  district: string | null;

  @Column({ name: 'province', type: 'varchar', length: 120, nullable: true })
  province: string | null;

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
