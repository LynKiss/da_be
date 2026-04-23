import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
} from 'typeorm';
import { SupportChatActorRole } from './support-conversation.entity';

@Entity({ name: 'support_chat_messages' })
export class SupportMessageEntity {
  @PrimaryColumn({ name: 'message_id', type: 'char', length: 36 })
  messageId: string;

  @Column({ name: 'conversation_id', type: 'char', length: 36 })
  conversationId: string;

  @Column({ name: 'sender_user_id', type: 'char', length: 36 })
  senderUserId: string;

  @Column({
    name: 'sender_role',
    type: 'enum',
    enum: SupportChatActorRole,
  })
  senderRole: SupportChatActorRole;

  @Column({ name: 'content', type: 'text' })
  content: string;

  @Column({ name: 'read_at', type: 'datetime', nullable: true })
  readAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;
}
