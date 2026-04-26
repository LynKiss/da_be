import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Bundle / Combo sản phẩm — gộp nhiều SP thành 1 SKU bán theo gói.
 *
 * Ví dụ: "Combo trồng rau" = 1 hạt giống + 1 phân + 1 bình tưới với giá ưu đãi.
 *
 * Khi user mua bundle:
 *   - Trừ kho từng SP con theo qty * componentQty
 *   - Hoá đơn ghi tên bundle + breakdown
 *
 * Hiện tại entity foundation. Logic checkout sẽ resolve ở phase tiếp theo.
 */
@Entity({ name: 'product_bundles' })
export class ProductBundleEntity {
  @PrimaryColumn({ name: 'bundle_id', type: 'char', length: 36 })
  bundleId: string;

  @Index('idx_bundle_code', { unique: true })
  @Column({ name: 'bundle_code', type: 'varchar', length: 50 })
  bundleCode: string;

  @Column({ name: 'bundle_name', type: 'varchar', length: 255 })
  bundleName: string;

  @Column({ name: 'description', type: 'text', nullable: true })
  description: string | null;

  @Column({
    name: 'bundle_price',
    type: 'decimal',
    precision: 15,
    scale: 2,
  })
  bundlePrice: string;

  @Column({ name: 'image_url', type: 'varchar', length: 500, nullable: true })
  imageUrl: string | null;

  @Column({ name: 'is_active', type: 'tinyint', width: 1, default: 1 })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;
}

@Entity({ name: 'product_bundle_items' })
export class ProductBundleItemEntity {
  @PrimaryColumn({ name: 'bundle_item_id', type: 'char', length: 36 })
  bundleItemId: string;

  @Index('idx_bundle_item_bundle')
  @Column({ name: 'bundle_id', type: 'char', length: 36 })
  bundleId: string;

  @Index('idx_bundle_item_product')
  @Column({ name: 'product_id', type: 'char', length: 36 })
  productId: string;

  /** Số lượng SP con trong 1 bundle */
  @Column({ name: 'component_qty', type: 'int', default: 1 })
  componentQty: number;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;
}
