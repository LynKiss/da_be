import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Public, RequirePermissions, ResponseMessage } from '../decorator/customize';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { QuerySuppliersDto } from './dto/query-suppliers.dto';
import { SuppliersService } from './suppliers.service';

@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly service: SuppliersService) {}

  @Get()
  @RequirePermissions('manage_products')
  @ResponseMessage('Get suppliers list')
  findAll(@Query() query: QuerySuppliersDto) {
    return this.service.findAll(query);
  }

  @Get('active')
  @RequirePermissions('manage_products')
  @ResponseMessage('Get active suppliers')
  findAllActive() {
    return this.service.findAllActive();
  }

  @Get(':id')
  @RequirePermissions('manage_products')
  @ResponseMessage('Get supplier detail')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions('manage_products')
  @ResponseMessage('Create supplier')
  create(@Body() dto: CreateSupplierDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @RequirePermissions('manage_products')
  @ResponseMessage('Update supplier')
  update(@Param('id') id: string, @Body() dto: Partial<CreateSupplierDto>) {
    return this.service.update(id, dto);
  }

  @Patch(':id/toggle-active')
  @RequirePermissions('manage_products')
  @ResponseMessage('Toggle supplier active')
  toggleActive(@Param('id') id: string) {
    return this.service.toggleActive(id);
  }
}
