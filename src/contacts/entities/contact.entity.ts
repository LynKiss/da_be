import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum ContactStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  RESOLVED = 'resolved',
  CLOSED = 'closed',
}

@Entity({ name: 'contacts' })
export class ContactEntity {
  @PrimaryGeneratedColumn({
    name: 'contact_id',
    type: 'bigint',
    unsigned: true,
  })
  contactId: string;

  @Column({ name: 'user_id', type: 'char', length: 36, nullable: true })
  userId: string | null;

  @Column({ name: 'subject', type: 'varchar', length: 255 })
  subject: string;

  @Column({ name: 'message', type: 'text' })
  message: string;

  @Column({
    name: 'status',
    type: 'enum',
    enum: ContactStatus,
    default: ContactStatus.PENDING,
  })
  status: ContactStatus;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;
}
