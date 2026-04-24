import { Body, Controller, Get, Param, Patch, Post, Query, Request } from '@nestjs/common';
import { RequirePermissions, ResponseMessage } from '../decorator/customize';
import { AdjustmentReason } from './entities/stock-adjustment.entity';
import { WarehousesService } from './warehouses.service';

@Controller('warehouses')
export class WarehousesController {
  constructor(private readonly service: WarehousesService) {}

  // ─── Warehouses ───────────────────────────────────────────────────────────

  @Get()
  @RequirePermissions('manage_products')
  @ResponseMessage('Get warehouses')
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  @RequirePermissions('manage_products')
  @ResponseMessage('Get warehouse')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Get(':id/stock')
  @RequirePermissions('manage_products')
  @ResponseMessage('Get warehouse stock')
  getStock(@Param('id') id: string) {
    return this.service.getStock(id);
  }

  @Post()
  @RequirePermissions('manage_products')
  @ResponseMessage('Create warehouse')
  create(@Body() dto: { name: string; code?: string; address?: string; managerName?: string; phone?: string }) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @RequirePermissions('manage_products')
  @ResponseMessage('Update warehouse')
  update(@Param('id') id: string, @Body() dto: any) {
    return this.service.update(id, dto);
  }

  @Patch(':id/set-default')
  @RequirePermissions('manage_products')
  @ResponseMessage('Set default warehouse')
  setDefault(@Param('id') id: string) {
    return this.service.setDefault(id);
  }

  // ─── Stock Transfers ──────────────────────────────────────────────────────

  @Get('transfers/list')
  @RequirePermissions('manage_products')
  @ResponseMessage('Get stock transfers')
  findAllTransfers(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
  ) {
    return this.service.findAllTransfers(Number(page ?? 1), Number(limit ?? 20), status);
  }

  @Get('transfers/:id')
  @RequirePermissions('manage_products')
  @ResponseMessage('Get stock transfer')
  findOneTransfer(@Param('id') id: string) {
    return this.service.findOneTransfer(id);
  }

  @Post('transfers')
  @RequirePermissions('manage_products')
  @ResponseMessage('Create stock transfer')
  createTransfer(@Body() dto: any, @Request() req: any) {
    return this.service.createTransfer(dto, req.user?.userId);
  }

  @Patch('transfers/:id/ship')
  @RequirePermissions('manage_products')
  @ResponseMessage('Ship stock transfer')
  shipTransfer(@Param('id') id: string, @Request() req: any) {
    return this.service.shipTransfer(id, req.user?.userId);
  }

  @Patch('transfers/:id/receive')
  @RequirePermissions('manage_products')
  @ResponseMessage('Receive stock transfer')
  receiveTransfer(
    @Param('id') id: string,
    @Body('items') items: Array<{ productId: string; qtyReceived: number }>,
    @Request() req: any,
  ) {
    return this.service.receiveTransfer(id, items, req.user?.userId);
  }

  // ─── Stock Adjustments ────────────────────────────────────────────────────

  @Get('adjustments/list')
  @RequirePermissions('manage_products')
  @ResponseMessage('Get stock adjustments')
  findAllAdjustments(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
  ) {
    return this.service.findAllAdjustments(Number(page ?? 1), Number(limit ?? 20), status);
  }

  @Get('adjustments/:id')
  @RequirePermissions('manage_products')
  @ResponseMessage('Get stock adjustment')
  findOneAdjustment(@Param('id') id: string) {
    return this.service.findOneAdjustment(id);
  }

  @Post('adjustments')
  @RequirePermissions('manage_products')
  @ResponseMessage('Create stock adjustment')
  createAdjustment(
    @Body() dto: {
      warehouseId?: string;
      reason: AdjustmentReason;
      adjustmentDate?: string;
      notes?: string;
      items: Array<{ productId: string; qtyBefore: number; qtyAfter: number; notes?: string }>;
    },
    @Request() req: any,
  ) {
    return this.service.createAdjustment(dto, req.user?.userId);
  }

  @Patch('adjustments/:id/approve')
  @RequirePermissions('manage_products')
  @ResponseMessage('Approve stock adjustment')
  approveAdjustment(@Param('id') id: string, @Request() req: any) {
    return this.service.approveAdjustment(id, req.user?.userId);
  }

  @Patch('adjustments/:id/cancel')
  @RequirePermissions('manage_products')
  @ResponseMessage('Cancel stock adjustment')
  cancelAdjustment(@Param('id') id: string) {
    return this.service.cancelAdjustment(id);
  }
}
