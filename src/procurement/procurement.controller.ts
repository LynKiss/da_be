import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
} from '@nestjs/common';
import { RequirePermissions, ResponseMessage } from '../decorator/customize';
import { CreateGrDto } from './dto/create-gr.dto';
import { CreatePoDto } from './dto/create-po.dto';
import { CreateSrDto } from './dto/create-sr.dto';
import { QueryProcurementDto } from './dto/query-procurement.dto';
import { PurchaseOrderStatus } from './entities/purchase-order.entity';
import { ProcurementService } from './procurement.service';

function getPerformer(req: any, ip?: string) {
  const user = req.user;
  if (!user?._id) return undefined;
  return { userId: user._id as string, username: user.username as string, ip };
}

function getIp(req: any): string | undefined {
  return (req.headers?.['x-forwarded-for'] as string)?.split(',')[0]?.trim()
    ?? req.ip
    ?? undefined;
}

@Controller('procurement')
export class ProcurementController {
  constructor(private readonly service: ProcurementService) {}

  // ─── Purchase Orders ──────────────────────────────────────────────────────

  @Get('purchase-orders')
  @RequirePermissions('manage_products')
  @ResponseMessage('Get purchase orders')
  findAllPos(@Query() query: QueryProcurementDto) {
    return this.service.findAllPos(query);
  }

  @Get('purchase-orders/:id')
  @RequirePermissions('manage_products')
  @ResponseMessage('Get purchase order detail')
  findOnePo(@Param('id') id: string) {
    return this.service.findOnePo(id);
  }

  @Post('purchase-orders')
  @RequirePermissions('manage_products')
  @ResponseMessage('Create purchase order')
  createPo(@Body() dto: CreatePoDto, @Request() req: any) {
    return this.service.createPo(dto, getPerformer(req, getIp(req)));
  }

  @Patch('purchase-orders/:id/status')
  @RequirePermissions('manage_products')
  @ResponseMessage('Update PO status')
  updatePoStatus(
    @Param('id') id: string,
    @Body('status') status: PurchaseOrderStatus,
    @Request() req: any,
  ) {
    return this.service.updatePoStatus(id, status, getPerformer(req, getIp(req)));
  }

  // ─── Goods Receipts ───────────────────────────────────────────────────────

  @Get('goods-receipts')
  @RequirePermissions('manage_products')
  @ResponseMessage('Get goods receipts')
  findAllGrs(@Query() query: QueryProcurementDto) {
    return this.service.findAllGrs(query);
  }

  @Get('goods-receipts/:id')
  @RequirePermissions('manage_products')
  @ResponseMessage('Get goods receipt detail')
  findOneGr(@Param('id') id: string) {
    return this.service.findOneGr(id);
  }

  @Post('goods-receipts')
  @RequirePermissions('manage_products')
  @ResponseMessage('Create goods receipt')
  createGr(@Body() dto: CreateGrDto, @Request() req: any) {
    return this.service.createGr(dto, getPerformer(req, getIp(req)));
  }

  @Post('goods-receipts/preview-cost')
  @RequirePermissions('manage_products')
  @ResponseMessage('Preview landed cost')
  previewCost(@Body() dto: CreateGrDto) {
    return this.service.previewGrCost(dto);
  }

  @Patch('goods-receipts/:id/confirm')
  @RequirePermissions('manage_products')
  @ResponseMessage('Confirm goods receipt')
  confirmGr(@Param('id') id: string, @Request() req: any) {
    return this.service.confirmGr(id, getPerformer(req, getIp(req)));
  }

  @Patch('goods-receipts/:id/cancel')
  @RequirePermissions('manage_products')
  @ResponseMessage('Cancel goods receipt')
  cancelGr(@Param('id') id: string, @Request() req: any) {
    return this.service.cancelGr(id, getPerformer(req, getIp(req)));
  }

  // ─── Supplier Returns ─────────────────────────────────────────────────────

  @Get('supplier-returns')
  @RequirePermissions('manage_products')
  @ResponseMessage('Get supplier returns')
  findAllSrs(@Query() query: QueryProcurementDto) {
    return this.service.findAllSrs(query);
  }

  @Get('supplier-returns/:id')
  @RequirePermissions('manage_products')
  @ResponseMessage('Get supplier return detail')
  findOneSr(@Param('id') id: string) {
    return this.service.findOneSr(id);
  }

  @Post('supplier-returns')
  @RequirePermissions('manage_products')
  @ResponseMessage('Create supplier return')
  createSr(@Body() dto: CreateSrDto, @Request() req: any) {
    return this.service.createSr(dto, getPerformer(req, getIp(req)));
  }

  @Patch('supplier-returns/:id/confirm')
  @RequirePermissions('manage_products')
  @ResponseMessage('Confirm supplier return')
  confirmSr(@Param('id') id: string, @Request() req: any) {
    return this.service.confirmSr(id, getPerformer(req, getIp(req)));
  }

  // ─── Cost History ─────────────────────────────────────────────────────────

  @Get('cost-history/:productId')
  @RequirePermissions('manage_products')
  @ResponseMessage('Get product cost history')
  getCostHistory(@Param('productId') productId: string) {
    return this.service.getCostHistory(productId);
  }
}
