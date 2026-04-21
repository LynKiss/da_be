import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateNewsDto } from './dto/create-news.dto';
import { NewsStatusFilter, QueryNewsDto } from './dto/query-news.dto';
import { UpdateNewsDto } from './dto/update-news.dto';
import { NewsEntity } from './entities/news.entity';

@Injectable()
export class NewsService {
  constructor(
    @InjectRepository(NewsEntity)
    private readonly newsRepository: Repository<NewsEntity>,
  ) {}

  async create(userId: string, createNewsDto: CreateNewsDto) {
    const slug = this.normalizeSlug(createNewsDto.slug ?? createNewsDto.title);

    const existing = await this.newsRepository.findOneBy({ slug });
    if (existing) {
      throw new BadRequestException('Slug đã tồn tại');
    }

    const article = this.newsRepository.create({
      userId,
      title: createNewsDto.title.trim(),
      subTitle: createNewsDto.subTitle?.trim() || null,
      slug,
      titleImageUrl: createNewsDto.titleImageUrl?.trim() || null,
      content: createNewsDto.content ?? null,
      isDraft: true,
      isPublished: false,
      publishedAt: null,
    });

    return this.newsRepository.save(article);
  }

  async findAll(query: QueryNewsDto) {
    const { search, status = NewsStatusFilter.ALL, page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    const qb = this.newsRepository.createQueryBuilder('news');

    if (search?.trim()) {
      qb.where(
        '(news.title LIKE :search OR news.sub_title LIKE :search OR news.slug LIKE :search)',
        { search: `%${search.trim()}%` },
      );
    }

    if (status === NewsStatusFilter.PUBLISHED) {
      qb.andWhere('news.is_published = 1');
    } else if (status === NewsStatusFilter.DRAFT) {
      qb.andWhere('news.is_draft = 1 AND news.is_published = 0');
    }

    qb.orderBy('news.created_at', 'DESC').skip(skip).take(limit);

    const [items, total] = await qb.getManyAndCount();

    return {
      items,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(newsId: string) {
    const article = await this.newsRepository.findOneBy({ newsId });
    if (!article) {
      throw new NotFoundException('Bài viết không tìm thấy');
    }
    return article;
  }

  async update(newsId: string, updateNewsDto: UpdateNewsDto) {
    const article = await this.findOne(newsId);

    if (updateNewsDto.slug !== undefined || updateNewsDto.title) {
      const slugSource = updateNewsDto.slug?.trim()
        ? updateNewsDto.slug
        : updateNewsDto.title
          ? updateNewsDto.title
          : article.title;
      const nextSlug = this.normalizeSlug(slugSource);

      const existing = await this.newsRepository.findOneBy({ slug: nextSlug });
      if (existing && existing.newsId !== newsId) {
        throw new BadRequestException('Slug đã tồn tại');
      }
      article.slug = nextSlug;
    }

    article.title = updateNewsDto.title ?? article.title;
    article.subTitle =
      updateNewsDto.subTitle !== undefined
        ? updateNewsDto.subTitle?.trim() || null
        : article.subTitle;
    article.titleImageUrl =
      updateNewsDto.titleImageUrl !== undefined
        ? updateNewsDto.titleImageUrl?.trim() || null
        : article.titleImageUrl;
    article.content =
      updateNewsDto.content !== undefined ? updateNewsDto.content : article.content;

    return this.newsRepository.save(article);
  }

  async publish(newsId: string) {
    const article = await this.findOne(newsId);
    if (article.isPublished) {
      throw new BadRequestException('Bài viết đã được xuất bản');
    }
    article.isDraft = false;
    article.isPublished = true;
    article.publishedAt = new Date();
    return this.newsRepository.save(article);
  }

  async unpublish(newsId: string) {
    const article = await this.findOne(newsId);
    if (!article.isPublished) {
      throw new BadRequestException('Bài viết chưa được xuất bản');
    }
    article.isDraft = true;
    article.isPublished = false;
    return this.newsRepository.save(article);
  }

  async remove(newsId: string) {
    const article = await this.findOne(newsId);
    await this.newsRepository.remove(article);
    return { success: true };
  }

  private normalizeSlug(value: string) {
    return value
      .trim()
      .toLowerCase()
      .replace(/[àáạảãâầấậẩẫăằắặẳẵ]/g, 'a')
      .replace(/[èéẹẻẽêềếệểễ]/g, 'e')
      .replace(/[ìíịỉĩ]/g, 'i')
      .replace(/[òóọỏõôồốộổỗơờớợởỡ]/g, 'o')
      .replace(/[ùúụủũưừứựửữ]/g, 'u')
      .replace(/[ỳýỵỷỹ]/g, 'y')
      .replace(/đ/g, 'd')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
}
