import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { PermissionEntity } from './permission.entity';

@Entity({ name: 'user_permission_overrides' })
export class UserPermissionOverrideEntity {
  @PrimaryGeneratedColumn({
    name: 'override_id',
    type: 'bigint',
    unsigned: true,
  })
  overrideId!: string;

  @Column({ name: 'user_id', type: 'char', length: 36 })
  userId!: string;

  @Column({
    name: 'permission_id',
    type: 'bigint',
    unsigned: true,
    nullable: true,
  })
  permissionId!: string | null;

  @Column({ name: 'source_project_id', type: 'varchar', length: 120, nullable: true })
  sourceProjectId!: string | null;

  @Column({ name: 'synced_by', type: 'varchar', length: 255, nullable: true })
  syncedBy!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt!: Date;

  @ManyToOne(() => PermissionEntity, { eager: true, nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'permission_id', referencedColumnName: 'permissionId' })
  permission!: PermissionEntity | null;
}
