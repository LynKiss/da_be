import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'subcategories' })
export class SubcategoryEntity {
  @PrimaryGeneratedColumn({
    name: 'subcategory_id',
    type: 'bigint',
    unsigned: true,
  })
  subcategoryId: string;

  @Column({ name: 'category_id', type: 'bigint', unsigned: true })
  categoryId: string;

  @Column({ name: 'subcategory_name', type: 'varchar', length: 150 })
  subcategoryName: string;

  @Column({ name: 'subcategory_slug', type: 'varchar', length: 180 })
  subcategorySlug: string;

  @Column({ name: 'is_active', type: 'tinyint', width: 1, default: () => '1' })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;
}
