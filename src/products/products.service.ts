import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CategoryEntity } from '../categories/entities/category.entity';
import { CreateProductDto } from './dto/create-product.dto';
import { QueryProductsDto } from './dto/query-products.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductEntity } from './entities/product.entity';

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(ProductEntity)
    private readonly productsRepository: Repository<ProductEntity>,
    @InjectRepository(CategoryEntity)
    private readonly categoriesRepository: Repository<CategoryEntity>,
  ) {}

  async findAll(query: QueryProductsDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;

    const queryBuilder = this.productsRepository.createQueryBuilder('product');

    if (query.search) {
      queryBuilder.andWhere(
        '(product.product_name LIKE :search OR product.product_slug LIKE :search)',
        { search: `%${query.search}%` },
      );
    }

    if (query.categoryId) {
      queryBuilder.andWhere('product.category_id = :categoryId', {
        categoryId: query.categoryId,
      });
    }

    if (!query.includeHidden) {
      queryBuilder.andWhere('product.is_show = :isShow', { isShow: true });
    }

    queryBuilder
      .orderBy('product.created_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [items, total] = await queryBuilder.getManyAndCount();

    return {
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      items,
    };
  }

  async findOne(productId: string) {
    const product = await this.productsRepository.findOneBy({ productId });
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    return product;
  }

  async create(createProductDto: CreateProductDto) {
    await this.ensureCategoryExists(createProductDto.categoryId);
    await this.ensureUniqueFields(createProductDto);

    const product = this.productsRepository.create({
      productId: createProductDto.productId ?? randomUUID(),
      productName: createProductDto.productName,
      productSlug: this.normalizeSlug(
        createProductDto.productSlug ?? createProductDto.productName,
      ),
      categoryId: createProductDto.categoryId,
      subcategoryId: createProductDto.subcategoryId ?? null,
      originId: createProductDto.originId ?? null,
      productPrice: createProductDto.productPrice,
      productPriceSale: createProductDto.productPriceSale ?? null,
      quantityAvailable: createProductDto.quantityAvailable ?? 0,
      description: createProductDto.description ?? null,
      ratingAverage: '0',
      ratingCount: 0,
      isShow: createProductDto.isShow ?? true,
      expiredAt: createProductDto.expiredAt
        ? new Date(createProductDto.expiredAt)
        : null,
      unit: createProductDto.unit ?? null,
      quantityPerBox: createProductDto.quantityPerBox ?? null,
      barcode: createProductDto.barcode ?? null,
      boxBarcode: createProductDto.boxBarcode ?? null,
    });

    return this.productsRepository.save(product);
  }

  async update(productId: string, updateProductDto: UpdateProductDto) {
    const product = await this.findOne(productId);

    if (updateProductDto.categoryId) {
      await this.ensureCategoryExists(updateProductDto.categoryId);
    }

    await this.ensureUniqueFields(updateProductDto, product.productId);

    product.productName = updateProductDto.productName ?? product.productName;
    product.productSlug = updateProductDto.productSlug
      ? this.normalizeSlug(updateProductDto.productSlug)
      : updateProductDto.productName
        ? this.normalizeSlug(updateProductDto.productName)
        : product.productSlug;
    product.categoryId = updateProductDto.categoryId ?? product.categoryId;
    product.subcategoryId =
      updateProductDto.subcategoryId ?? product.subcategoryId;
    product.originId = updateProductDto.originId ?? product.originId;
    product.productPrice =
      updateProductDto.productPrice ?? product.productPrice;
    product.productPriceSale =
      updateProductDto.productPriceSale ?? product.productPriceSale;
    product.quantityAvailable =
      updateProductDto.quantityAvailable ?? product.quantityAvailable;
    product.description = updateProductDto.description ?? product.description;
    product.isShow = updateProductDto.isShow ?? product.isShow;
    product.expiredAt = updateProductDto.expiredAt
      ? new Date(updateProductDto.expiredAt)
      : product.expiredAt;
    product.unit = updateProductDto.unit ?? product.unit;
    product.quantityPerBox =
      updateProductDto.quantityPerBox ?? product.quantityPerBox;
    product.barcode = updateProductDto.barcode ?? product.barcode;
    product.boxBarcode = updateProductDto.boxBarcode ?? product.boxBarcode;

    return this.productsRepository.save(product);
  }

  async remove(productId: string) {
    const product = await this.findOne(productId);
    await this.productsRepository.remove(product);

    return { success: true };
  }

  private async ensureCategoryExists(categoryId: string) {
    const category = await this.categoriesRepository.findOneBy({ categoryId });
    if (!category) {
      throw new NotFoundException('Category not found');
    }
  }

  private async ensureUniqueFields(
    payload: Partial<CreateProductDto>,
    excludeProductId?: string,
  ) {
    const slug = payload.productSlug
      ? this.normalizeSlug(payload.productSlug)
      : payload.productName
        ? this.normalizeSlug(payload.productName)
        : null;

    if (slug) {
      const existedProduct = await this.productsRepository.findOneBy({
        productSlug: slug,
      });
      if (existedProduct && existedProduct.productId !== excludeProductId) {
        throw new ConflictException('Product slug already exists');
      }
    }

    if (payload.barcode) {
      const existedBarcode = await this.productsRepository.findOneBy({
        barcode: payload.barcode,
      });
      if (existedBarcode && existedBarcode.productId !== excludeProductId) {
        throw new ConflictException('Barcode already exists');
      }
    }

    if (payload.boxBarcode) {
      const existedBoxBarcode = await this.productsRepository.findOneBy({
        boxBarcode: payload.boxBarcode,
      });
      if (
        existedBoxBarcode &&
        existedBoxBarcode.productId !== excludeProductId
      ) {
        throw new ConflictException('Box barcode already exists');
      }
    }
  }

  private normalizeSlug(value: string) {
    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
}
