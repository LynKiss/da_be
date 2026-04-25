import { Body, Controller, Get, Param, Patch, Post, Query, Request } from '@nestjs/common';
import { Public, RequirePermissions, ResponseMessage } from '../decorator/customize';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { QuerySuppliersDto } from './dto/query-suppliers.dto';
import { SuppliersService } from './suppliers.service';

function getPerformer(req: any, ip?: string) {
  const user = req.user;
  if (!user?._id) return undefined;
  return { userId: user._id as string, username: user.username as string, ip };
}

function getIp(req: any): string | undefined {
  return (req.headers?.['x-forwarded-for'] as string)?.split(',')[0]?.trim()
    ?? req.ip
    ?? undefined;
}

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
  create(@Body() dto: CreateSupplierDto, @Request() req: any) {
    return this.service.create(dto, getPerformer(req, getIp(req)));
  }

  @Patch(':id')
  @RequirePermissions('manage_products')
  @ResponseMessage('Update supplier')
  update(@Param('id') id: string, @Body() dto: Partial<CreateSupplierDto>, @Request() req: any) {
    return this.service.update(id, dto, getPerformer(req, getIp(req)));
  }

  @Patch(':id/toggle-active')
  @RequirePermissions('manage_products')
  @ResponseMessage('Toggle supplier active')
  toggleActive(@Param('id') id: string, @Request() req: any) {
    return this.service.toggleActive(id, getPerformer(req, getIp(req)));
  }
}
