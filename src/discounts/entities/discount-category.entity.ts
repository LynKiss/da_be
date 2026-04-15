import { CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'discount_categories' })
export class DiscountCategoryEntity {
  @PrimaryColumn({ name: 'discount_id', type: 'bigint', unsigned: true })
  discountId: string;

  @PrimaryColumn({ name: 'category_id', type: 'bigint', unsigned: true })
  categoryId: string;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;
}
