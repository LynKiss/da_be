import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { CreateCategoryDto } from './dto/create-category.dto';
import { ReorderCategoryDto } from './dto/reorder-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { CategoryEntity } from './entities/category.entity';
import { ProductEntity } from '../products/entities/product.entity';

export type CategoryTreeNode = {
  categoryId: string;
  categoryName: string;
  categoryDescription: string | null;
  categorySlug: string;
  parentId: string | null;
  isActive: boolean;
  sortOrder: number;
  directProductCount: number;
  productCount: number;
  createdAt: Date;
  updatedAt: Date;
  children: CategoryTreeNode[];
};

@Injectable()
export class CategoriesService {
  constructor(
    @InjectRepository(CategoryEntity)
    private readonly categoriesRepository: Repository<CategoryEntity>,
    @InjectRepository(ProductEntity)
    private readonly productsRepository: Repository<ProductEntity>,
  ) {}

  async findAll() {
    return this.categoriesRepository.find({
      where: { isActive: true },
      order: { parentId: 'ASC', sortOrder: 'ASC', categoryName: 'ASC' },
    });
  }

  async findTree() {
    const categories = await this.categoriesRepository.find({
      where: { isActive: true },
      order: { sortOrder: 'ASC', categoryName: 'ASC' },
    });

    return this.buildTree(categories);
  }

  async findAllForAdmin() {
    return this.categoriesRepository.find({
      order: { parentId: 'ASC', sortOrder: 'ASC', categoryName: 'ASC' },
    });
  }

  async findTreeForAdmin() {
    const categories = await this.categoriesRepository.find({
      order: { sortOrder: 'ASC', categoryName: 'ASC' },
    });

    return this.buildTree(categories);
  }

  async findOne(categoryId: string) {
    const category = await this.categoriesRepository.findOne({
      where: { categoryId },
      relations: {
        parent: true,
        children: true,
      },
      order: {
        children: {
          sortOrder: 'ASC',
          categoryName: 'ASC',
        },
      },
    });

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

    const normalizedParentId = await this.normalizeParentId(
      createCategoryDto.parentId,
    );
    const categoryParentId = normalizedParentId ?? null;

    const category = this.categoriesRepository.create({
      categoryName: createCategoryDto.categoryName,
      categoryDescription: createCategoryDto.categoryDescription ?? null,
      categorySlug,
      parentId: categoryParentId,
      isActive: createCategoryDto.isActive ?? true,
      sortOrder: await this.getNextSortOrder(categoryParentId),
    });

    return this.categoriesRepository.save(category);
  }

  async update(categoryId: string, updateCategoryDto: UpdateCategoryDto) {
    const category = await this.findOne(categoryId);

    if (updateCategoryDto.categorySlug !== undefined || updateCategoryDto.categoryName) {
      const slugSource =
        updateCategoryDto.categorySlug?.trim()
          ? updateCategoryDto.categorySlug
          : updateCategoryDto.categoryName
            ? updateCategoryDto.categoryName
            : category.categoryName;
      const nextSlug = this.normalizeSlug(slugSource);

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

    if (updateCategoryDto.parentId !== undefined) {
      const previousParentId = category.parentId;
      const normalizedParentId = await this.normalizeParentId(
        updateCategoryDto.parentId,
        category.categoryId,
      );

      if (normalizedParentId !== undefined) {
        category.parentId = normalizedParentId;
        if (normalizedParentId !== previousParentId) {
          category.sortOrder = await this.getNextSortOrder(normalizedParentId);
        }
      }
    }

    category.categoryName =
      updateCategoryDto.categoryName ?? category.categoryName;
    category.categoryDescription =
      updateCategoryDto.categoryDescription !== undefined
        ? (updateCategoryDto.categoryDescription || null)
        : category.categoryDescription;
    category.isActive = updateCategoryDto.isActive ?? category.isActive;

    return this.categoriesRepository.save(category);
  }

  async reorder(categoryId: string, reorderCategoryDto: ReorderCategoryDto) {
    const category = await this.findOne(categoryId);
    const nextParentId =
      reorderCategoryDto.parentId === undefined
        ? category.parentId
        : await this.normalizeParentId(
            reorderCategoryDto.parentId,
            category.categoryId,
          );

    const siblings = await this.categoriesRepository.find({
      where: { parentId: nextParentId ?? IsNull() },
      order: { sortOrder: 'ASC', categoryName: 'ASC' },
    });

    const siblingIds = siblings
      .filter((sibling) => sibling.categoryId !== categoryId)
      .map((sibling) => sibling.categoryId);

    const targetIndex = Math.min(
      Math.max(reorderCategoryDto.targetIndex, 0),
      siblingIds.length,
    );

    siblingIds.splice(targetIndex, 0, categoryId);

    for (let index = 0; index < siblingIds.length; index += 1) {
      await this.categoriesRepository.update(siblingIds[index], {
        parentId: nextParentId ?? null,
        sortOrder: index,
      });
    }

    return this.findTreeForAdmin();
  }

  async remove(categoryId: string) {
    const category = await this.findOne(categoryId);
    const childCount = await this.categoriesRepository.count({
      where: { parentId: categoryId },
    });

    if (childCount > 0) {
      throw new BadRequestException(
        'Cannot delete category while child categories still exist',
      );
    }

    const productCount = await this.productsRepository.count({
      where: { categoryId },
    });

    if (productCount > 0) {
      throw new BadRequestException(
        `Cannot delete category: ${productCount} product(s) are still assigned to it`,
      );
    }

    await this.categoriesRepository.remove(category);

    return { success: true };
  }

  private async normalizeParentId(
    parentId?: string | null,
    currentCategoryId?: string,
  ) {
    if (parentId === undefined) {
      return currentCategoryId ? undefined : null;
    }

    if (parentId === null || parentId === '') {
      return null;
    }

    if (currentCategoryId && parentId === currentCategoryId) {
      throw new BadRequestException('Category cannot be its own parent');
    }

    const parentCategory = await this.categoriesRepository.findOneBy({
      categoryId: parentId,
    });

    if (!parentCategory) {
      throw new NotFoundException('Parent category not found');
    }

    if (currentCategoryId) {
      await this.ensureNoCircularParent(parentId, currentCategoryId);
    }

    return parentId;
  }

  private async ensureNoCircularParent(
    parentId: string,
    currentCategoryId: string,
  ) {
    let cursor: string | null = parentId;

    while (cursor) {
      if (cursor === currentCategoryId) {
        throw new BadRequestException(
          'Circular category hierarchy is not allowed',
        );
      }

      const currentParent = await this.categoriesRepository.findOne({
        where: { categoryId: cursor },
        select: {
          categoryId: true,
          parentId: true,
        },
      });

      cursor = currentParent?.parentId ?? null;
    }
  }

  private sortTree(nodes: CategoryTreeNode[]) {
    return nodes
      .sort((a, b) => {
        if (a.sortOrder !== b.sortOrder) {
          return a.sortOrder - b.sortOrder;
        }

        return a.categoryName.localeCompare(b.categoryName);
      })
      .map((node) => {
        const sortedChildren = this.sortTree(node.children);
        const descendantCount = sortedChildren.reduce(
          (total, child) => total + child.productCount,
          0,
        );

        return {
          ...node,
          children: sortedChildren,
          productCount: node.directProductCount + descendantCount,
        };
      });
  }

  private buildTreeFromCounts(
    categories: CategoryEntity[],
    nodeMap: Map<string, CategoryTreeNode>,
    directProductCounts: Map<string, number>,
  ) {
    const roots: CategoryTreeNode[] = [];

    for (const category of categories) {
      nodeMap.set(category.categoryId, {
        categoryId: category.categoryId,
        categoryName: category.categoryName,
        categoryDescription: category.categoryDescription,
        categorySlug: category.categorySlug,
        parentId: category.parentId,
        isActive: category.isActive,
        sortOrder: category.sortOrder,
        directProductCount: directProductCounts.get(category.categoryId) ?? 0,
        productCount: directProductCounts.get(category.categoryId) ?? 0,
        createdAt: category.createdAt,
        updatedAt: category.updatedAt,
        children: [],
      });
    }

    for (const category of categories) {
      const currentNode = nodeMap.get(category.categoryId);
      if (!currentNode) {
        continue;
      }

      if (category.parentId) {
        const parentNode = nodeMap.get(category.parentId);
        if (parentNode) {
          parentNode.children.push(currentNode);
          continue;
        }
      }

      roots.push(currentNode);
    }

    return this.sortTree(roots);
  }

  private async buildTree(categories: CategoryEntity[]) {
    const directProductCounts = await this.getProductCountsByCategory();
    const nodeMap = new Map<string, CategoryTreeNode>();
    return this.buildTreeFromCounts(categories, nodeMap, directProductCounts);
  }

  private async getProductCountsByCategory() {
    const rows = await this.productsRepository
      .createQueryBuilder('product')
      .select('product.categoryId', 'categoryId')
      .addSelect('COUNT(product.productId)', 'productCount')
      .groupBy('product.categoryId')
      .getRawMany<{ categoryId: string; productCount: string }>();

    return new Map(
      rows.map((row) => [row.categoryId, Number(row.productCount)]),
    );
  }

  private async getNextSortOrder(parentId: string | null) {
    const siblingCount = await this.categoriesRepository.count({
      where: { parentId: parentId ?? IsNull() },
    });

    return siblingCount;
  }

  private normalizeSlug(value: string) {
    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
}
