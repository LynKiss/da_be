import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Like, Repository } from 'typeorm';
import { CreateTagDto } from './dto/create-tag.dto';
import { ManageProductTagsDto } from './dto/manage-product-tags.dto';
import { UpdateTagDto } from './dto/update-tag.dto';
import { ProductTagEntity } from './entities/product-tag.entity';
import { ProductEntity } from './entities/product.entity';
import { TagEntity } from './entities/tag.entity';

@Injectable()
export class TagsService {
  constructor(
    @InjectRepository(TagEntity)
    private readonly tagsRepository: Repository<TagEntity>,
    @InjectRepository(ProductTagEntity)
    private readonly productTagsRepository: Repository<ProductTagEntity>,
    @InjectRepository(ProductEntity)
    private readonly productsRepository: Repository<ProductEntity>,
  ) {}

  async findAll(search?: string) {
    const where = search ? { tagName: Like(`%${search}%`) } : {};
    return this.tagsRepository.find({
      where,
      order: { tagName: 'ASC' },
    });
  }

  async findOne(tagId: string) {
    const tag = await this.tagsRepository.findOneBy({ tagId });
    if (!tag) {
      throw new NotFoundException('Tag not found');
    }
    return tag;
  }

  async create(dto: CreateTagDto) {
    await this.ensureNameUnique(dto.tagName);
    const tag = this.tagsRepository.create({ tagName: dto.tagName });
    return this.tagsRepository.save(tag);
  }

  async update(tagId: string, dto: UpdateTagDto) {
    const tag = await this.findOne(tagId);
    if (dto.tagName && dto.tagName !== tag.tagName) {
      await this.ensureNameUnique(dto.tagName, tagId);
    }
    tag.tagName = dto.tagName ?? tag.tagName;
    return this.tagsRepository.save(tag);
  }

  async remove(tagId: string) {
    const tag = await this.findOne(tagId);
    await this.productTagsRepository.delete({ tagId });
    await this.tagsRepository.remove(tag);
    return { success: true };
  }

  async getProductTags(productId: string) {
    await this.ensureProductExists(productId);
    const productTags = await this.productTagsRepository.findBy({ productId });
    if (productTags.length === 0) return [];
    const tagIds = productTags.map((pt) => pt.tagId);
    return this.tagsRepository.findBy(tagIds.map((tagId) => ({ tagId })));
  }

  async setProductTags(productId: string, dto: ManageProductTagsDto) {
    await this.ensureProductExists(productId);

    if (dto.tagIds.length > 0) {
      const tags = await this.tagsRepository.findBy(
        dto.tagIds.map((tagId) => ({ tagId })),
      );
      if (tags.length !== dto.tagIds.length) {
        throw new NotFoundException('One or more tags not found');
      }
    }

    await this.productTagsRepository.delete({ productId });

    if (dto.tagIds.length > 0) {
      const entities = dto.tagIds.map((tagId) =>
        this.productTagsRepository.create({ productId, tagId }),
      );
      await this.productTagsRepository.save(entities);
    }

    return this.getProductTags(productId);
  }

  async addProductTags(productId: string, dto: ManageProductTagsDto) {
    await this.ensureProductExists(productId);

    const tags = await this.tagsRepository.findBy(
      dto.tagIds.map((tagId) => ({ tagId })),
    );
    if (tags.length !== dto.tagIds.length) {
      throw new NotFoundException('One or more tags not found');
    }

    const existing = await this.productTagsRepository.findBy({ productId });
    const existingTagIds = new Set(existing.map((pt) => pt.tagId));

    const newEntities = dto.tagIds
      .filter((tagId) => !existingTagIds.has(tagId))
      .map((tagId) => this.productTagsRepository.create({ productId, tagId }));

    if (newEntities.length > 0) {
      await this.productTagsRepository.save(newEntities);
    }

    return this.getProductTags(productId);
  }

  async removeProductTag(productId: string, tagId: string) {
    await this.ensureProductExists(productId);
    await this.findOne(tagId);
    await this.productTagsRepository.delete({ productId, tagId });
    return { success: true };
  }

  private async ensureProductExists(productId: string) {
    const product = await this.productsRepository.findOneBy({ productId });
    if (!product) {
      throw new NotFoundException('Product not found');
    }
  }

  private async ensureNameUnique(name: string, excludeId?: string) {
    const existing = await this.tagsRepository.findOneBy({ tagName: name });
    if (existing && existing.tagId !== excludeId) {
      throw new ConflictException('Tag name already exists');
    }
  }
}
