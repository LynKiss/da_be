import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { CategoryEntity } from './entities/category.entity';

@Injectable()
export class CategoriesService {
  constructor(
    @InjectRepository(CategoryEntity)
    private readonly categoriesRepository: Repository<CategoryEntity>,
  ) {}

  async findAll() {
    return this.categoriesRepository.find({
      where: { isActive: true },
      order: { createdAt: 'DESC' },
    });
  }

  async findAllForAdmin() {
    return this.categoriesRepository.find({
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(categoryId: string) {
    const category = await this.categoriesRepository.findOneBy({ categoryId });
    if (!category) {
      throw new NotFoundException('Category not found');
    }

    return category;
  }

  async create(createCategoryDto: CreateCategoryDto) {
    const categorySlug = this.normalizeSlug(
      createCategoryDto.categorySlug ?? createCategoryDto.categoryName,
    );

    const existedCategory = await this.categoriesRepository.findOneBy({
      categorySlug,
    });
    if (existedCategory) {
      throw new ConflictException('Category slug already exists');
    }

    const category = this.categoriesRepository.create({
      categoryName: createCategoryDto.categoryName,
      categoryDescription: createCategoryDto.categoryDescription ?? null,
      categorySlug,
      isActive: createCategoryDto.isActive ?? true,
    });

    return this.categoriesRepository.save(category);
  }

  async update(categoryId: string, updateCategoryDto: UpdateCategoryDto) {
    const category = await this.findOne(categoryId);

    if (updateCategoryDto.categorySlug || updateCategoryDto.categoryName) {
      const nextSlug = this.normalizeSlug(
        updateCategoryDto.categorySlug ?? updateCategoryDto.categoryName ?? '',
      );

      const existedCategory = await this.categoriesRepository.findOneBy({
        categorySlug: nextSlug,
      });
      if (
        existedCategory &&
        existedCategory.categoryId !== category.categoryId
      ) {
        throw new ConflictException('Category slug already exists');
      }

      category.categorySlug = nextSlug;
    }

    category.categoryName =
      updateCategoryDto.categoryName ?? category.categoryName;
    category.categoryDescription =
      updateCategoryDto.categoryDescription ?? category.categoryDescription;
    category.isActive = updateCategoryDto.isActive ?? category.isActive;

    return this.categoriesRepository.save(category);
  }

  async remove(categoryId: string) {
    const category = await this.findOne(categoryId);
    await this.categoriesRepository.remove(category);

    return { success: true };
  }

  private normalizeSlug(value: string) {
    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
}
