import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum SupportConversationStatus {
  WAITING_STAFF = 'waiting_staff',
  WAITING_CUSTOMER = 'waiting_customer',
  RESOLVED = 'resolved',
}

export enum SupportChatActorRole {
  CUSTOMER = 'customer',
  STAFF = 'staff',
}

@Entity({ name: 'support_chat_conversations' })
export class SupportConversationEntity {
  @PrimaryColumn({ name: 'conversation_id', type: 'char', length: 36 })
  conversationId: string;

  @Column({ name: 'customer_user_id', type: 'char', length: 36 })
  customerUserId: string;

  @Column({
    name: 'assigned_staff_user_id',
    type: 'char',
    length: 36,
    nullable: true,
  })
  assignedStaffUserId: string | null;

  @Column({
    name: 'status',
    type: 'enum',
    enum: SupportConversationStatus,
    default: SupportConversationStatus.WAITING_STAFF,
  })
  status: SupportConversationStatus;

  @Column({
    name: 'last_message_preview',
    type: 'varchar',
    length: 500,
    nullable: true,
  })
  lastMessagePreview: string | null;

  @Column({
    name: 'last_message_sender_role',
    type: 'enum',
    enum: SupportChatActorRole,
    nullable: true,
  })
  lastMessageSenderRole: SupportChatActorRole | null;

  @Column({ name: 'last_message_at', type: 'datetime', nullable: true })
  lastMessageAt: Date | null;

  @Column({
    name: 'customer_unread_count',
    type: 'int',
    unsigned: true,
    default: () => '0',
  })
  customerUnreadCount: number;

  @Column({
    name: 'staff_unread_count',
    type: 'int',
    unsigned: true,
    default: () => '0',
  })
  staffUnreadCount: number;

  @Column({ name: 'first_response_at', type: 'datetime', nullable: true })
  firstResponseAt: Date | null;

  @Column({ name: 'resolved_at', type: 'datetime', nullable: true })
  resolvedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;
}
