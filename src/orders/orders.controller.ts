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
}
