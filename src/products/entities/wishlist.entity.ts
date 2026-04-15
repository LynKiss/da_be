import { CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'wishlists' })
export class WishlistEntity {
  @PrimaryColumn({ name: 'user_id', type: 'char', length: 36 })
  userId: string;

  @PrimaryColumn({ name: 'product_id', type: 'char', length: 36 })
  productId: string;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;
}
