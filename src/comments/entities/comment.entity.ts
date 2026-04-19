import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum ProductCommentStatus {
  VISIBLE = 'visible',
  HIDDEN = 'hidden',
  DELETED = 'deleted',
}

@Entity({ name: 'comments' })
export class CommentEntity {
  @PrimaryGeneratedColumn({
    name: 'comment_id',
    type: 'bigint',
    unsigned: true,
  })
  commentId: string;

  @Column({ name: 'user_id', type: 'char', length: 36 })
  userId: string;

  @Column({ name: 'product_id', type: 'char', length: 36 })
  productId: string;

  @Column({
    name: 'order_item_id',
    type: 'bigint',
    unsigned: true,
    nullable: true,
  })
  orderItemId: string | null;

  @Column({ name: 'content', type: 'text' })
  content: string;

  @Column({ name: 'rating', type: 'tinyint', nullable: true })
  rating: number | null;

  @Column({ name: 'like_count', type: 'int', default: 0 })
  likeCount: number;

  @Column({ name: 'dislike_count', type: 'int', default: 0 })
  dislikeCount: number;

  @Column({
    name: 'status',
    type: 'enum',
    enum: ProductCommentStatus,
    default: ProductCommentStatus.VISIBLE,
  })
  status: ProductCommentStatus;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;
}
