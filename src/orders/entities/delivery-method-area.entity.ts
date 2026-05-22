import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'delivery_method_areas' })
export class DeliveryMethodAreaEntity {
  @PrimaryGeneratedColumn({
    name: 'delivery_area_id',
    type: 'bigint',
    unsigned: true,
  })
  deliveryAreaId: string;

  @Column({ name: 'delivery_id', type: 'bigint', unsigned: true })
  deliveryId: string;

  @Column({ name: 'province', type: 'varchar', length: 120 })
  province: string;

  @Column({ name: 'district', type: 'varchar', length: 120, nullable: true })
  district: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;
}
