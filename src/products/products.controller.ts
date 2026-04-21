import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  Public,
  RequirePermissions,
  ResponseMessage,
} from '../decorator/customize';
import { CreateProductDto } from './dto/create-product.dto';
import { QueryProductsDto } from './dto/query-products.dto';
import { ReorderImagesDto } from './dto/reorder-images.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductsService } from './products.service';

type UploadedImageFile = {
  buffer: Buffer;
  mimetype: string;
  size: number;
  originalname: string;
};

@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Public()
  @Get()
  @ResponseMessage('Get products list')
  getProducts(@Query() query: QueryProductsDto) {
    return this.productsService.findAll(query);
  }

  @Public()
  @Get(':id')
  @ResponseMessage('Get product detail')
  getProduct(@Param('id') id: string) {
    return this.productsService.findOne(id);
  }

  @Post()
  @RequirePermissions('manage_products')
  @ResponseMessage('Create product')
  createProduct(@Body() createProductDto: CreateProductDto) {
    return this.productsService.create(createProductDto);
  }

  @Patch(':id')
  @RequirePermissions('manage_products')
  @ResponseMessage('Update product')
  updateProduct(
    @Param('id') id: string,
    @Body() updateProductDto: UpdateProductDto,
  ) {
    return this.productsService.update(id, updateProductDto);
  }

  @Patch(':id/toggle-visibility')
  @RequirePermissions('manage_products')
  @ResponseMessage('Toggle product visibility')
  toggleProductVisibility(@Param('id') id: string) {
    return this.productsService.toggleVisibility(id);
  }

  @Patch(':id/toggle-featured')
  @RequirePermissions('manage_products')
  @ResponseMessage('Toggle product featured')
  toggleProductFeatured(@Param('id') id: string) {
    return this.productsService.toggleFeatured(id);
  }

  @Delete(':id')
  @RequirePermissions('manage_products')
  @ResponseMessage('Delete product')
  removeProduct(@Param('id') id: string) {
    return this.productsService.remove(id);
  }

  // ─── Images ─────────────────────────────────────────────────────────────────

  @Public()
  @Get(':id/images')
  @ResponseMessage('Get product images')
  getProductImages(@Param('id') id: string) {
    return this.productsService.getProductImages(id);
  }

  @Post(':id/images')
  @RequirePermissions('manage_products')
  @UseInterceptors(FileInterceptor('file'))
  @ResponseMessage('Upload product image')
  uploadProductImage(
    @Param('id') id: string,
    @UploadedFile() file: UploadedImageFile,
    @Body('isPrimary') isPrimary?: string,
  ) {
    return this.productsService.uploadProductImage(
      id,
      file,
      isPrimary === 'true',
    );
  }

  @Patch(':id/images/:imageId/set-primary')
  @RequirePermissions('manage_products')
  @ResponseMessage('Set primary image')
  setPrimaryImage(@Param('id') id: string, @Param('imageId') imageId: string) {
    return this.productsService.setPrimaryImage(id, imageId);
  }

  @Patch(':id/images/reorder')
  @RequirePermissions('manage_products')
  @ResponseMessage('Reorder product images')
  reorderProductImages(
    @Param('id') id: string,
    @Body() dto: ReorderImagesDto,
  ) {
    return this.productsService.reorderProductImages(id, dto);
  }

  @Delete(':id/images/:imageId')
  @RequirePermissions('manage_products')
  @ResponseMessage('Delete product image')
  deleteProductImage(
    @Param('id') id: string,
    @Param('imageId') imageId: string,
  ) {
    return this.productsService.deleteProductImage(id, imageId);
  }

  // ─── Description Images ──────────────────────────────────────────────────────

  @Public()
  @Get(':id/description-images')
  @ResponseMessage('Get product description images')
  getDescriptionImages(@Param('id') id: string) {
    return this.productsService.getDescriptionImages(id);
  }

  @Post(':id/description-images')
  @RequirePermissions('manage_products')
  @UseInterceptors(FileInterceptor('file'))
  @ResponseMessage('Upload product description image')
  uploadDescriptionImage(
    @Param('id') id: string,
    @UploadedFile() file: UploadedImageFile,
  ) {
    return this.productsService.uploadDescriptionImage(id, file);
  }

  @Delete(':id/description-images/:imageId')
  @RequirePermissions('manage_products')
  @ResponseMessage('Delete product description image')
  deleteDescriptionImage(
    @Param('id') id: string,
    @Param('imageId') imageId: string,
  ) {
    return this.productsService.deleteDescriptionImage(id, imageId);
  }
}
