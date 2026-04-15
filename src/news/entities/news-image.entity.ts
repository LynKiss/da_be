import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'news_images' })
export class NewsImageEntity {
  @PrimaryGeneratedColumn({
    name: 'news_image_id',
    type: 'bigint',
    unsigned: true,
  })
  newsImageId: string;

  @Column({ name: 'news_id', type: 'bigint', unsigned: true })
  newsId: string;

  @Column({ name: 'image_url', type: 'varchar', length: 500 })
  imageUrl: string;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;
}
