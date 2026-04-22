import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum SubscriberStatus {
  ACTIVE = 'active',
  UNSUBSCRIBED = 'unsubscribed',
}

@Entity({ name: 'newsletter_subscribers' })
export class NewsletterSubscriberEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'subscriber_id' })
  subscriberId: string;

  @Column({ unique: true, length: 255 })
  email: string;

  @Column({ type: 'varchar', nullable: true, length: 100 })
  name: string | null;

  @Column({ type: 'enum', enum: SubscriberStatus, default: SubscriberStatus.ACTIVE })
  status: SubscriberStatus;

  @Column({ name: 'unsubscribe_token', unique: true, length: 64 })
  unsubscribeToken: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
