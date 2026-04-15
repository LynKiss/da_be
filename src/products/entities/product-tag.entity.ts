import { CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'product_tags' })
export class ProductTagEntity {
  @PrimaryColumn({ name: 'product_id', type: 'char', length: 36 })
  productId: string;

  @PrimaryColumn({ name: 'tag_id', type: 'bigint', unsigned: true })
  tagId: string;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;
}
