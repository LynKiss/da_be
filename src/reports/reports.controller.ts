import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { RequirePermissions, ResponseMessage, User } from '../decorator/customize';
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
}
