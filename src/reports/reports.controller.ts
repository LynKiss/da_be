import { Body, Controller, Get, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { RequirePermissions, ResponseMessage, User } from '../decorator/customize';
import { csvResponseHeaders, toCsv } from '../common/csv-export.util';
import { QueryCouponUsageDto } from './dto/query-coupon-usage.dto';
import {
  QueryAgingDebtDto,
  QueryInventoryLedgerDto,
  QueryInventoryReconciliationDto,
  QueryProfitabilityDto,
  RecordPoPaymentDto,
} from './dto/query-inventory-ledger.dto';
import { QuerySalesSummaryDto } from './dto/query-sales-summary.dto';
import { ReportsService } from './reports.service';

@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('dashboard')
  @RequirePermissions('manage_reports')
  @ResponseMessage('Get dashboard report')
  getDashboard() {
    return this.reportsService.getDashboard();
  }

  @Get('sales-summary')
  @RequirePermissions('manage_reports')
  @ResponseMessage('Get sales summary')
  getSalesSummary(@Query() query: QuerySalesSummaryDto) {
    return this.reportsService.getSalesSummary(query);
  }

  @Get('coupon-usage')
  @RequirePermissions('manage_reports')
  @ResponseMessage('Get coupon usage report')
  getCouponUsage(@Query() query: QueryCouponUsageDto) {
    return this.reportsService.getCouponUsage(query);
  }

  @Get('inventory-ledger')
  @RequirePermissions('manage_reports')
  @ResponseMessage('Get inventory ledger')
  getInventoryLedger(@Query() query: QueryInventoryLedgerDto) {
    return this.reportsService.getInventoryLedger(query);
  }

  @Get('inventory-valuation')
  @RequirePermissions('manage_reports')
  @ResponseMessage('Get inventory valuation')
  getInventoryValuation() {
    return this.reportsService.getInventoryValuation();
  }

  @Get('inventory-reconciliation')
  @RequirePermissions('manage_reports')
  @ResponseMessage('Get inventory reconciliation')
  getInventoryReconciliation(@Query() query: QueryInventoryReconciliationDto) {
    return this.reportsService.getInventoryReconciliation(query);
  }

  @Get('profitability')
  @RequirePermissions('manage_reports')
  @ResponseMessage('Get profitability report')
  getProfitability(@Query() query: QueryProfitabilityDto) {
    return this.reportsService.getProfitability(query);
  }

  @Get('aging-debt')
  @RequirePermissions('manage_reports')
  @ResponseMessage('Get aging debt report')
  getAgingDebt(@Query() query: QueryAgingDebtDto) {
    return this.reportsService.getAgingDebt(query);
  }

  @Post('record-po-payment')
  @RequirePermissions('manage_payments')
  @ResponseMessage('Record PO payment')
  recordPoPayment(@Body() dto: RecordPoPaymentDto, @User() user: { userId?: string }) {
    return this.reportsService.recordPoPayment(dto, user?.userId);
  }

  /** Export CSV - inventory valuation */
  @Get('inventory-valuation/export')
  @RequirePermissions('manage_reports')
  async exportInventoryValuation(@Res() res: Response) {
    const data = await this.reportsService.getInventoryValuation();
    const csv = toCsv(data.items, [
      { key: 'productId', header: 'MÃ£ SP' },
      { key: 'productName', header: 'TÃªn sáº£n pháº©m' },
      { key: 'qtyAvailable', header: 'Tá»“n kháº£ dá»¥ng' },
      { key: 'qtyReserved', header: 'Äang giá»¯' },
      { key: 'totalQty', header: 'Tá»•ng SL' },
      { key: 'avgCost', header: 'GiÃ¡ vá»‘n TB' },
      { key: 'retailPrice', header: 'GiÃ¡ bÃ¡n' },
      { key: 'totalValue', header: 'GiÃ¡ trá»‹ tá»“n' },
      { key: 'potentialRevenue', header: 'Doanh thu tiá»m nÄƒng' },
      { key: 'potentialProfit', header: 'LÃ£i tiá»m nÄƒng' },
    ]);
    const headers = csvResponseHeaders(
      `inventory-valuation-${new Date().toISOString().slice(0, 10)}.csv`,
    );
    Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
    res.send(csv);
  }

  /** Export CSV - inventory ledger */
  @Get('inventory-ledger/export')
  @RequirePermissions('manage_reports')
  async exportInventoryLedger(
    @Query() query: QueryInventoryLedgerDto,
    @Res() res: Response,
  ) {
    const data = await this.reportsService.getInventoryLedger({
      ...query,
      page: 1,
      limit: 10000,
    });
    const csv = toCsv(data.items, [
      { key: 'transactionId', header: 'ID' },
      { key: 'productName', header: 'Sáº£n pháº©m' },
      { key: 'transactionType', header: 'Loáº¡i' },
      { key: 'quantityChange', header: 'SL thay Ä‘á»•i' },
      { key: 'quantityBefore', header: 'SL trÆ°á»›c' },
      { key: 'quantityAfter', header: 'SL sau' },
      { key: 'unitCostAtTime', header: 'ÄÆ¡n giÃ¡' },
      { key: 'referenceType', header: 'Tham chiáº¿u' },
      { key: 'referenceId', header: 'MÃ£ TC' },
      { key: 'note', header: 'Ghi chÃº' },
      { key: 'createdAt', header: 'Thá»i gian' },
    ]);
    const headers = csvResponseHeaders(
      `inventory-ledger-${new Date().toISOString().slice(0, 10)}.csv`,
    );
    Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
    res.send(csv);
  }

  /** Export CSV - profitability */
  @Get('profitability/export')
  @RequirePermissions('manage_reports')
  async exportProfitability(
    @Query() query: QueryProfitabilityDto,
    @Res() res: Response,
  ) {
    const data = await this.reportsService.getProfitability({
      ...query,
      page: 1,
      limit: 10000,
    });
    const csv = toCsv((data as any).items ?? [], [
      { key: 'productName', header: 'Sản phẩm' },
      { key: 'period', header: 'Kỳ báo cáo' },
      { key: 'soldQty', header: 'SL bán' },
      { key: 'returnedQty', header: 'SL trả' },
      { key: 'netSoldQty', header: 'SL giữ lại' },
      { key: 'revenue', header: 'Doanh thu' },
      { key: 'refundAllocated', header: 'Refund đã trừ' },
      { key: 'cogs', header: 'Giá vốn' },
      { key: 'cogsSource', header: 'Nguồn giá vốn' },
      { key: 'cogsCoveragePct', header: 'Tỷ lệ đủ giá vốn (%)' },
      { key: 'missingCostQty', header: 'SL thiếu giá vốn' },
      { key: 'grossProfit', header: 'Lãi gộp' },
      { key: 'marginPct', header: 'Tỷ suất (%)' },
      { key: 'warnings', header: 'Cảnh báo' },
    ]);
    const headers = csvResponseHeaders(
      `profitability-${new Date().toISOString().slice(0, 10)}.csv`,
    );
    Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
    res.send(csv);
  }

  /** Export CSV - inventory reconciliation */
  @Get('inventory-reconciliation/export')
  @RequirePermissions('manage_reports')
  async exportInventoryReconciliation(
    @Query() query: QueryInventoryReconciliationDto,
    @Res() res: Response,
  ) {
    const data = await this.reportsService.getInventoryReconciliation({
      ...query,
      page: 1,
      limit: 10000,
    });
    const csv = toCsv(data.items, [
      { key: 'productId', header: 'Ma san pham' },
      { key: 'productName', header: 'Ten san pham' },
      { key: 'quantityAvailable', header: 'Ton kha dung' },
      { key: 'quantityReserved', header: 'Dang giu' },
      { key: 'batchRemainingQty', header: 'Ton theo batch' },
      { key: 'defaultWarehouseQty', header: 'Ton kho mac dinh' },
      { key: 'deltaBatch', header: 'Lech batch' },
      { key: 'deltaWarehouse', header: 'Lech kho mac dinh' },
      { key: 'severity', header: 'Muc do' },
      { key: 'warningsText', header: 'Canh bao' },
    ]);
    const headers = csvResponseHeaders(
      `inventory-reconciliation-${new Date().toISOString().slice(0, 10)}.csv`,
    );
    Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
    res.send(csv);
  }
}
