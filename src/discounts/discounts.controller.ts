import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  Public,
  RequirePermissions,
  ResponseMessage,
  SkipCheckPermission,
  User,
} from '../decorator/customize';
import type { IUser } from '../users/users.interface';
import { ApplyCouponDto } from './dto/apply-coupon.dto';
import { CreateDiscountDto } from './dto/create-discount.dto';
import { UpdateDiscountDto } from './dto/update-discount.dto';
import { ValidateCouponDto } from './dto/validate-coupon.dto';
import { DiscountsService } from './discounts.service';

@Controller('discounts')
export class DiscountsController {
  constructor(private readonly discountsService: DiscountsService) {}

  // ─── PUBLIC ──────────────────────────────────────────────────────────────────

  @Public()
  @Get()
  @ResponseMessage('Get available discounts')
  getAvailableDiscounts() {
    return this.discountsService.findAvailableOrderDiscounts();
  }

  @Public()
  @Get('by-product/:productId')
  @ResponseMessage('Get discounts by product')
  getDiscountsByProduct(@Param('productId') productId: string) {
    return this.discountsService.findDiscountsByProduct(productId);
  }

  @Public()
  @Get('by-category/:categoryId')
  @ResponseMessage('Get discounts by category')
  getDiscountsByCategory(@Param('categoryId') categoryId: string) {
    return this.discountsService.findDiscountsByCategory(categoryId);
  }

  // ─── AUTHENTICATED USER ───────────────────────────────────────────────────────

  @Post('validate')
  @SkipCheckPermission()
  @ResponseMessage('Validate coupon code')
  validateCoupon(@User() user: IUser, @Body() dto: ValidateCouponDto) {
    return this.discountsService.validateCoupon(user._id, dto);
  }

  @Post('apply')
  @SkipCheckPermission()
  @ResponseMessage('Apply coupon to order')
  applyCoupon(@User() user: IUser, @Body() dto: ApplyCouponDto) {
    return this.discountsService.applyCoupon(user._id, dto);
  }

  @Get('my-history')
  @SkipCheckPermission()
  @ResponseMessage('Get my coupon usage history')
  getUserCouponHistory(@User() user: IUser) {
    return this.discountsService.getUserCouponHistory(user._id);
  }

  // ─── ADMIN ────────────────────────────────────────────────────────────────────

  @Get('admin')
  @RequirePermissions('manage_discounts')
  @ResponseMessage('Get discounts for admin')
  getDiscountsForAdmin() {
    return this.discountsService.findAllForAdmin();
  }

  @Get('admin/:id')
  @RequirePermissions('manage_discounts')
  @ResponseMessage('Get discount detail')
  getDiscountDetail(@Param('id') id: string) {
    return this.discountsService.findOne(id);
  }

  @Get('admin/:id/stats')
  @RequirePermissions('manage_discounts')
  @ResponseMessage('Get discount statistics')
  getDiscountStats(@Param('id') id: string) {
    return this.discountsService.getDiscountStats(id);
  }

  @Post()
  @RequirePermissions('manage_discounts')
  @ResponseMessage('Create discount')
  createDiscount(@Body() dto: CreateDiscountDto) {
    return this.discountsService.create(dto);
  }

  /** Approve discount đang chờ duyệt (giảm > 30%). */
  @Patch('admin/:id/approve')
  @RequirePermissions('manage_discounts')
  @ResponseMessage('Approve high-discount')
  approveDiscount(
    @Param('id') id: string,
    @User() user: IUser,
    @Body('note') note?: string,
  ) {
    return this.discountsService.approveDiscount(id, user._id, note);
  }

  /** Reject discount đang chờ duyệt. */
  @Patch('admin/:id/reject')
  @RequirePermissions('manage_discounts')
  @ResponseMessage('Reject high-discount')
  rejectDiscount(
    @Param('id') id: string,
    @User() user: IUser,
    @Body('note') note?: string,
  ) {
    return this.discountsService.rejectDiscount(id, user._id, note);
  }

  @Patch(':id')
  @RequirePermissions('manage_discounts')
  @ResponseMessage('Update discount')
  updateDiscount(@Param('id') id: string, @Body() dto: UpdateDiscountDto) {
    return this.discountsService.update(id, dto);
  }

  @Patch(':id/toggle-active')
  @RequirePermissions('manage_discounts')
  @ResponseMessage('Toggle discount active status')
  toggleActive(@Param('id') id: string) {
    return this.discountsService.toggleActive(id);
  }

  @Delete(':id')
  @RequirePermissions('manage_discounts')
  @ResponseMessage('Delete discount')
  removeDiscount(@Param('id') id: string) {
    return this.discountsService.remove(id);
  }
}
