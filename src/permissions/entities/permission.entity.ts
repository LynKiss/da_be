import {
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  Column,
} from 'typeorm';

@Entity({ name: 'permissions' })
export class PermissionEntity {
  @PrimaryGeneratedColumn({
    name: 'permission_id',
    type: 'bigint',
    unsigned: true,
  })
  permissionId!: string;

  @Column({
    name: 'permission_key',
    type: 'varchar',
    length: 100,
    unique: true,
  })
  permissionKey!: string;

  @Column({ name: 'permission_name', type: 'varchar', length: 150 })
  permissionName!: string;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt!: Date;
}
