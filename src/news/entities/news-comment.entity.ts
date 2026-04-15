import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum NewsCommentStatus {
  VISIBLE = 'visible',
  HIDDEN = 'hidden',
  DELETED = 'deleted',
}

@Entity({ name: 'news_comments' })
export class NewsCommentEntity {
  @PrimaryGeneratedColumn({
    name: 'comment_id',
    type: 'bigint',
    unsigned: true,
  })
  commentId: string;

  @Column({ name: 'user_id', type: 'char', length: 36 })
  userId: string;

  @Column({ name: 'news_id', type: 'bigint', unsigned: true })
  newsId: string;

  @Column({ name: 'content', type: 'text' })
  content: string;

  @Column({ name: 'like_count', type: 'int', default: 0 })
  likeCount: number;

  @Column({ name: 'dislike_count', type: 'int', default: 0 })
  dislikeCount: number;

  @Column({
    name: 'status',
    type: 'enum',
    enum: NewsCommentStatus,
    default: NewsCommentStatus.VISIBLE,
  })
  status: NewsCommentStatus;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;
}
