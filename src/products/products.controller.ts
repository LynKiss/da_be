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

  @Delete(':id')
  @RequirePermissions('manage_products')
  @ResponseMessage('Delete product')
  removeProduct(@Param('id') id: string) {
    return this.productsService.remove(id);
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
}
