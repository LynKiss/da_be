import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { InventoryTransactionEntity, InventoryTransactionType } from '../products/entities/inventory-transaction.entity';
import { ProductEntity } from '../products/entities/product.entity';
import { WarehouseEntity } from '../warehouses/entities/warehouse.entity';
import { WarehouseStockEntity } from '../warehouses/entities/warehouse-stock.entity';
import { CreateGrDto } from './dto/create-gr.dto';
import { CreatePoDto } from './dto/create-po.dto';
import { CreateSrDto } from './dto/create-sr.dto';
import { QueryProcurementDto } from './dto/query-procurement.dto';
import { GoodsReceiptItemEntity } from './entities/goods-receipt-item.entity';
import { GoodsReceiptEntity, GoodsReceiptStatus } from './entities/goods-receipt.entity';
import { ProductCostHistoryEntity } from './entities/product-cost-history.entity';
import { PurchaseOrderItemEntity } from './entities/purchase-order-item.entity';
import { PurchaseOrderEntity, PurchaseOrderStatus } from './entities/purchase-order.entity';
import { SupplierReturnItemEntity } from './entities/supplier-return-item.entity';
import { SupplierReturnEntity, SupplierReturnStatus } from './entities/supplier-return.entity';

function genCode(prefix: string): string {
  const now = new Date();
  const ymd =
    now.getFullYear().toString() +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0');
  const rand = Math.floor(Math.random() * 9000 + 1000);
  return `${prefix}-${ymd}-${rand}`;
}

/**
 * Tính giá vốn thực tế / cái (landed cost)
 *
 * Trường hợp A – NCC hoàn tiền cho hàng lỗi:
 *   tiền hàng đạt = qty_good × unit_price - refund_amount (hoặc trừ thẳng trên qty_returned)
 *   giá vốn = (tiền hàng đạt + phí vận chuyển phân bổ) / qty_good
 *
 * Trường hợp B – NCC không hoàn tiền:
 *   giá vốn = (tổng tiền tất cả hàng + phí vận chuyển phân bổ) / qty_good
 *   (hàng tốt gánh chi phí hàng lỗi)
 */
function calcLandedCost(params: {
  qtyReceived: number;
  qtyDefective: number;
  qtyReturned: number;
  hasRefund: boolean;
  refundAmount: number;
  unitPrice: number;
  allocatedExtraCost: number; // phí VC + phí khác phân bổ cho dòng này
}): number {
  const {
    qtyReceived,
    qtyDefective,
    qtyReturned,
    hasRefund,
    refundAmount,
    unitPrice,
    allocatedExtraCost,
  } = params;

  const qtyGood = qtyReceived - qtyReturned;
  if (qtyGood <= 0) return 0;

  let goodsTotal: number;

  if (hasRefund) {
    // TH A: trừ tiền hàng được hoàn
    goodsTotal = qtyReceived * unitPrice - refundAmount;
  } else {
    // TH B: toàn bộ tiền hàng (kể cả cái bị lỗi) phân bổ sang hàng tốt
    goodsTotal = qtyReceived * unitPrice;
  }

  return (goodsTotal + allocatedExtraCost) / qtyGood;
}

@Injectable()
export class ProcurementService {
  constructor(
    @InjectRepository(PurchaseOrderEntity)
    private readonly poRepo: Repository<PurchaseOrderEntity>,

    @InjectRepository(PurchaseOrderItemEntity)
    private readonly poItemRepo: Repository<PurchaseOrderItemEntity>,

    @InjectRepository(GoodsReceiptEntity)
    private readonly grRepo: Repository<GoodsReceiptEntity>,

    @InjectRepository(GoodsReceiptItemEntity)
    private readonly grItemRepo: Repository<GoodsReceiptItemEntity>,

    @InjectRepository(SupplierReturnEntity)
    private readonly srRepo: Repository<SupplierReturnEntity>,

    @InjectRepository(SupplierReturnItemEntity)
    private readonly srItemRepo: Repository<SupplierReturnItemEntity>,

    @InjectRepository(ProductCostHistoryEntity)
    private readonly costHistRepo: Repository<ProductCostHistoryEntity>,

    @InjectRepository(ProductEntity)
    private readonly productRepo: Repository<ProductEntity>,

    @InjectRepository(InventoryTransactionEntity)
    private readonly txRepo: Repository<InventoryTransactionEntity>,

    private readonly dataSource: DataSource,
    private readonly auditLogs: AuditLogsService,
  ) {}

  // ─── PURCHASE ORDERS ─────────────────────────────────────────────────────

  async findAllPos(query: QueryProcurementDto) {
    const { search, status, supplierId, from, to, page = 1, limit = 20 } = query;
    const qb = this.poRepo
      .createQueryBuilder('po')
      .orderBy('po.createdAt', 'DESC');

    if (search?.trim()) {
      qb.andWhere('po.poCode LIKE :kw', { kw: `%${search.trim()}%` });
    }
    if (status && status !== 'all') qb.andWhere('po.status = :status', { status });
    if (supplierId) qb.andWhere('po.supplierId = :supplierId', { supplierId });
    if (from) qb.andWhere('po.orderDate >= :from', { from });
    if (to) qb.andWhere('po.orderDate <= :to', { to });

    const total = await qb.getCount();
    const items = await qb.skip((page - 1) * limit).take(limit).getMany();
    return { items, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  async findOnePo(id: string) {
    const po = await this.poRepo.findOne({
      where: { poId: id },
      relations: ['items'],
    });
    if (!po) throw new NotFoundException('Không tìm thấy phiếu đặt hàng');
    return po;
  }

  async createPo(dto: CreatePoDto, performer?: { userId: string; username: string; ip?: string }) {
    const po = this.poRepo.create({
      poId: uuidv4(),
      poCode: genCode('PO'),
      supplierId: dto.supplierId,
      status: PurchaseOrderStatus.DRAFT,
      orderDate: dto.orderDate ? new Date(dto.orderDate) : null,
      expectedDate: dto.expectedDate ? new Date(dto.expectedDate) : null,
      shippingCost: String(dto.shippingCost ?? 0),
      otherCost: String(dto.otherCost ?? 0),
      notes: dto.notes ?? null,
      createdBy: performer?.userId ?? null,
    });

    let totalAmount = 0;
    const items = dto.items.map((i) => {
      const lineTotal = i.qtyOrdered * i.unitPrice;
      totalAmount += lineTotal;
      return this.poItemRepo.create({
        poId: po.poId,
        productId: i.productId,
        unit: i.unit ?? 'cái',
        unitPerBase: i.unitPerBase ?? 1,
        qtyOrdered: i.qtyOrdered,
        qtyReceived: 0,
        unitPrice: String(i.unitPrice),
        notes: i.notes ?? null,
      });
    });
    po.totalAmount = String(totalAmount);
    po.items = items;

    const saved = await this.poRepo.save(po);
    void this.auditLogs.log({
      entityType: 'PO',
      entityId: saved.poId,
      action: 'CREATE',
      changedBy: performer?.username,
      ipAddress: performer?.ip,
      afterData: { poCode: saved.poCode, supplierId: saved.supplierId, totalAmount: saved.totalAmount },
    });
    return saved;
  }

  async updatePoStatus(id: string, status: PurchaseOrderStatus, performer?: { userId: string; username: string; ip?: string }) {
    const po = await this.findOnePo(id);
    if (po.status === PurchaseOrderStatus.CANCELLED) {
      throw new BadRequestException('Phiếu đã hủy không thể thay đổi trạng thái');
    }
    const before = { status: po.status };
    po.status = status;
    const saved = await this.poRepo.save(po);
    void this.auditLogs.log({
      entityType: 'PO',
      entityId: id,
      action: status === PurchaseOrderStatus.CANCELLED ? 'CANCEL' : 'UPDATE',
      changedBy: performer?.username,
      ipAddress: performer?.ip,
      beforeData: before,
      afterData: { status },
    });
    return saved;
  }

  // ─── GOODS RECEIPTS ───────────────────────────────────────────────────────

  async findAllGrs(query: QueryProcurementDto) {
    const { search, status, supplierId, from, to, page = 1, limit = 20 } = query;
    const qb = this.grRepo.createQueryBuilder('gr').orderBy('gr.createdAt', 'DESC');

    if (search?.trim()) {
      qb.andWhere('gr.grCode LIKE :kw', { kw: `%${search.trim()}%` });
    }
    if (status && status !== 'all') qb.andWhere('gr.status = :status', { status });
    if (supplierId) qb.andWhere('gr.supplierId = :supplierId', { supplierId });
    if (from) qb.andWhere('gr.receiptDate >= :from', { from });
    if (to) qb.andWhere('gr.receiptDate <= :to', { to });

    const total = await qb.getCount();
    const items = await qb.skip((page - 1) * limit).take(limit).getMany();
    return { items, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  async findOneGr(id: string) {
    const gr = await this.grRepo.findOne({ where: { grId: id }, relations: ['items'] });
    if (!gr) throw new NotFoundException('Không tìm thấy phiếu nhận hàng');
    return gr;
  }

  async createGr(dto: CreateGrDto, performer?: { userId: string; username: string; ip?: string }) {
    const shippingCost = dto.shippingCost ?? 0;
    const otherCost = dto.otherCost ?? 0;
    const totalExtraCost = shippingCost + otherCost;

    // Tính tổng số lượng nhận để phân bổ chi phí theo tỷ lệ
    const totalQtyReceived = dto.items.reduce(
      (sum, i) => sum + (i.qtyReceived - (i.qtyReturned ?? 0)),
      0,
    );

    const gr = this.grRepo.create({
      grId: uuidv4(),
      grCode: genCode('GR'),
      poId: dto.poId ?? null,
      supplierId: dto.supplierId,
      receiptDate: new Date(dto.receiptDate),
      shippingCost: String(shippingCost),
      otherCost: String(otherCost),
      status: GoodsReceiptStatus.DRAFT,
      notes: dto.notes ?? null,
      createdBy: performer?.userId ?? null,
    });

    const items = dto.items.map((i) => {
      const qtyGood = i.qtyReceived - (i.qtyReturned ?? 0);
      // Phân bổ chi phí ngoài theo tỷ lệ số lượng đạt
      const allocatedExtraCost =
        totalQtyReceived > 0 ? (qtyGood / totalQtyReceived) * totalExtraCost : 0;

      const landedCost = calcLandedCost({
        qtyReceived: i.qtyReceived,
        qtyDefective: i.qtyDefective ?? 0,
        qtyReturned: i.qtyReturned ?? 0,
        hasRefund: i.hasRefund !== false,
        refundAmount: i.refundAmount ?? 0,
        unitPrice: i.unitPrice,
        allocatedExtraCost,
      });

      return this.grItemRepo.create({
        grId: gr.grId,
        productId: i.productId,
        unit: i.unit ?? 'cái',
        unitPerBase: i.unitPerBase ?? 1,
        qtyOrdered: i.qtyOrdered ?? 0,
        qtyReceived: i.qtyReceived,
        qtyDefective: i.qtyDefective ?? 0,
        qtyReturned: i.qtyReturned ?? 0,
        refundAmount: String(i.refundAmount ?? 0),
        hasRefund: i.hasRefund !== false,
        unitPrice: String(i.unitPrice),
        landedCost: String(Math.round(landedCost)),
        notes: i.notes ?? null,
      });
    });

    gr.items = items;
    const saved = await this.grRepo.save(gr);
    void this.auditLogs.log({
      entityType: 'GR',
      entityId: saved.grId,
      action: 'CREATE',
      changedBy: performer?.username,
      ipAddress: performer?.ip,
      afterData: { grCode: saved.grCode, supplierId: saved.supplierId, poId: saved.poId },
    });
    return saved;
  }

  /**
   * Xác nhận phiếu nhận hàng:
   *  1. Cập nhật quantity_available trên products
   *  2. Cập nhật cost_price trên products
   *  3. Lưu product_cost_history
   *  4. Tạo inventory_transaction (type = import)
   *  5. Nếu có PO → cập nhật qty_received + status PO
   */
  async confirmGr(id: string, performer?: { userId: string; username: string; ip?: string }) {
    const gr = await this.findOneGr(id);

    if (gr.status !== GoodsReceiptStatus.DRAFT) {
      throw new BadRequestException('Phiếu nhận hàng đã được xử lý');
    }

    await this.dataSource.transaction(async (em) => {
      const defaultWarehouse = await em.findOne(WarehouseEntity, { where: { isDefault: true } });

      for (const item of gr.items) {
        const qtyGood =
          item.qtyReceived - item.qtyReturned;
        if (qtyGood <= 0) continue;

        const product = await em.findOne(ProductEntity, {
          where: { productId: item.productId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!product) continue;

        // 1. Cập nhật tồn kho
        const qtyBefore = product.quantityAvailable;
        product.quantityAvailable += qtyGood;
        const qtyAfter = product.quantityAvailable;

        // 2. Cập nhật giá vốn (ghi đè bằng giá vốn nhập mới nhất)
        product.costPrice = item.landedCost;

        await em.save(ProductEntity, product);

        // 3. Lịch sử giá vốn
        const hist = em.create(ProductCostHistoryEntity, {
          productId: item.productId,
          grId: gr.grId,
          costPerUnit: item.landedCost,
          qtyAtReceipt: qtyGood,
          effectiveDate: new Date(),
          notes: `Nhập từ ${gr.grCode}`,
        });
        await em.save(ProductCostHistoryEntity, hist);

        // 4. Inventory transaction
        const tx = em.create(InventoryTransactionEntity, {
          productId: item.productId,
          performedBy: performer?.userId ?? null,
          transactionType: InventoryTransactionType.IMPORT,
          quantityChange: qtyGood,
          quantityBefore: qtyBefore,
          quantityAfter: qtyAfter,
          referenceType: 'GR',
          referenceId: gr.grId,
          note: `Nhập kho từ phiếu ${gr.grCode}`,
          relatedOrderId: gr.grId,
        });
        await em.save(InventoryTransactionEntity, tx);

        // 5. Cập nhật warehouse_stock cho kho mặc định
        if (defaultWarehouse) {
          const stock = await em.findOne(WarehouseStockEntity, {
            where: { warehouseId: defaultWarehouse.warehouseId, productId: item.productId },
          });
          if (stock) {
            stock.quantity += qtyGood;
            await em.save(WarehouseStockEntity, stock);
          } else {
            await em.save(WarehouseStockEntity, em.create(WarehouseStockEntity, {
              warehouseId: defaultWarehouse.warehouseId,
              productId: item.productId,
              quantity: qtyGood,
            }));
          }
        }

        // 6. Cập nhật qty_received trên PO item (nếu có)
        if (gr.poId) {
          await em
            .createQueryBuilder()
            .update(PurchaseOrderItemEntity)
            .set({ qtyReceived: () => `qty_received + ${qtyGood}` })
            .where('po_id = :poId AND product_id = :productId', {
              poId: gr.poId,
              productId: item.productId,
            })
            .execute();
        }
      }

      // 6. Cập nhật status GR
      await em.update(GoodsReceiptEntity, { grId: id }, { status: GoodsReceiptStatus.CONFIRMED });

      // 7. Cập nhật status PO nếu có
      if (gr.poId) {
        const poItems = await em.find(PurchaseOrderItemEntity, { where: { poId: gr.poId } });
        const allReceived = poItems.every((i) => i.qtyReceived >= i.qtyOrdered);
        const anyReceived = poItems.some((i) => i.qtyReceived > 0);
        const newPoStatus = allReceived
          ? PurchaseOrderStatus.RECEIVED
          : anyReceived
            ? PurchaseOrderStatus.PARTIAL
            : PurchaseOrderStatus.ORDERED;

        await em.update(PurchaseOrderEntity, { poId: gr.poId }, { status: newPoStatus });
      }
    });

    void this.auditLogs.log({
      entityType: 'GR',
      entityId: id,
      action: 'CONFIRM',
      changedBy: performer?.username,
      ipAddress: performer?.ip,
      afterData: { grCode: gr.grCode, status: GoodsReceiptStatus.CONFIRMED },
    });
    return this.findOneGr(id);
  }

  async cancelGr(id: string, performer?: { userId: string; username: string; ip?: string }) {
    const gr = await this.findOneGr(id);
    if (gr.status === GoodsReceiptStatus.CONFIRMED) {
      throw new BadRequestException('Không thể hủy phiếu đã xác nhận. Hãy tạo phiếu trả hàng.');
    }
    await this.grRepo.update({ grId: id }, { status: GoodsReceiptStatus.CANCELLED });
    void this.auditLogs.log({
      entityType: 'GR',
      entityId: id,
      action: 'CANCEL',
      changedBy: performer?.username,
      ipAddress: performer?.ip,
      beforeData: { status: gr.status },
      afterData: { status: GoodsReceiptStatus.CANCELLED },
    });
    return this.findOneGr(id);
  }

  // ─── SUPPLIER RETURNS ─────────────────────────────────────────────────────

  async findAllSrs(query: QueryProcurementDto) {
    const { search, status, supplierId, page = 1, limit = 20 } = query;
    const qb = this.srRepo.createQueryBuilder('sr').orderBy('sr.createdAt', 'DESC');

    if (search?.trim()) {
      qb.andWhere('sr.srCode LIKE :kw', { kw: `%${search.trim()}%` });
    }
    if (status && status !== 'all') qb.andWhere('sr.status = :status', { status });
    if (supplierId) qb.andWhere('sr.supplierId = :supplierId', { supplierId });

    const total = await qb.getCount();
    const items = await qb.skip((page - 1) * limit).take(limit).getMany();
    return { items, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  async findOneSr(id: string) {
    const sr = await this.srRepo.findOne({ where: { srId: id }, relations: ['items'] });
    if (!sr) throw new NotFoundException('Không tìm thấy phiếu trả hàng NCC');
    return sr;
  }

  async createSr(dto: CreateSrDto, performer?: { userId: string; username: string; ip?: string }) {
    const totalRefund = dto.items.reduce(
      (sum, i) => sum + (i.hasRefund !== false ? (i.refundAmount ?? i.qtyReturned * i.unitPrice) : 0),
      0,
    );

    const sr = this.srRepo.create({
      srId: uuidv4(),
      srCode: genCode('SR'),
      grId: dto.grId ?? null,
      supplierId: dto.supplierId,
      returnDate: new Date(dto.returnDate),
      status: SupplierReturnStatus.DRAFT,
      totalRefund: String(totalRefund),
      notes: dto.notes ?? null,
      createdBy: performer?.userId ?? null,
    });

    const items = dto.items.map((i) =>
      this.srItemRepo.create({
        srId: sr.srId,
        productId: i.productId,
        qtyReturned: i.qtyReturned,
        unitPrice: String(i.unitPrice),
        hasRefund: i.hasRefund !== false,
        refundAmount: String(
          i.hasRefund !== false
            ? (i.refundAmount ?? i.qtyReturned * i.unitPrice)
            : 0,
        ),
        reason: i.reason ?? null,
      }),
    );
    sr.items = items;
    const saved = await this.srRepo.save(sr);
    void this.auditLogs.log({
      entityType: 'SR',
      entityId: saved.srId,
      action: 'CREATE',
      changedBy: performer?.username,
      ipAddress: performer?.ip,
      afterData: { srCode: saved.srCode, supplierId: saved.supplierId, totalRefund: saved.totalRefund },
    });
    return saved;
  }

  async confirmSr(id: string, performer?: { userId: string; username: string; ip?: string }) {
    const sr = await this.findOneSr(id);
    if (sr.status !== SupplierReturnStatus.DRAFT) {
      throw new BadRequestException('Phiếu trả hàng đã được xử lý');
    }

    await this.dataSource.transaction(async (em) => {
      const defaultWarehouse = await em.findOne(WarehouseEntity, { where: { isDefault: true } });

      for (const item of sr.items) {
        const product = await em.findOne(ProductEntity, {
          where: { productId: item.productId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!product) continue;

        const qtyBefore = product.quantityAvailable;
        product.quantityAvailable = Math.max(0, product.quantityAvailable - item.qtyReturned);
        const qtyAfter = product.quantityAvailable;
        await em.save(ProductEntity, product);

        const tx = em.create(InventoryTransactionEntity, {
          productId: item.productId,
          performedBy: performer?.userId ?? null,
          transactionType: InventoryTransactionType.RETURN_OUT,
          quantityChange: -item.qtyReturned,
          quantityBefore: qtyBefore,
          quantityAfter: qtyAfter,
          referenceType: 'SR',
          referenceId: sr.srId,
          note: `Trả hàng NCC từ phiếu ${sr.srCode} — ${item.reason ?? ''}`,
          relatedOrderId: sr.srId,
        });
        await em.save(InventoryTransactionEntity, tx);

        // Trừ warehouse_stock kho mặc định
        if (defaultWarehouse) {
          const stock = await em.findOne(WarehouseStockEntity, {
            where: { warehouseId: defaultWarehouse.warehouseId, productId: item.productId },
          });
          if (stock) {
            stock.quantity = Math.max(0, stock.quantity - item.qtyReturned);
            await em.save(WarehouseStockEntity, stock);
          }
        }
      }

      await em.update(SupplierReturnEntity, { srId: id }, { status: SupplierReturnStatus.CONFIRMED });
    });

    void this.auditLogs.log({
      entityType: 'SR',
      entityId: id,
      action: 'CONFIRM',
      changedBy: performer?.username,
      ipAddress: performer?.ip,
      afterData: { srCode: sr.srCode, status: SupplierReturnStatus.CONFIRMED },
    });
    return this.findOneSr(id);
  }

  // ─── COST HISTORY ─────────────────────────────────────────────────────────

  async getCostHistory(productId: string) {
    return this.costHistRepo.find({
      where: { productId },
      order: { effectiveDate: 'DESC' },
      take: 50,
    });
  }

  // ─── PREVIEW GR COST (no save) ────────────────────────────────────────────
  previewGrCost(dto: CreateGrDto) {
    const shippingCost = dto.shippingCost ?? 0;
    const otherCost = dto.otherCost ?? 0;
    const totalExtraCost = shippingCost + otherCost;
    const totalQtyReceived = dto.items.reduce(
      (sum, i) => sum + (i.qtyReceived - (i.qtyReturned ?? 0)),
      0,
    );

    return dto.items.map((i) => {
      const qtyGood = i.qtyReceived - (i.qtyReturned ?? 0);
      const allocatedExtraCost =
        totalQtyReceived > 0 ? (qtyGood / totalQtyReceived) * totalExtraCost : 0;

      const landedCost = calcLandedCost({
        qtyReceived: i.qtyReceived,
        qtyDefective: i.qtyDefective ?? 0,
        qtyReturned: i.qtyReturned ?? 0,
        hasRefund: i.hasRefund !== false,
        refundAmount: i.refundAmount ?? 0,
        unitPrice: i.unitPrice,
        allocatedExtraCost,
      });

      return {
        productId: i.productId,
        qtyReceived: i.qtyReceived,
        qtyReturned: i.qtyReturned ?? 0,
        qtyGood,
        unitPrice: i.unitPrice,
        allocatedExtraCost: Math.round(allocatedExtraCost),
        landedCost: Math.round(landedCost),
        totalLandedCost: Math.round(landedCost * qtyGood),
      };
    });
  }
}
