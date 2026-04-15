import { CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'news_tag_of_news' })
export class NewsTagOfNewsEntity {
  @PrimaryColumn({ name: 'news_id', type: 'bigint', unsigned: true })
  newsId: string;

  @PrimaryColumn({ name: 'news_tag_id', type: 'bigint', unsigned: true })
  newsTagId: string;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;
}
