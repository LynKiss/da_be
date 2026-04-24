import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { InventoryTransactionEntity, InventoryTransactionType } from '../products/entities/inventory-transaction.entity';
import { ProductEntity } from '../products/entities/product.entity';
import { AdjustmentReason, AdjustmentStatus, StockAdjustmentEntity } from './entities/stock-adjustment.entity';
import { StockAdjustmentItemEntity } from './entities/stock-adjustment-item.entity';
import { StockTransferEntity, StockTransferStatus } from './entities/stock-transfer.entity';
import { StockTransferItemEntity } from './entities/stock-transfer-item.entity';
import { WarehouseEntity } from './entities/warehouse.entity';
import { WarehouseStockEntity } from './entities/warehouse-stock.entity';

function genCode(prefix: string): string {
  const now = new Date();
  const ymd =
    now.getFullYear().toString() +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0');
  const rand = Math.floor(Math.random() * 9000 + 1000);
  return `${prefix}-${ymd}-${rand}`;
}

@Injectable()
export class WarehousesService {
  constructor(
    @InjectRepository(WarehouseEntity)
    private readonly whRepo: Repository<WarehouseEntity>,

    @InjectRepository(WarehouseStockEntity)
    private readonly wsRepo: Repository<WarehouseStockEntity>,

    @InjectRepository(StockTransferEntity)
    private readonly transferRepo: Repository<StockTransferEntity>,

    @InjectRepository(StockTransferItemEntity)
    private readonly transferItemRepo: Repository<StockTransferItemEntity>,

    @InjectRepository(StockAdjustmentEntity)
    private readonly adjRepo: Repository<StockAdjustmentEntity>,

    @InjectRepository(StockAdjustmentItemEntity)
    private readonly adjItemRepo: Repository<StockAdjustmentItemEntity>,

    @InjectRepository(ProductEntity)
    private readonly productRepo: Repository<ProductEntity>,

    @InjectRepository(InventoryTransactionEntity)
    private readonly txRepo: Repository<InventoryTransactionEntity>,

    private readonly dataSource: DataSource,
  ) {}

  // ─── Warehouses ───────────────────────────────────────────────────────────

  findAll() {
    return this.whRepo.find({ order: { isDefault: 'DESC', name: 'ASC' } });
  }

  async findOne(id: string) {
    const wh = await this.whRepo.findOne({ where: { warehouseId: id } });
    if (!wh) throw new NotFoundException('Không tìm thấy kho hàng');
    return wh;
  }

  async create(dto: { name: string; code?: string; address?: string; managerName?: string; phone?: string }) {
    const wh = this.whRepo.create({
      warehouseId: uuidv4(),
      name: dto.name,
      code: dto.code ?? null,
      address: dto.address ?? null,
      managerName: dto.managerName ?? null,
      phone: dto.phone ?? null,
      isActive: true,
      isDefault: false,
    });
    return this.whRepo.save(wh);
  }

  async update(id: string, dto: Partial<{ name: string; code: string; address: string; managerName: string; phone: string; isActive: boolean }>) {
    const wh = await this.findOne(id);
    Object.assign(wh, dto);
    return this.whRepo.save(wh);
  }

  async setDefault(id: string) {
    await this.whRepo.update({}, { isDefault: false });
    await this.whRepo.update({ warehouseId: id }, { isDefault: true });
    return this.findOne(id);
  }

  async getStock(warehouseId: string) {
    return this.wsRepo
      .createQueryBuilder('ws')
      .where('ws.warehouseId = :warehouseId', { warehouseId })
      .leftJoinAndMapOne('ws.product', ProductEntity, 'p', 'p.productId = ws.productId')
      .orderBy('ws.quantity', 'DESC')
      .getMany();
  }

  // ─── Stock Transfers ──────────────────────────────────────────────────────

  async findAllTransfers(page = 1, limit = 20, status?: string) {
    const qb = this.transferRepo.createQueryBuilder('t').orderBy('t.createdAt', 'DESC');
    if (status && status !== 'all') qb.andWhere('t.status = :status', { status });
    const total = await qb.getCount();
    const items = await qb.skip((page - 1) * limit).take(limit).getMany();
    return { items, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  async findOneTransfer(id: string) {
    const t = await this.transferRepo.findOne({ where: { transferId: id }, relations: ['items'] });
    if (!t) throw new NotFoundException('Không tìm thấy phiếu chuyển kho');
    return t;
  }

  async createTransfer(dto: {
    fromWarehouseId: string;
    toWarehouseId: string;
    transferDate?: string;
    notes?: string;
    items: Array<{ productId: string; qtyRequested: number; notes?: string }>;
  }, userId?: string) {
    if (dto.fromWarehouseId === dto.toWarehouseId) {
      throw new BadRequestException('Kho nguồn và kho đích không được giống nhau');
    }

    const transfer = this.transferRepo.create({
      transferId: uuidv4(),
      transferCode: genCode('TR'),
      fromWarehouseId: dto.fromWarehouseId,
      toWarehouseId: dto.toWarehouseId,
      status: StockTransferStatus.DRAFT,
      transferDate: dto.transferDate ? new Date(dto.transferDate) : null,
      notes: dto.notes ?? null,
      createdBy: userId ?? null,
    });

    transfer.items = dto.items.map((i) =>
      this.transferItemRepo.create({
        transferId: transfer.transferId,
        productId: i.productId,
        qtyRequested: i.qtyRequested,
        qtyReceived: 0,
        notes: i.notes ?? null,
      }),
    );

    return this.transferRepo.save(transfer);
  }

  async shipTransfer(id: string, userId?: string) {
    const t = await this.findOneTransfer(id);
    if (t.status !== StockTransferStatus.DRAFT) {
      throw new BadRequestException('Phiếu chuyển kho đã được xử lý');
    }

    await this.dataSource.transaction(async (em) => {
      for (const item of t.items) {
        // Trừ kho nguồn
        const fromStock = await em.findOne(WarehouseStockEntity, {
          where: { warehouseId: t.fromWarehouseId, productId: item.productId },
        });
        if (!fromStock || fromStock.quantity < item.qtyRequested) {
          throw new BadRequestException(`Kho nguồn không đủ hàng cho sản phẩm ${item.productId}`);
        }
        fromStock.quantity -= item.qtyRequested;
        await em.save(WarehouseStockEntity, fromStock);

        // Tạo tx xuất
        await em.save(InventoryTransactionEntity, em.create(InventoryTransactionEntity, {
          productId: item.productId,
          performedBy: userId ?? null,
          transactionType: InventoryTransactionType.EXPORT,
          quantityChange: -item.qtyRequested,
          referenceType: 'TR',
          referenceId: t.transferId,
          note: `Xuất kho chuyển theo phiếu ${t.transferCode}`,
          relatedOrderId: t.transferId,
        }));
      }

      await em.update(StockTransferEntity, { transferId: id }, { status: StockTransferStatus.SHIPPING });
    });

    return this.findOneTransfer(id);
  }

  async receiveTransfer(
    id: string,
    receivedItems: Array<{ productId: string; qtyReceived: number }>,
    userId?: string,
  ) {
    const t = await this.findOneTransfer(id);
    if (t.status !== StockTransferStatus.SHIPPING) {
      throw new BadRequestException('Phiếu chưa ở trạng thái đang vận chuyển');
    }

    await this.dataSource.transaction(async (em) => {
      for (const recv of receivedItems) {
        // Cộng kho đích
        let toStock = await em.findOne(WarehouseStockEntity, {
          where: { warehouseId: t.toWarehouseId, productId: recv.productId },
        });
        if (!toStock) {
          toStock = em.create(WarehouseStockEntity, {
            warehouseId: t.toWarehouseId,
            productId: recv.productId,
            quantity: 0,
          });
        }
        toStock.quantity += recv.qtyReceived;
        await em.save(WarehouseStockEntity, toStock);

        // Cập nhật qty_received trên item
        await em
          .createQueryBuilder()
          .update(StockTransferItemEntity)
          .set({ qtyReceived: recv.qtyReceived })
          .where('transfer_id = :tid AND product_id = :pid', { tid: id, pid: recv.productId })
          .execute();

        // Tạo tx nhập
        await em.save(InventoryTransactionEntity, em.create(InventoryTransactionEntity, {
          productId: recv.productId,
          performedBy: userId ?? null,
          transactionType: InventoryTransactionType.IMPORT,
          quantityChange: recv.qtyReceived,
          referenceType: 'TR',
          referenceId: t.transferId,
          note: `Nhập kho nhận từ phiếu chuyển ${t.transferCode}`,
          relatedOrderId: t.transferId,
        }));
      }

      await em.update(StockTransferEntity, { transferId: id }, {
        status: StockTransferStatus.RECEIVED,
        receivedDate: new Date(),
      });
    });

    return this.findOneTransfer(id);
  }

  // ─── Stock Adjustments ────────────────────────────────────────────────────

  async findAllAdjustments(page = 1, limit = 20, status?: string) {
    const qb = this.adjRepo.createQueryBuilder('a').orderBy('a.createdAt', 'DESC');
    if (status && status !== 'all') qb.andWhere('a.status = :status', { status });
    const total = await qb.getCount();
    const items = await qb.skip((page - 1) * limit).take(limit).getMany();
    return { items, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  async findOneAdjustment(id: string) {
    const a = await this.adjRepo.findOne({ where: { adjustmentId: id }, relations: ['items'] });
    if (!a) throw new NotFoundException('Không tìm thấy phiếu điều chỉnh kho');
    return a;
  }

  async createAdjustment(dto: {
    warehouseId?: string;
    reason: AdjustmentReason;
    adjustmentDate?: string;
    notes?: string;
    items: Array<{ productId: string; qtyBefore: number; qtyAfter: number; notes?: string }>;
  }, userId?: string) {
    const adj = this.adjRepo.create({
      adjustmentId: uuidv4(),
      adjustmentCode: genCode('ADJ'),
      warehouseId: dto.warehouseId ?? null,
      reason: dto.reason,
      status: AdjustmentStatus.DRAFT,
      adjustmentDate: dto.adjustmentDate ? new Date(dto.adjustmentDate) : null,
      notes: dto.notes ?? null,
      createdBy: userId ?? null,
    });

    adj.items = dto.items.map((i) =>
      this.adjItemRepo.create({
        adjustmentId: adj.adjustmentId,
        productId: i.productId,
        qtyBefore: i.qtyBefore,
        qtyAfter: i.qtyAfter,
        qtyDiff: i.qtyAfter - i.qtyBefore,
        notes: i.notes ?? null,
      }),
    );

    return this.adjRepo.save(adj);
  }

  async approveAdjustment(id: string, userId?: string) {
    const adj = await this.findOneAdjustment(id);
    if (adj.status !== AdjustmentStatus.DRAFT) {
      throw new BadRequestException('Phiếu điều chỉnh đã được xử lý');
    }

    await this.dataSource.transaction(async (em) => {
      for (const item of adj.items) {
        const product = await em.findOne(ProductEntity, {
          where: { productId: item.productId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!product) continue;

        const qtyBefore = product.quantityAvailable;
        product.quantityAvailable = item.qtyAfter;
        await em.save(ProductEntity, product);

        if (item.qtyDiff !== 0) {
          const txType =
            item.qtyDiff > 0
              ? InventoryTransactionType.ADJUSTMENT
              : InventoryTransactionType.DAMAGE;

          await em.save(InventoryTransactionEntity, em.create(InventoryTransactionEntity, {
            productId: item.productId,
            performedBy: userId ?? null,
            transactionType: txType,
            quantityChange: item.qtyDiff,
            quantityBefore: qtyBefore,
            quantityAfter: item.qtyAfter,
            referenceType: 'ADJ',
            referenceId: adj.adjustmentId,
            note: `Điều chỉnh kho theo phiếu ${adj.adjustmentCode} — lý do: ${adj.reason}`,
            relatedOrderId: adj.adjustmentId,
          }));
        }
      }

      await em.update(StockAdjustmentEntity, { adjustmentId: id }, {
        status: AdjustmentStatus.APPROVED,
        approvedBy: userId ?? null,
        approvedAt: new Date(),
      });
    });

    return this.findOneAdjustment(id);
  }

  async cancelAdjustment(id: string) {
    const adj = await this.findOneAdjustment(id);
    if (adj.status === AdjustmentStatus.APPROVED) {
      throw new BadRequestException('Không thể hủy phiếu đã duyệt');
    }
    await this.adjRepo.update({ adjustmentId: id }, { status: AdjustmentStatus.CANCELLED });
    return this.findOneAdjustment(id);
  }
}
