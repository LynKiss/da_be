import { Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ResponseMessage, User } from '../decorator/customize';
import type { IUser } from '../users/users.interface';
import { ProductsService } from './products.service';

@Controller('wishlist')
export class WishlistController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  @ResponseMessage('Get wishlist')
  getWishlist(@User() currentUser: IUser) {
    return this.productsService.findWishlist(currentUser._id);
  }

  @Post(':productId')
  @ResponseMessage('Add product to wishlist')
  addWishlistItem(
    @User() currentUser: IUser,
    @Param('productId') productId: string,
  ) {
    return this.productsService.addWishlistItem(currentUser._id, productId);
  }

  @Delete(':productId')
  @ResponseMessage('Remove product from wishlist')
  removeWishlistItem(
    @User() currentUser: IUser,
    @Param('productId') productId: string,
  ) {
    return this.productsService.removeWishlistItem(currentUser._id, productId);
  }
}
