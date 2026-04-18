import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ResponseMessage, User } from '../decorator/customize';
import type { IUser } from '../users/users.interface';
import { AddCartItemDto } from './dto/add-cart-item.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';
import { CartsService } from './carts.service';

@Controller('cart')
export class CartsController {
  constructor(private readonly cartsService: CartsService) {}

  @Get()
  @ResponseMessage('Get my cart')
  getMyCart(@User() currentUser: IUser) {
    return this.cartsService.getMyCart(currentUser._id);
  }

  @Post('items')
  @ResponseMessage('Add item to cart')
  addCartItem(
    @User() currentUser: IUser,
    @Body() addCartItemDto: AddCartItemDto,
  ) {
    return this.cartsService.addItem(currentUser._id, addCartItemDto);
  }

  @Patch('items/:id')
  @ResponseMessage('Update cart item')
  updateCartItem(
    @User() currentUser: IUser,
    @Param('id') id: string,
    @Body() updateCartItemDto: UpdateCartItemDto,
  ) {
    return this.cartsService.updateItem(currentUser._id, id, updateCartItemDto);
  }

  @Delete('items/:id')
  @ResponseMessage('Delete cart item')
  deleteCartItem(@User() currentUser: IUser, @Param('id') id: string) {
    return this.cartsService.deleteItem(currentUser._id, id);
  }
}
