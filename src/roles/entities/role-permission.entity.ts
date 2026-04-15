import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { PermissionEntity } from '../../permissions/entities/permission.entity';
import { UserRole } from '../../users/entities/user.entity';

@Entity({ name: 'role_permissions' })
export class RolePermissionEntity {
  @PrimaryColumn({
    name: 'role',
    type: 'enum',
    enum: UserRole,
  })
  role: UserRole;

  @PrimaryColumn({
    name: 'permission_id',
    type: 'bigint',
    unsigned: true,
  })
  permissionId: string;

  @Column({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @ManyToOne(() => PermissionEntity, { eager: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'permission_id', referencedColumnName: 'permissionId' })
  permission: PermissionEntity;
}
