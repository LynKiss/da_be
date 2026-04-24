import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLogEntity } from './entities/audit-log.entity';

export interface CreateAuditLogParams {
  changedBy?: string;
  entityType: string;
  entityId: string;
  action: string;
  beforeData?: Record<string, unknown>;
  afterData?: Record<string, unknown>;
  ipAddress?: string;
  notes?: string;
}

@Injectable()
export class AuditLogsService {
  constructor(
    @InjectRepository(AuditLogEntity)
    private readonly repo: Repository<AuditLogEntity>,
  ) {}

  async log(params: CreateAuditLogParams) {
    const entry = this.repo.create({
      changedBy: params.changedBy ?? null,
      entityType: params.entityType,
      entityId: params.entityId,
      action: params.action,
      beforeData: params.beforeData ? JSON.stringify(params.beforeData) : null,
      afterData: params.afterData ? JSON.stringify(params.afterData) : null,
      ipAddress: params.ipAddress ?? null,
      notes: params.notes ?? null,
    });
    await this.repo.save(entry);
    return entry;
  }

  async findAll(query: {
    entityType?: string;
    entityId?: string;
    action?: string;
    changedBy?: string;
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
  }) {
    const { page = 1, limit = 30 } = query;
    const qb = this.repo.createQueryBuilder('log').orderBy('log.changedAt', 'DESC');

    if (query.entityType) qb.andWhere('log.entityType = :et', { et: query.entityType });
    if (query.entityId) qb.andWhere('log.entityId = :ei', { ei: query.entityId });
    if (query.action) qb.andWhere('log.action = :action', { action: query.action });
    if (query.changedBy) qb.andWhere('log.changedBy = :cb', { cb: query.changedBy });
    if (query.from) qb.andWhere('log.changedAt >= :from', { from: query.from });
    if (query.to) qb.andWhere('log.changedAt <= :to', { to: query.to });

    const total = await qb.getCount();
    const items = await qb.skip((page - 1) * limit).take(limit).getMany();

    return {
      items: items.map((item) => ({
        ...item,
        beforeData: item.beforeData ? (JSON.parse(item.beforeData) as Record<string, unknown>) : null,
        afterData: item.afterData ? (JSON.parse(item.afterData) as Record<string, unknown>) : null,
      })),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }
}
