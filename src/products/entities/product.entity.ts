import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'products' })
export class ProductEntity {
  @PrimaryColumn({ name: 'product_id', type: 'char', length: 36 })
  productId!: string;

  @Column({ name: 'product_name', type: 'varchar', length: 255 })
  productName!: string;

  @Column({
    name: 'product_slug',
    type: 'varchar',
    length: 255,
    unique: true,
  })
  productSlug!: string;

  @Index('idx_products_category')
  @Column({ name: 'category_id', type: 'bigint', unsigned: true })
  categoryId!: string;

  @Index('idx_products_subcategory')
  @Column({
    name: 'subcategory_id',
    type: 'bigint',
    unsigned: true,
    nullable: true,
  })
  subcategoryId!: string | null;

  @Index('idx_products_origin')
  @Column({
    name: 'origin_id',
    type: 'bigint',
    unsigned: true,
    nullable: true,
  })
  originId!: string | null;

  @Index('idx_products_price')
  @Column({
    name: 'product_price',
    type: 'decimal',
    precision: 15,
    scale: 2,
  })
  productPrice!: string;

  @Column({
    name: 'product_price_sale',
    type: 'decimal',
    precision: 15,
    scale: 2,
    nullable: true,
  })
  productPriceSale!: string | null;

  @Column({ name: 'quantity_available', type: 'int', default: 0 })
  quantityAvailable!: number;

  @Column({ name: 'quantity_reserved', type: 'int', default: 0 })
  quantityReserved!: number;

  @Column({
    name: 'avg_cost',
    type: 'decimal',
    precision: 15,
    scale: 4,
    default: 0,
  })
  avgCost!: string;

  @Column({ name: 'description', type: 'longtext', nullable: true })
  description!: string | null;

  @Column({
    name: 'rating_average',
    type: 'decimal',
    precision: 3,
    scale: 2,
    default: 0,
  })
  ratingAverage!: string;

  @Column({ name: 'rating_count', type: 'int', default: 0 })
  ratingCount!: number;

  @Index('idx_products_is_show')
  @Column({
    name: 'is_show',
    type: 'tinyint',
    width: 1,
    default: 1,
  })
  isShow!: boolean;

  @Column({
    name: 'is_featured',
    type: 'tinyint',
    width: 1,
    default: 0,
  })
  isFeatured!: boolean;

  @Index('idx_products_expired_at')
  @Column({
    name: 'expired_at',
    type: 'date',
    nullable: true,
  })
  expiredAt!: Date | null;

  @Column({
    name: 'unit',
    type: 'varchar',
    length: 50,
    nullable: true,
  })
  unit!: string | null;

  @Column({
    name: 'quantity_per_box',
    type: 'int',
    nullable: true,
  })
  quantityPerBox!: number | null;

  @Column({
    name: 'barcode',
    type: 'varchar',
    length: 100,
    unique: true,
    nullable: true,
  })
  barcode!: string | null;

  @Column({
    name: 'box_barcode',
    type: 'varchar',
    length: 100,
    unique: true,
    nullable: true,
  })
  boxBarcode!: string | null;

  @Column({
    name: 'cost_price',
    type: 'decimal',
    precision: 15,
    scale: 2,
    nullable: true,
  })
  costPrice!: string | null;

  @Column({
    name: 'bulk_price',
    type: 'decimal',
    precision: 15,
    scale: 2,
    nullable: true,
  })
  bulkPrice!: string | null;

  @CreateDateColumn({
    name: 'created_at',
    type: 'datetime',
    default: () => 'CURRENT_TIMESTAMP',
  })
  createdAt!: Date;

  @UpdateDateColumn({
    name: 'updated_at',
    type: 'datetime',
    default: () => 'CURRENT_TIMESTAMP',
    onUpdate: 'CURRENT_TIMESTAMP',
  })
  updatedAt!: Date;
}
