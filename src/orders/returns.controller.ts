import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import {
  RequirePermissions,
  ResponseMessage,
  User,
} from '../decorator/customize';
import type { IUser } from '../users/users.interface';
import { CreateReturnDto } from './dto/create-return.dto';
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
  getMyReturns(@User() currentUser: IUser) {
    return this.ordersService.findMyReturns(currentUser._id);
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
}
