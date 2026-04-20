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
import { Public, RequirePermissions, ResponseMessage } from '../decorator/customize';
import { CreateOriginDto } from './dto/create-origin.dto';
import { QueryOriginsDto } from './dto/query-origins.dto';
import { UpdateOriginDto } from './dto/update-origin.dto';
import { OriginsService } from './origins.service';

@Controller('origins')
export class OriginsController {
  constructor(private readonly originsService: OriginsService) {}

  @Public()
  @Get()
  @ResponseMessage('Get origins list')
  getOrigins(@Query() query: QueryOriginsDto) {
    return this.originsService.findAll(query);
  }

  @Public()
  @Get(':id')
  @ResponseMessage('Get origin detail')
  getOrigin(@Param('id') id: string) {
    return this.originsService.findOne(id);
  }

  @Post()
  @RequirePermissions('manage_products')
  @ResponseMessage('Create origin')
  createOrigin(@Body() dto: CreateOriginDto) {
    return this.originsService.create(dto);
  }

  @Patch(':id')
  @RequirePermissions('manage_products')
  @ResponseMessage('Update origin')
  updateOrigin(@Param('id') id: string, @Body() dto: UpdateOriginDto) {
    return this.originsService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('manage_products')
  @ResponseMessage('Delete origin')
  removeOrigin(@Param('id') id: string) {
    return this.originsService.remove(id);
  }
}
