import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { PurchaseOrderEntity, PurchaseOrderStatus } from '../procurement/entities/purchase-order.entity';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { QuerySuppliersDto } from './dto/query-suppliers.dto';
import { SupplierEntity } from './entities/supplier.entity';

@Injectable()
export class SuppliersService {
  constructor(
    @InjectRepository(SupplierEntity)
    private readonly repo: Repository<SupplierEntity>,
    @InjectRepository(PurchaseOrderEntity)
    private readonly poRepo: Repository<PurchaseOrderEntity>,
    private readonly auditLogs: AuditLogsService,
  ) {}

  private enrichCredit(supplier: SupplierEntity) {
    const creditLimit = Number(supplier.creditLimit ?? 0);
    const currentDebt = Number(supplier.currentDebt ?? 0);
    const hasLimit = creditLimit > 0;
    const availableCredit = hasLimit ? Math.max(0, creditLimit - currentDebt) : null;
    const debtUsagePct = hasLimit ? Math.round((currentDebt / creditLimit) * 1000) / 10 : 0;
    const creditStatus =
      hasLimit && currentDebt >= creditLimit
        ? 'over_limit'
        : hasLimit && debtUsagePct >= 80
          ? 'near_limit'
          : 'normal';

    return {
      ...supplier,
      creditLimit,
      currentDebt,
      availableCredit,
      debtUsagePct,
      creditStatus,
    };
  }

  async findAll(query: QuerySuppliersDto) {
    const { search, status = 'all', debtStatus = 'all', page = 1, limit = 20 } = query;
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
    if (debtStatus === 'outstanding') {
      qb.andWhere('CAST(s.currentDebt AS DECIMAL(15,2)) > 0');
    }
    if (debtStatus === 'near_limit') {
      qb.andWhere('CAST(s.creditLimit AS DECIMAL(15,2)) > 0')
        .andWhere('CAST(s.currentDebt AS DECIMAL(15,2)) >= CAST(s.creditLimit AS DECIMAL(15,2)) * 0.8')
        .andWhere('CAST(s.currentDebt AS DECIMAL(15,2)) < CAST(s.creditLimit AS DECIMAL(15,2))');
    }
    if (debtStatus === 'over_limit') {
      qb.andWhere('CAST(s.creditLimit AS DECIMAL(15,2)) > 0')
        .andWhere('CAST(s.currentDebt AS DECIMAL(15,2)) >= CAST(s.creditLimit AS DECIMAL(15,2))');
    }

    const total = await qb.getCount();
    const items = await qb
      .skip((page - 1) * limit)
      .take(limit)
      .getMany();

    return {
      items: items.map((item) => this.enrichCredit(item)),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: string) {
    const s = await this.repo.findOne({ where: { supplierId: id } });
    if (!s) throw new NotFoundException('Không tìm thấy nhà cung cấp');
    return this.enrichCredit(s);
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
      creditLimit: String(dto.creditLimit ?? 0),
      currentDebt: '0',
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
      afterData: { name: saved.name, code: saved.code, creditLimit: saved.creditLimit },
    });
    return this.enrichCredit(saved);
  }

  async update(id: string, dto: Partial<CreateSupplierDto>, performer?: { userId: string; username: string; ip?: string }) {
    const s = await this.repo.findOne({ where: { supplierId: id } });
    if (!s) throw new NotFoundException('Không tìm thấy nhà cung cấp');
    if (dto.name && dto.name !== s.name) {
      const nameDup = await this.repo.findOne({ where: { name: dto.name } });
      if (nameDup) throw new ConflictException('Tên nhà cung cấp đã tồn tại');
    }
    if (dto.code && dto.code !== s.code) {
      const codeDup = await this.repo.findOne({ where: { code: dto.code } });
      if (codeDup) throw new ConflictException('Mã nhà cung cấp đã tồn tại');
    }
    const before = { name: s.name, code: s.code, isActive: s.isActive, creditLimit: s.creditLimit };
    Object.assign(s, {
      name: dto.name ?? s.name,
      code: dto.code !== undefined ? (dto.code ?? null) : s.code,
      phone: dto.phone !== undefined ? (dto.phone ?? null) : s.phone,
      email: dto.email !== undefined ? (dto.email ?? null) : s.email,
      address: dto.address !== undefined ? (dto.address ?? null) : s.address,
      taxCode: dto.taxCode !== undefined ? (dto.taxCode ?? null) : s.taxCode,
      contactPerson: dto.contactPerson !== undefined ? (dto.contactPerson ?? null) : s.contactPerson,
      paymentTerms: dto.paymentTerms ?? s.paymentTerms,
      creditLimit: dto.creditLimit !== undefined ? String(dto.creditLimit ?? 0) : s.creditLimit,
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
      afterData: { name: saved.name, code: saved.code, creditLimit: saved.creditLimit },
    });
    return this.enrichCredit(saved);
  }

  async toggleActive(id: string, performer?: { userId: string; username: string; ip?: string }) {
    const s = await this.repo.findOne({ where: { supplierId: id } });
    if (!s) throw new NotFoundException('Không tìm thấy nhà cung cấp');
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
    return this.enrichCredit(saved);
  }

  async findAllActive() {
    const suppliers = await this.repo.find({ where: { isActive: true }, order: { name: 'ASC' } });
    return suppliers.map((supplier) => this.enrichCredit(supplier));
  }

  async syncCurrentDebt(id: string) {
    const supplier = await this.repo.findOne({ where: { supplierId: id } });
    if (!supplier) return null;
    const row = await this.poRepo
      .createQueryBuilder('po')
      .select('SUM(GREATEST(CAST(po.totalAmount AS DECIMAL(15,2)) - CAST(po.paidAmount AS DECIMAL(15,2)), 0))', 'debt')
      .where('po.supplierId = :id', { id })
      .andWhere('po.status IN (:...statuses)', {
        statuses: [
          PurchaseOrderStatus.ORDERED,
          PurchaseOrderStatus.PARTIAL,
          PurchaseOrderStatus.RECEIVED,
        ],
      })
      .getRawOne<{ debt: string | null }>();
    supplier.currentDebt = String(Number(row?.debt ?? 0));
    const saved = await this.repo.save(supplier);
    return this.enrichCredit(saved);
  }

  async findCreditDetail(id: string) {
    const supplier = await this.syncCurrentDebt(id);
    if (!supplier) throw new NotFoundException('Không tìm thấy nhà cung cấp');
    const purchaseOrders = await this.poRepo.find({
      where: {
        supplierId: id,
        status: In([
          PurchaseOrderStatus.ORDERED,
          PurchaseOrderStatus.PARTIAL,
          PurchaseOrderStatus.RECEIVED,
        ]),
      },
      order: { orderDate: 'DESC', createdAt: 'DESC' },
    });

    const items = purchaseOrders.map((po) => {
      const totalAmount = Number(po.totalAmount ?? 0);
      const paidAmount = Number(po.paidAmount ?? 0);
      const outstanding = Math.max(0, totalAmount - paidAmount);
      return {
        poId: po.poId,
        poCode: po.poCode,
        status: po.status,
        paymentStatus: po.paymentStatus,
        orderDate: po.orderDate,
        expectedDate: po.expectedDate,
        totalAmount,
        paidAmount,
        outstanding,
        paidDate: po.paidDate,
        paymentNotes: po.paymentNotes,
      };
    });

    return {
      supplier,
      summary: {
        totalOrders: items.length,
        outstandingOrders: items.filter((item) => item.outstanding > 0).length,
        paidOrders: items.filter((item) => item.outstanding <= 0).length,
        totalDebt: items.reduce((sum, item) => sum + item.outstanding, 0),
        totalPaid: items.reduce((sum, item) => sum + item.paidAmount, 0),
      },
      purchaseOrders: items,
    };
  }
}
