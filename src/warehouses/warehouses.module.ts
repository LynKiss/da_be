import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { InventoryTransactionEntity } from '../products/entities/inventory-transaction.entity';
import { ProductEntity } from '../products/entities/product.entity';
import { StockAdjustmentItemEntity } from './entities/stock-adjustment-item.entity';
import { StockAdjustmentEntity } from './entities/stock-adjustment.entity';
import { StockTransferItemEntity } from './entities/stock-transfer-item.entity';
import { StockTransferEntity } from './entities/stock-transfer.entity';
import { WarehouseStockEntity } from './entities/warehouse-stock.entity';
import { WarehouseEntity } from './entities/warehouse.entity';
import { WarehousesController } from './warehouses.controller';
import { WarehousesService } from './warehouses.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      WarehouseEntity,
      WarehouseStockEntity,
      StockTransferEntity,
      StockTransferItemEntity,
      StockAdjustmentEntity,
      StockAdjustmentItemEntity,
      ProductEntity,
      InventoryTransactionEntity,
    ]),
    AuditLogsModule,
  ],
  controllers: [WarehousesController],
  providers: [WarehousesService],
  exports: [WarehousesService, TypeOrmModule],
})
export class WarehousesModule {}
