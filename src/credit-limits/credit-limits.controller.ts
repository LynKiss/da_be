import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { RequirePermissions, ResponseMessage, User } from '../decorator/customize';
import type { IUser } from '../users/users.interface';
import { CreditLimitsService } from './credit-limits.service';
import { RecordPaymentDto, UpsertCreditLimitDto } from './dto/upsert-credit-limit.dto';

@Controller('credit-limits')
export class CreditLimitsController {
  constructor(private readonly svc: CreditLimitsService) {}

  @Get()
  @RequirePermissions('manage_users')
  @ResponseMessage('Get credit limits list')
  findAll(@Query('page') page = 1, @Query('limit') limit = 20) {
    return this.svc.findAll(+page, +limit);
  }

  @Get('my-limit')
  @ResponseMessage('Get my credit limit')
  getMyLimit(@User() currentUser: IUser) {
    return this.svc.getMyLimit(currentUser._id);
  }

  @Get('user/:userId')
  @RequirePermissions('manage_users')
  @ResponseMessage('Get credit limit by user')
  findByUser(@Param('userId') userId: string) {
    return this.svc.findByUser(userId);
  }

  @Post()
  @RequirePermissions('manage_users')
  @ResponseMessage('Upsert credit limit')
  upsert(@Body() dto: UpsertCreditLimitDto) {
    return this.svc.upsert(dto);
  }

  @Post('sync-debt/:userId')
  @RequirePermissions('manage_users')
  @ResponseMessage('Sync current debt from orders')
  syncDebt(@Param('userId') userId: string) {
    return this.svc.syncDebt(userId);
  }

  @Post('record-payment')
  @RequirePermissions('manage_payments')
  @ResponseMessage('Record payment to reduce debt')
  recordPayment(@Body() dto: RecordPaymentDto) {
    return this.svc.recordPayment(dto);
  }

  @Delete('user/:userId')
  @RequirePermissions('manage_users')
  @ResponseMessage('Remove credit limit')
  remove(@Param('userId') userId: string) {
    return this.svc.remove(userId);
  }

  @Get('customers')
  @RequirePermissions('manage_users')
  @ResponseMessage('Get customer list for credit limit assignment')
  getCustomers(@Query('search') search?: string) {
    return this.svc.getCustomers(search);
  }
}
