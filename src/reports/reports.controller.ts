import { Controller, Get, Query } from '@nestjs/common';
import { RequirePermissions, ResponseMessage } from '../decorator/customize';
import { QueryCouponUsageDto } from './dto/query-coupon-usage.dto';
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
}
