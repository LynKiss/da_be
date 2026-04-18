import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ResponseMessage, User } from '../decorator/customize';
import type { IUser } from '../users/users.interface';
import { CreateOrderDto } from './dto/create-order.dto';
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

  @Get(':id')
  @ResponseMessage('Get order detail')
  getOrderDetail(@User() currentUser: IUser, @Param('id') id: string) {
    return this.ordersService.findOrderDetail(currentUser._id, id);
  }

  @Patch(':id/cancel')
  @ResponseMessage('Cancel order')
  cancelOrder(@User() currentUser: IUser, @Param('id') id: string) {
    return this.ordersService.cancelOrder(currentUser._id, id);
  }
}
