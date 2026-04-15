import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'cart_items' })
export class CartItemEntity {
  @PrimaryGeneratedColumn({
    name: 'cart_item_id',
    type: 'bigint',
    unsigned: true,
  })
  cartItemId: string;

  @Column({ name: 'cart_id', type: 'bigint', unsigned: true })
  cartId: string;

  @Column({ name: 'product_id', type: 'char', length: 36 })
  productId: string;

  @Column({ name: 'quantity', type: 'int' })
  quantity: number;

  @Column({
    name: 'price_at_added',
    type: 'decimal',
    precision: 15,
    scale: 2,
  })
  priceAtAdded: string;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;
}
