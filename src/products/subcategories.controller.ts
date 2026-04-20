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
} from '../decorator/customize';
import { CreateSubcategoryDto } from './dto/create-subcategory.dto';
import { QuerySubcategoriesDto } from './dto/query-subcategories.dto';
import { UpdateSubcategoryDto } from './dto/update-subcategory.dto';
import { SubcategoriesService } from './subcategories.service';

@Controller('subcategories')
export class SubcategoriesController {
  constructor(private readonly subcategoriesService: SubcategoriesService) {}

  @Public()
  @Get()
  @ResponseMessage('Get subcategories list')
  getSubcategories(@Query() query: QuerySubcategoriesDto) {
    return this.subcategoriesService.findAll(query);
  }

  @Public()
  @Get(':id')
  @ResponseMessage('Get subcategory detail')
  getSubcategory(@Param('id') id: string) {
    return this.subcategoriesService.findOne(id);
  }

  @Post()
  @RequirePermissions('manage_products')
  @ResponseMessage('Create subcategory')
  createSubcategory(@Body() dto: CreateSubcategoryDto) {
    return this.subcategoriesService.create(dto);
  }

  @Patch(':id')
  @RequirePermissions('manage_products')
  @ResponseMessage('Update subcategory')
  updateSubcategory(
    @Param('id') id: string,
    @Body() dto: UpdateSubcategoryDto,
  ) {
    return this.subcategoriesService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('manage_products')
  @ResponseMessage('Delete subcategory')
  removeSubcategory(@Param('id') id: string) {
    return this.subcategoriesService.remove(id);
  }
}
