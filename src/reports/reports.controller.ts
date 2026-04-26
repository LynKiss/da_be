import { Body, Controller, Get, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { RequirePermissions, ResponseMessage, User } from '../decorator/customize';
import { csvResponseHeaders, toCsv } from '../common/csv-export.util';
import { QueryCouponUsageDto } from './dto/query-coupon-usage.dto';
import { QueryAgingDebtDto, QueryInventoryLedgerDto, QueryProfitabilityDto, RecordPoPaymentDto } from './dto/query-inventory-ledger.dto';
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
  @ResponseMessage('Get inventory ledger')
  getInventoryLedger(@Query() query: QueryInventoryLedgerDto) {
    return this.reportsService.getInventoryLedger(query);
  }

  @Get('inventory-valuation')
  @ResponseMessage('Get inventory valuation')
  getInventoryValuation() {
    return this.reportsService.getInventoryValuation();
  }

  @Get('profitability')
  @ResponseMessage('Get profitability report')
  getProfitability(@Query() query: QueryProfitabilityDto) {
    return this.reportsService.getProfitability(query);
  }

  @Get('aging-debt')
  @ResponseMessage('Get aging debt report')
  getAgingDebt(@Query() query: QueryAgingDebtDto) {
    return this.reportsService.getAgingDebt(query);
  }

  @Post('record-po-payment')
  @ResponseMessage('Record PO payment')
  recordPoPayment(@Body() dto: RecordPoPaymentDto, @User() user: { userId?: string }) {
    return this.reportsService.recordPoPayment(dto, user?.userId);
  }

  /** Export CSV - inventory valuation */
  @Get('inventory-valuation/export')
  async exportInventoryValuation(@Res() res: Response) {
    const data = await this.reportsService.getInventoryValuation();
    const csv = toCsv(data.items, [
      { key: 'productId', header: 'Mã SP' },
      { key: 'productName', header: 'Tên sản phẩm' },
      { key: 'qtyAvailable', header: 'Tồn khả dụng' },
      { key: 'qtyReserved', header: 'Đang giữ' },
      { key: 'totalQty', header: 'Tổng SL' },
      { key: 'avgCost', header: 'Giá vốn TB' },
      { key: 'retailPrice', header: 'Giá bán' },
      { key: 'totalValue', header: 'Giá trị tồn' },
      { key: 'potentialRevenue', header: 'Doanh thu tiềm năng' },
      { key: 'potentialProfit', header: 'Lãi tiềm năng' },
    ]);
    const headers = csvResponseHeaders(
      `inventory-valuation-${new Date().toISOString().slice(0, 10)}.csv`,
    );
    Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
    res.send(csv);
  }

  /** Export CSV - inventory ledger */
  @Get('inventory-ledger/export')
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
      { key: 'productName', header: 'Sản phẩm' },
      { key: 'transactionType', header: 'Loại' },
      { key: 'quantityChange', header: 'SL thay đổi' },
      { key: 'quantityBefore', header: 'SL trước' },
      { key: 'quantityAfter', header: 'SL sau' },
      { key: 'unitCostAtTime', header: 'Đơn giá' },
      { key: 'referenceType', header: 'Tham chiếu' },
      { key: 'referenceId', header: 'Mã TC' },
      { key: 'note', header: 'Ghi chú' },
      { key: 'createdAt', header: 'Thời gian' },
    ]);
    const headers = csvResponseHeaders(
      `inventory-ledger-${new Date().toISOString().slice(0, 10)}.csv`,
    );
    Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
    res.send(csv);
  }

  /** Export CSV - profitability */
  @Get('profitability/export')
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
      { key: 'soldQty', header: 'SL bán' },
      { key: 'revenue', header: 'Doanh thu' },
      { key: 'cogs', header: 'Giá vốn' },
      { key: 'grossProfit', header: 'Lãi gộp' },
      { key: 'marginPct', header: 'Tỷ suất (%)' },
    ]);
    const headers = csvResponseHeaders(
      `profitability-${new Date().toISOString().slice(0, 10)}.csv`,
    );
    Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
    res.send(csv);
  }
}
