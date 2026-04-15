import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'news' })
export class NewsEntity {
  @PrimaryGeneratedColumn({
    name: 'news_id',
    type: 'bigint',
    unsigned: true,
  })
  newsId: string;

  @Column({ name: 'user_id', type: 'char', length: 36 })
  userId: string;

  @Column({ name: 'title', type: 'varchar', length: 255 })
  title: string;

  @Column({
    name: 'title_image_url',
    type: 'varchar',
    length: 500,
    nullable: true,
  })
  titleImageUrl: string | null;

  @Column({ name: 'sub_title', type: 'varchar', length: 255, nullable: true })
  subTitle: string | null;

  @Column({ name: 'slug', type: 'varchar', length: 255 })
  slug: string;

  @Column({ name: 'content', type: 'longtext', nullable: true })
  content: string | null;

  @Column({ name: 'is_draft', type: 'tinyint', width: 1, default: () => '1' })
  isDraft: boolean;

  @Column({
    name: 'is_published',
    type: 'tinyint',
    width: 1,
    default: () => '0',
  })
  isPublished: boolean;

  @Column({ name: 'published_at', type: 'datetime', nullable: true })
  publishedAt: Date | null;

  @Column({ name: 'views', type: 'int', default: 0 })
  views: number;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;
}
