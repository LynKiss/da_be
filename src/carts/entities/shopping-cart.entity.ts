import {
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  Column,
} from 'typeorm';

@Entity({ name: 'shopping_carts' })
export class ShoppingCartEntity {
  @PrimaryGeneratedColumn({
    name: 'cart_id',
    type: 'bigint',
    unsigned: true,
  })
  cartId: string;

  @Column({ name: 'user_id', type: 'char', length: 36 })
  userId: string;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;
}
