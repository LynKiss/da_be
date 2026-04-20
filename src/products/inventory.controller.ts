import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  RequirePermissions,
  ResponseMessage,
  User,
} from '../decorator/customize';
import type { IUser } from '../users/users.interface';
import { AdjustInventoryDto } from './dto/adjust-inventory.dto';
import { ImportInventoryDto } from './dto/import-inventory.dto';
import { QueryInventoryTransactionsDto } from './dto/query-inventory-transactions.dto';
import {
  RecordDamageDto,
  RecordReturnDto,
} from './dto/record-damage-return.dto';
import { ProductsService } from './products.service';

@Controller('inventory')
export class InventoryController {
  constructor(private readonly productsService: ProductsService) {}

  @Get('transactions')
  @RequirePermissions('manage_inventory')
  @ResponseMessage('Get inventory transactions')
  getInventoryTransactions(@Query() query: QueryInventoryTransactionsDto) {
    return this.productsService.findInventoryTransactions(query);
  }

  @Post('transactions/import')
  @RequirePermissions('manage_inventory')
  @ResponseMessage('Import inventory')
  importInventory(
    @User() currentUser: IUser,
    @Body() dto: ImportInventoryDto,
  ) {
    return this.productsService.importInventory(currentUser._id, dto);
  }

  @Post('transactions/adjust')
  @RequirePermissions('manage_inventory')
  @ResponseMessage('Adjust inventory')
  adjustInventory(
    @User() currentUser: IUser,
    @Body() dto: AdjustInventoryDto,
  ) {
    return this.productsService.adjustInventory(currentUser._id, dto);
  }

  @Post('transactions/damage')
  @RequirePermissions('manage_inventory')
  @ResponseMessage('Record damaged goods')
  recordDamage(
    @User() currentUser: IUser,
    @Body() dto: RecordDamageDto,
  ) {
    return this.productsService.recordDamage(currentUser._id, dto);
  }

  @Post('transactions/return')
  @RequirePermissions('manage_inventory')
  @ResponseMessage('Record returned goods')
  recordReturn(
    @User() currentUser: IUser,
    @Body() dto: RecordReturnDto,
  ) {
    return this.productsService.recordReturn(currentUser._id, dto);
  }

  @Get('summary')
  @RequirePermissions('manage_inventory')
  @ResponseMessage('Get inventory summary')
  getInventorySummary() {
    return this.productsService.getInventorySummary();
  }

  @Get('low-stock')
  @RequirePermissions('manage_inventory')
  @ResponseMessage('Get low stock products')
  getLowStockProducts(@Query('threshold') threshold?: string) {
    return this.productsService.getLowStockProducts(
      threshold ? Number(threshold) : 10,
    );
  }
}
