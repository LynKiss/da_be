import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Like, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { QuerySuppliersDto } from './dto/query-suppliers.dto';
import { SupplierEntity } from './entities/supplier.entity';

@Injectable()
export class SuppliersService {
  constructor(
    @InjectRepository(SupplierEntity)
    private readonly repo: Repository<SupplierEntity>,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async findAll(query: QuerySuppliersDto) {
    const { search, status = 'all', page = 1, limit = 20 } = query;
    const qb = this.repo.createQueryBuilder('s').orderBy('s.createdAt', 'DESC');

    if (search?.trim()) {
      const kw = `%${search.trim()}%`;
      qb.andWhere(
        '(s.name LIKE :kw OR s.code LIKE :kw OR s.phone LIKE :kw OR s.email LIKE :kw)',
        { kw },
      );
    }
    if (status === 'active') qb.andWhere('s.isActive = 1');
    if (status === 'inactive') qb.andWhere('s.isActive = 0');

    const total = await qb.getCount();
    const items = await qb
      .skip((page - 1) * limit)
      .take(limit)
      .getMany();

    return { items, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  async findOne(id: string) {
    const s = await this.repo.findOne({ where: { supplierId: id } });
    if (!s) throw new NotFoundException('Không tìm thấy nhà cung cấp');
    return s;
  }

  async create(dto: CreateSupplierDto, performer?: { userId: string; username: string; ip?: string }) {
    const nameDup = await this.repo.findOne({ where: { name: dto.name } });
    if (nameDup) throw new ConflictException('Tên nhà cung cấp đã tồn tại');
    if (dto.code) {
      const codeDup = await this.repo.findOne({ where: { code: dto.code } });
      if (codeDup) throw new ConflictException('Mã nhà cung cấp đã tồn tại');
    }
    const entity = this.repo.create({
      supplierId: uuidv4(),
      name: dto.name,
      code: dto.code ?? null,
      phone: dto.phone ?? null,
      email: dto.email ?? null,
      address: dto.address ?? null,
      taxCode: dto.taxCode ?? null,
      contactPerson: dto.contactPerson ?? null,
      paymentTerms: dto.paymentTerms ?? 30,
      notes: dto.notes ?? null,
      isActive: true,
    });
    const saved = await this.repo.save(entity);
    void this.auditLogs.log({
      entityType: 'SUPPLIER',
      entityId: saved.supplierId,
      action: 'CREATE',
      changedBy: performer?.username,
      ipAddress: performer?.ip,
      afterData: { name: saved.name, code: saved.code },
    });
    return saved;
  }

  async update(id: string, dto: Partial<CreateSupplierDto>, performer?: { userId: string; username: string; ip?: string }) {
    const s = await this.findOne(id);
    if (dto.name && dto.name !== s.name) {
      const nameDup = await this.repo.findOne({ where: { name: dto.name } });
      if (nameDup) throw new ConflictException('Tên nhà cung cấp đã tồn tại');
    }
    if (dto.code && dto.code !== s.code) {
      const codeDup = await this.repo.findOne({ where: { code: dto.code } });
      if (codeDup) throw new ConflictException('Mã nhà cung cấp đã tồn tại');
    }
    const before = { name: s.name, code: s.code, isActive: s.isActive };
    Object.assign(s, {
      name: dto.name ?? s.name,
      code: dto.code !== undefined ? (dto.code ?? null) : s.code,
      phone: dto.phone !== undefined ? (dto.phone ?? null) : s.phone,
      email: dto.email !== undefined ? (dto.email ?? null) : s.email,
      address: dto.address !== undefined ? (dto.address ?? null) : s.address,
      taxCode: dto.taxCode !== undefined ? (dto.taxCode ?? null) : s.taxCode,
      contactPerson: dto.contactPerson !== undefined ? (dto.contactPerson ?? null) : s.contactPerson,
      paymentTerms: dto.paymentTerms ?? s.paymentTerms,
      notes: dto.notes !== undefined ? (dto.notes ?? null) : s.notes,
    });
    const saved = await this.repo.save(s);
    void this.auditLogs.log({
      entityType: 'SUPPLIER',
      entityId: id,
      action: 'UPDATE',
      changedBy: performer?.username,
      ipAddress: performer?.ip,
      beforeData: before,
      afterData: { name: saved.name, code: saved.code },
    });
    return saved;
  }

  async toggleActive(id: string, performer?: { userId: string; username: string; ip?: string }) {
    const s = await this.findOne(id);
    const before = { isActive: s.isActive };
    s.isActive = !s.isActive;
    const saved = await this.repo.save(s);
    void this.auditLogs.log({
      entityType: 'SUPPLIER',
      entityId: id,
      action: 'UPDATE',
      changedBy: performer?.username,
      ipAddress: performer?.ip,
      beforeData: before,
      afterData: { isActive: saved.isActive },
    });
    return saved;
  }

  async findAllActive() {
    return this.repo.find({ where: { isActive: true }, order: { name: 'ASC' } });
  }
}
