import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CategoryEntity } from '../categories/entities/category.entity';
import { CreateSubcategoryDto } from './dto/create-subcategory.dto';
import { QuerySubcategoriesDto } from './dto/query-subcategories.dto';
import { UpdateSubcategoryDto } from './dto/update-subcategory.dto';
import { SubcategoryEntity } from './entities/subcategory.entity';

@Injectable()
export class SubcategoriesService {
  constructor(
    @InjectRepository(SubcategoryEntity)
    private readonly subcategoriesRepository: Repository<SubcategoryEntity>,
    @InjectRepository(CategoryEntity)
    private readonly categoriesRepository: Repository<CategoryEntity>,
  ) {}

  async findAll(query: QuerySubcategoriesDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const queryBuilder =
      this.subcategoriesRepository.createQueryBuilder('sub');

    if (query.search) {
      queryBuilder.andWhere('sub.subcategory_name LIKE :search', {
        search: `%${query.search}%`,
      });
    }

    if (query.categoryId) {
      queryBuilder.andWhere('sub.category_id = :categoryId', {
        categoryId: query.categoryId,
      });
    }

    if (query.isActive !== undefined) {
      queryBuilder.andWhere('sub.is_active = :isActive', {
        isActive: query.isActive,
      });
    }

    queryBuilder
      .orderBy('sub.subcategory_name', 'ASC')
      .skip((page - 1) * limit)
      .take(limit);

    const [items, total] = await queryBuilder.getManyAndCount();

    return {
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
      items,
    };
  }

  async findOne(subcategoryId: string) {
    const subcategory = await this.subcategoriesRepository.findOneBy({
      subcategoryId,
    });
    if (!subcategory) {
      throw new NotFoundException('Subcategory not found');
    }
    return subcategory;
  }

  async create(dto: CreateSubcategoryDto) {
    const category = await this.categoriesRepository.findOneBy({
      categoryId: dto.categoryId,
    });
    if (!category) {
      throw new NotFoundException('Category not found');
    }

    const slug = this.normalizeSlug(dto.subcategorySlug ?? dto.subcategoryName);
    await this.ensureSlugUnique(slug);

    const subcategory = this.subcategoriesRepository.create({
      categoryId: dto.categoryId,
      subcategoryName: dto.subcategoryName,
      subcategorySlug: slug,
      isActive: dto.isActive ?? true,
    });

    return this.subcategoriesRepository.save(subcategory);
  }

  async update(subcategoryId: string, dto: UpdateSubcategoryDto) {
    const subcategory = await this.findOne(subcategoryId);

    if (dto.categoryId) {
      const category = await this.categoriesRepository.findOneBy({
        categoryId: dto.categoryId,
      });
      if (!category) {
        throw new NotFoundException('Category not found');
      }
    }

    const nextSlug = dto.subcategorySlug
      ? this.normalizeSlug(dto.subcategorySlug)
      : dto.subcategoryName
        ? this.normalizeSlug(dto.subcategoryName)
        : null;

    if (nextSlug && nextSlug !== subcategory.subcategorySlug) {
      await this.ensureSlugUnique(nextSlug, subcategoryId);
    }

    subcategory.categoryId = dto.categoryId ?? subcategory.categoryId;
    subcategory.subcategoryName =
      dto.subcategoryName ?? subcategory.subcategoryName;
    subcategory.subcategorySlug =
      nextSlug ?? subcategory.subcategorySlug;
    subcategory.isActive = dto.isActive ?? subcategory.isActive;

    return this.subcategoriesRepository.save(subcategory);
  }

  async remove(subcategoryId: string) {
    const subcategory = await this.findOne(subcategoryId);
    await this.subcategoriesRepository.remove(subcategory);
    return { success: true };
  }

  private async ensureSlugUnique(slug: string, excludeId?: string) {
    const existing = await this.subcategoriesRepository.findOneBy({
      subcategorySlug: slug,
    });
    if (existing && existing.subcategoryId !== excludeId) {
      throw new ConflictException('Subcategory slug already exists');
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
