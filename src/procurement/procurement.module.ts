import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { InventoryTransactionEntity } from '../products/entities/inventory-transaction.entity';
import { ProductEntity } from '../products/entities/product.entity';
import { WarehouseEntity } from '../warehouses/entities/warehouse.entity';
import { WarehouseStockEntity } from '../warehouses/entities/warehouse-stock.entity';
import { GoodsReceiptItemEntity } from './entities/goods-receipt-item.entity';
import { GoodsReceiptEntity } from './entities/goods-receipt.entity';
import { ProductCostHistoryEntity } from './entities/product-cost-history.entity';
import { PurchaseOrderItemEntity } from './entities/purchase-order-item.entity';
import { PurchaseOrderEntity } from './entities/purchase-order.entity';
import { SupplierReturnItemEntity } from './entities/supplier-return-item.entity';
import { SupplierReturnEntity } from './entities/supplier-return.entity';
import { ProcurementController } from './procurement.controller';
import { ProcurementService } from './procurement.service';

@Module({
  imports: [
    AuditLogsModule,
    TypeOrmModule.forFeature([
      PurchaseOrderEntity,
      PurchaseOrderItemEntity,
      GoodsReceiptEntity,
      GoodsReceiptItemEntity,
      SupplierReturnEntity,
      SupplierReturnItemEntity,
      ProductCostHistoryEntity,
      ProductEntity,
      InventoryTransactionEntity,
      WarehouseEntity,
      WarehouseStockEntity,
    ]),
  ],
  controllers: [ProcurementController],
  providers: [ProcurementService],
  exports: [ProcurementService, TypeOrmModule],
})
export class ProcurementModule {}
