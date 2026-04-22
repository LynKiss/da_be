import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum OrderTrackingMode {
  DEMO = 'demo',
  LIVE = 'live',
  AUTO_FALLBACK = 'auto_fallback',
}

@Entity({ name: 'order_tracking' })
export class OrderTrackingEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'tracking_id' })
  trackingId: string;

  @Column({ name: 'order_id', type: 'char', length: 36, unique: true })
  orderId: string;

  @Column({
    name: 'mode',
    type: 'enum',
    enum: OrderTrackingMode,
    default: OrderTrackingMode.AUTO_FALLBACK,
  })
  mode: OrderTrackingMode;

  @Column({
    name: 'manual_latitude',
    type: 'decimal',
    precision: 10,
    scale: 7,
    nullable: true,
  })
  manualLatitude: string | null;

  @Column({
    name: 'manual_longitude',
    type: 'decimal',
    precision: 10,
    scale: 7,
    nullable: true,
  })
  manualLongitude: string | null;

  @Column({ name: 'manual_note', type: 'varchar', length: 255, nullable: true })
  manualNote: string | null;

  @Column({
    name: 'manual_updated_by',
    type: 'char',
    length: 36,
    nullable: true,
  })
  manualUpdatedBy: string | null;

  @Column({ name: 'manual_updated_at', type: 'datetime', nullable: true })
  manualUpdatedAt: Date | null;

  @Column({
    name: 'gps_latitude',
    type: 'decimal',
    precision: 10,
    scale: 7,
    nullable: true,
  })
  gpsLatitude: string | null;

  @Column({
    name: 'gps_longitude',
    type: 'decimal',
    precision: 10,
    scale: 7,
    nullable: true,
  })
  gpsLongitude: string | null;

  @Column({
    name: 'gps_heading',
    type: 'decimal',
    precision: 6,
    scale: 2,
    nullable: true,
  })
  gpsHeading: string | null;

  @Column({
    name: 'gps_speed_kph',
    type: 'decimal',
    precision: 8,
    scale: 2,
    nullable: true,
  })
  gpsSpeedKph: string | null;

  @Column({ name: 'gps_provider', type: 'varchar', length: 100, nullable: true })
  gpsProvider: string | null;

  @Column({ name: 'gps_updated_at', type: 'datetime', nullable: true })
  gpsUpdatedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;
}
