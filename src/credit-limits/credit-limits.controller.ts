import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ResponseMessage } from '../decorator/customize';
import { CreditLimitsService } from './credit-limits.service';
import { RecordPaymentDto, UpsertCreditLimitDto } from './dto/upsert-credit-limit.dto';

@Controller('credit-limits')
export class CreditLimitsController {
  constructor(private readonly svc: CreditLimitsService) {}

  @Get()
  @ResponseMessage('Get credit limits list')
  findAll(@Query('page') page = 1, @Query('limit') limit = 20) {
    return this.svc.findAll(+page, +limit);
  }

  @Get('user/:userId')
  @ResponseMessage('Get credit limit by user')
  findByUser(@Param('userId') userId: string) {
    return this.svc.findByUser(userId);
  }

  @Post()
  @ResponseMessage('Upsert credit limit')
  upsert(@Body() dto: UpsertCreditLimitDto) {
    return this.svc.upsert(dto);
  }

  @Post('sync-debt/:userId')
  @ResponseMessage('Sync current debt from orders')
  syncDebt(@Param('userId') userId: string) {
    return this.svc.syncDebt(userId);
  }

  @Post('record-payment')
  @ResponseMessage('Record payment to reduce debt')
  recordPayment(@Body() dto: RecordPaymentDto) {
    return this.svc.recordPayment(dto);
  }

  @Delete('user/:userId')
  @ResponseMessage('Remove credit limit')
  remove(@Param('userId') userId: string) {
    return this.svc.remove(userId);
  }
}
