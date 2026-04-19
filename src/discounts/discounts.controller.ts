import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  Public,
  RequirePermissions,
  ResponseMessage,
} from '../decorator/customize';
import { CreateDiscountDto } from './dto/create-discount.dto';
import { UpdateDiscountDto } from './dto/update-discount.dto';
import { DiscountsService } from './discounts.service';

@Controller('discounts')
export class DiscountsController {
  constructor(private readonly discountsService: DiscountsService) {}

  @Public()
  @Get()
  @ResponseMessage('Get available discounts')
  getAvailableDiscounts() {
    return this.discountsService.findAvailableOrderDiscounts();
  }

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

  @Post()
  @RequirePermissions('manage_discounts')
  @ResponseMessage('Create discount')
  createDiscount(@Body() createDiscountDto: CreateDiscountDto) {
    return this.discountsService.create(createDiscountDto);
  }

  @Patch(':id')
  @RequirePermissions('manage_discounts')
  @ResponseMessage('Update discount')
  updateDiscount(
    @Param('id') id: string,
    @Body() updateDiscountDto: UpdateDiscountDto,
  ) {
    return this.discountsService.update(id, updateDiscountDto);
  }

  @Delete(':id')
  @RequirePermissions('manage_discounts')
  @ResponseMessage('Delete discount')
  removeDiscount(@Param('id') id: string) {
    return this.discountsService.remove(id);
  }
}
