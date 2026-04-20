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
import { CreateTagDto } from './dto/create-tag.dto';
import { ManageProductTagsDto } from './dto/manage-product-tags.dto';
import { UpdateTagDto } from './dto/update-tag.dto';
import { TagsService } from './tags.service';

@Controller('tags')
export class TagsController {
  constructor(private readonly tagsService: TagsService) {}

  @Public()
  @Get()
  @ResponseMessage('Get tags list')
  getTags(@Query('search') search?: string) {
    return this.tagsService.findAll(search);
  }

  @Public()
  @Get(':id')
  @ResponseMessage('Get tag detail')
  getTag(@Param('id') id: string) {
    return this.tagsService.findOne(id);
  }

  @Post()
  @RequirePermissions('manage_products')
  @ResponseMessage('Create tag')
  createTag(@Body() dto: CreateTagDto) {
    return this.tagsService.create(dto);
  }

  @Patch(':id')
  @RequirePermissions('manage_products')
  @ResponseMessage('Update tag')
  updateTag(@Param('id') id: string, @Body() dto: UpdateTagDto) {
    return this.tagsService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('manage_products')
  @ResponseMessage('Delete tag')
  removeTag(@Param('id') id: string) {
    return this.tagsService.remove(id);
  }

  @Public()
  @Get('products/:productId')
  @ResponseMessage('Get product tags')
  getProductTags(@Param('productId') productId: string) {
    return this.tagsService.getProductTags(productId);
  }

  @Post('products/:productId')
  @RequirePermissions('manage_products')
  @ResponseMessage('Add product tags')
  addProductTags(
    @Param('productId') productId: string,
    @Body() dto: ManageProductTagsDto,
  ) {
    return this.tagsService.addProductTags(productId, dto);
  }

  @Patch('products/:productId')
  @RequirePermissions('manage_products')
  @ResponseMessage('Set product tags')
  setProductTags(
    @Param('productId') productId: string,
    @Body() dto: ManageProductTagsDto,
  ) {
    return this.tagsService.setProductTags(productId, dto);
  }

  @Delete('products/:productId/:tagId')
  @RequirePermissions('manage_products')
  @ResponseMessage('Remove product tag')
  removeProductTag(
    @Param('productId') productId: string,
    @Param('tagId') tagId: string,
  ) {
    return this.tagsService.removeProductTag(productId, tagId);
  }
}
