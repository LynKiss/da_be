import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'product_description_images' })
export class ProductDescriptionImageEntity {
  @PrimaryGeneratedColumn({
    name: 'product_description_image_id',
    type: 'bigint',
    unsigned: true,
  })
  productDescriptionImageId: string;

  @Column({ name: 'product_id', type: 'char', length: 36 })
  productId: string;

  @Column({ name: 'image_url', type: 'varchar', length: 500 })
  imageUrl: string;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;
}
