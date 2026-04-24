import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'warehouse_stock' })
export class WarehouseStockEntity {
  @PrimaryGeneratedColumn({ name: 'stock_id', type: 'bigint', unsigned: true })
  stockId!: string;

  @Column({ name: 'warehouse_id', type: 'char', length: 36 })
  warehouseId!: string;

  @Column({ name: 'product_id', type: 'char', length: 36 })
  productId!: string;

  @Column({ name: 'quantity', type: 'int', default: 0 })
  quantity!: number;
}
