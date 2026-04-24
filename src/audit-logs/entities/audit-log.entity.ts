import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'audit_logs' })
export class AuditLogEntity {
  @PrimaryGeneratedColumn({ name: 'log_id', type: 'bigint', unsigned: true })
  logId: string;

  @Column({ name: 'entity_type', type: 'varchar', length: 100 })
  entityType: string;

  @Column({ name: 'entity_id', type: 'varchar', length: 36 })
  entityId: string;

  @Column({
    name: 'action',
    type: 'enum',
    enum: ['create', 'update', 'delete', 'confirm', 'cancel', 'approve', 'reject', 'apply_price'],
  })
  action: string;

  @Column({ name: 'changed_by', type: 'char', length: 36, nullable: true })
  changedBy: string | null;

  @Column({ name: 'before_data', type: 'longtext', nullable: true })
  beforeData: string | null;

  @Column({ name: 'after_data', type: 'longtext', nullable: true })
  afterData: string | null;

  @Column({ name: 'ip_address', type: 'varchar', length: 45, nullable: true })
  ipAddress: string | null;

  @Column({ name: 'notes', type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn({ name: 'changed_at', type: 'datetime' })
  changedAt: Date;
}
