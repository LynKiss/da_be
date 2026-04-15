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
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { CategoriesService } from './categories.service';

@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Public()
  @Get()
  @ResponseMessage('Get active categories')
  getCategories() {
    return this.categoriesService.findAll();
  }

  @Get('admin')
  @RequirePermissions('manage_products')
  @ResponseMessage('Get categories for admin')
  getCategoriesForAdmin() {
    return this.categoriesService.findAllForAdmin();
  }

  @Public()
  @Get(':id')
  @ResponseMessage('Get category detail')
  getCategory(@Param('id') id: string) {
    return this.categoriesService.findOne(id);
  }

  @Post()
  @RequirePermissions('manage_products')
  @ResponseMessage('Create category')
  createCategory(@Body() createCategoryDto: CreateCategoryDto) {
    return this.categoriesService.create(createCategoryDto);
  }

  @Patch(':id')
  @RequirePermissions('manage_products')
  @ResponseMessage('Update category')
  updateCategory(
    @Param('id') id: string,
    @Body() updateCategoryDto: UpdateCategoryDto,
  ) {
    return this.categoriesService.update(id, updateCategoryDto);
  }

  @Delete(':id')
  @RequirePermissions('manage_products')
  @ResponseMessage('Delete category')
  removeCategory(@Param('id') id: string) {
    return this.categoriesService.remove(id);
  }
}
