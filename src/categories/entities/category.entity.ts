import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
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
    name: 'parent_id',
    type: 'bigint',
    unsigned: true,
    nullable: true,
  })
  parentId: string | null;

  @Column({
    name: 'is_active',
    type: 'tinyint',
    width: 1,
    default: 1,
  })
  isActive: boolean;

  @Column({
    name: 'sort_order',
    type: 'int',
    default: 0,
  })
  sortOrder: number;

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

  @ManyToOne(() => CategoryEntity, (category) => category.children, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'parent_id', referencedColumnName: 'categoryId' })
  parent?: CategoryEntity | null;

  @OneToMany(() => CategoryEntity, (category) => category.parent)
  children?: CategoryEntity[];
}
