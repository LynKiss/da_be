import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  RequirePermissions,
  ResponseMessage,
  User,
} from '../decorator/customize';
import type { IUser } from '../users/users.interface';
import { CreateOrderDto } from './dto/create-order.dto';
import { QueryOrdersDto } from './dto/query-orders.dto';
import { UpdateOrderTrackingLiveDto } from './dto/update-order-tracking-live.dto';
import { UpdateOrderTrackingManualDto } from './dto/update-order-tracking-manual.dto';
import { UpdateOrderTrackingModeDto } from './dto/update-order-tracking-mode.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { OrdersService } from './orders.service';

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @ResponseMessage('Create order')
  createOrder(
    @User() currentUser: IUser,
    @Body() createOrderDto: CreateOrderDto,
  ) {
    return this.ordersService.createOrder(currentUser._id, createOrderDto);
  }

  @Get()
  @RequirePermissions('manage_orders')
  @ResponseMessage('Get orders list')
  getOrders(@Query() query: QueryOrdersDto) {
    return this.ordersService.findAllOrders(query);
  }

  @Get(':id')
  @ResponseMessage('Get order detail')
  getOrderDetail(@User() currentUser: IUser, @Param('id') id: string) {
    return this.ordersService.findOrderDetail(currentUser, id);
  }

  @Get(':id/tracking')
  @ResponseMessage('Get order tracking detail')
  getOrderTracking(@User() currentUser: IUser, @Param('id') id: string) {
    return this.ordersService.findOrderTracking(currentUser, id);
  }

  @Patch(':id/cancel')
  @ResponseMessage('Cancel order')
  cancelOrder(@User() currentUser: IUser, @Param('id') id: string) {
    return this.ordersService.cancelOrder(currentUser._id, id);
  }

  @Patch(':id/status')
  @RequirePermissions('manage_orders')
  @ResponseMessage('Update order status')
  updateOrderStatus(
    @User() currentUser: IUser,
    @Param('id') id: string,
    @Body() updateOrderStatusDto: UpdateOrderStatusDto,
  ) {
    return this.ordersService.updateOrderStatus(
      currentUser,
      id,
      updateOrderStatusDto,
    );
  }

  @Patch(':id/tracking/mode')
  @RequirePermissions('manage_orders')
  @ResponseMessage('Update order tracking mode')
  updateOrderTrackingMode(
    @User() currentUser: IUser,
    @Param('id') id: string,
    @Body() updateOrderTrackingModeDto: UpdateOrderTrackingModeDto,
  ) {
    return this.ordersService.updateOrderTrackingMode(
      currentUser,
      id,
      updateOrderTrackingModeDto,
    );
  }

  @Patch(':id/tracking/manual')
  @RequirePermissions('manage_orders')
  @ResponseMessage('Update manual order tracking point')
  updateManualOrderTracking(
    @User() currentUser: IUser,
    @Param('id') id: string,
    @Body() updateOrderTrackingManualDto: UpdateOrderTrackingManualDto,
  ) {
    return this.ordersService.updateManualOrderTracking(
      currentUser,
      id,
      updateOrderTrackingManualDto,
    );
  }

  @Patch(':id/tracking/live')
  @RequirePermissions('manage_orders')
  @ResponseMessage('Update live order tracking point')
  updateLiveOrderTracking(
    @User() currentUser: IUser,
    @Param('id') id: string,
    @Body() updateOrderTrackingLiveDto: UpdateOrderTrackingLiveDto,
  ) {
    return this.ordersService.updateLiveOrderTracking(
      currentUser,
      id,
      updateOrderTrackingLiveDto,
    );
  }
}
