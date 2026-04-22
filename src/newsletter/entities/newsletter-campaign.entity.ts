import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum CampaignStatus {
  DRAFT = 'draft',
  SENT = 'sent',
}

@Entity({ name: 'newsletter_campaigns' })
export class NewsletterCampaignEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'campaign_id' })
  campaignId: string;

  @Column({ length: 255 })
  subject: string;

  @Column({ type: 'text' })
  body: string;

  @Column({ type: 'enum', enum: CampaignStatus, default: CampaignStatus.DRAFT })
  status: CampaignStatus;

  @Column({ name: 'sent_at', nullable: true, type: 'datetime' })
  sentAt: Date | null;

  @Column({ name: 'recipient_count', type: 'int', default: 0 })
  recipientCount: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
