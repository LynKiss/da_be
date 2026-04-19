import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import {
  RequirePermissions,
  ResponseMessage,
  User,
} from '../decorator/customize';
import type { IUser } from '../users/users.interface';
import { AdjustInventoryDto } from './dto/adjust-inventory.dto';
import { ImportInventoryDto } from './dto/import-inventory.dto';
import { QueryInventoryTransactionsDto } from './dto/query-inventory-transactions.dto';
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
    @Body() importInventoryDto: ImportInventoryDto,
  ) {
    return this.productsService.importInventory(
      currentUser._id,
      importInventoryDto,
    );
  }

  @Post('transactions/adjust')
  @RequirePermissions('manage_inventory')
  @ResponseMessage('Adjust inventory')
  adjustInventory(
    @User() currentUser: IUser,
    @Body() adjustInventoryDto: AdjustInventoryDto,
  ) {
    return this.productsService.adjustInventory(
      currentUser._id,
      adjustInventoryDto,
    );
  }
}
