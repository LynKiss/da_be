import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'categories' })
export class CategoryEntity {
  @PrimaryGeneratedColumn({
    name: 'category_id',
    type: 'bigint',
    unsigned: true,
  })
  categoryId: string;

  @Column({
    name: 'category_name',
    type: 'varchar',
    length: 150,
  })
  categoryName: string;

  @Column({
    name: 'category_description',
    type: 'text',
    nullable: true,
  })
  categoryDescription: string | null;

  @Column({
    name: 'category_slug',
    type: 'varchar',
    length: 180,
  })
  categorySlug: string;

  @Column({
    name: 'is_active',
    type: 'tinyint',
    width: 1,
    default: 1,
  })
  isActive: boolean;

  @CreateDateColumn({
    name: 'created_at',
    type: 'datetime',
    default: () => 'CURRENT_TIMESTAMP',
  })
  createdAt: Date;

  @UpdateDateColumn({
    name: 'updated_at',
    type: 'datetime',
    default: () => 'CURRENT_TIMESTAMP',
    onUpdate: 'CURRENT_TIMESTAMP',
  })
  updatedAt: Date;
}
