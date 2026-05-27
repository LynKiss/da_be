import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  RequirePermissions,
  ResponseMessage,
  User,
} from '../decorator/customize';
import type { IUser } from '../users/users.interface';
import { CreateReturnDto } from './dto/create-return.dto';
import { InspectReturnDto } from './dto/inspect-return.dto';
import { UpdateReturnStatusDto } from './dto/update-return-status.dto';
import { OrdersService } from './orders.service';

@Controller('returns')
export class ReturnsController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @ResponseMessage('Create return request')
  createReturn(
    @User() currentUser: IUser,
    @Body() createReturnDto: CreateReturnDto,
  ) {
    return this.ordersService.createReturn(currentUser._id, createReturnDto);
  }

  @Get('me')
  @ResponseMessage('Get my returns')
  getMyReturns(
    @User() currentUser: IUser,
    @Query('page') page = '1',
    @Query('limit') limit = '10',
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.ordersService.findMyReturns(currentUser._id, {
      page: Math.max(1, parseInt(page, 10) || 1),
      limit: Math.min(100, Math.max(1, parseInt(limit, 10) || 10)),
      search,
      status,
      from,
      to,
    });
  }

  @Get('admin')
  @RequirePermissions('manage_orders')
  @ResponseMessage('Get returns list')
  getAllReturns() {
    return this.ordersService.findAllReturns();
  }

  @Patch(':id/status')
  @RequirePermissions('manage_orders')
  @ResponseMessage('Update return status')
  updateReturnStatus(
    @User() currentUser: IUser,
    @Param('id') id: string,
    @Body() updateReturnStatusDto: UpdateReturnStatusDto,
  ) {
    return this.ordersService.updateReturnStatus(
      currentUser,
      id,
      updateReturnStatusDto,
    );
  }

  @Patch(':id/inspect')
  @RequirePermissions('manage_orders')
  @ResponseMessage('Inspect returned goods')
  inspectReturn(
    @User() currentUser: IUser,
    @Param('id') id: string,
    @Body() dto: InspectReturnDto,
  ) {
    return this.ordersService.inspectReturn(
      currentUser,
      id,
      dto.decision,
      dto.note,
    );
  }
}
