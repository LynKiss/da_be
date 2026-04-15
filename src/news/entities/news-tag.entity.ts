import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'news_tags' })
export class NewsTagEntity {
  @PrimaryGeneratedColumn({
    name: 'news_tag_id',
    type: 'bigint',
    unsigned: true,
  })
  newsTagId: string;

  @Column({ name: 'tag_name', type: 'varchar', length: 100 })
  tagName: string;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;
}
