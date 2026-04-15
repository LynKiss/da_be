import { CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'discount_products' })
export class DiscountProductEntity {
  @PrimaryColumn({ name: 'discount_id', type: 'bigint', unsigned: true })
  discountId: string;

  @PrimaryColumn({ name: 'product_id', type: 'char', length: 36 })
  productId: string;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;
}
