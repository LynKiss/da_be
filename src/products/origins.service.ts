import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Like, Repository } from 'typeorm';
import { CreateOriginDto } from './dto/create-origin.dto';
import { QueryOriginsDto } from './dto/query-origins.dto';
import { UpdateOriginDto } from './dto/update-origin.dto';
import { OriginEntity } from './entities/origin.entity';

@Injectable()
export class OriginsService {
  constructor(
    @InjectRepository(OriginEntity)
    private readonly originsRepository: Repository<OriginEntity>,
  ) {}

  async findAll(query: QueryOriginsDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where = query.search
      ? { originName: Like(`%${query.search}%`) }
      : {};

    const [items, total] = await this.originsRepository.findAndCount({
      where,
      order: { originName: 'ASC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
      items,
    };
  }

  async findOne(originId: string) {
    const origin = await this.originsRepository.findOneBy({ originId });
    if (!origin) {
      throw new NotFoundException('Origin not found');
    }
    return origin;
  }

  async create(dto: CreateOriginDto) {
    await this.ensureNameUnique(dto.originName);

    const origin = this.originsRepository.create({
      originName: dto.originName,
      originImage: dto.originImage ?? null,
    });

    return this.originsRepository.save(origin);
  }

  async update(originId: string, dto: UpdateOriginDto) {
    const origin = await this.findOne(originId);

    if (dto.originName && dto.originName !== origin.originName) {
      await this.ensureNameUnique(dto.originName, originId);
    }

    origin.originName = dto.originName ?? origin.originName;
    origin.originImage =
      dto.originImage !== undefined ? (dto.originImage ?? null) : origin.originImage;

    return this.originsRepository.save(origin);
  }

  async remove(originId: string) {
    const origin = await this.findOne(originId);
    await this.originsRepository.remove(origin);
    return { success: true };
  }

  private async ensureNameUnique(name: string, excludeId?: string) {
    const existing = await this.originsRepository.findOneBy({
      originName: name,
    });
    if (existing && existing.originId !== excludeId) {
      throw new ConflictException('Origin name already exists');
    }
  }
}
