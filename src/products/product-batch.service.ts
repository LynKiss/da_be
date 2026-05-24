import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { EntityManager, IsNull, Not, Repository } from 'typeorm';
import { ProductBatchEntity } from './entities/product-batch.entity';
import { ProductEntity } from './entities/product.entity';
import {
  InventoryTransactionEntity,
  InventoryTransactionType,
} from './entities/inventory-transaction.entity';

export type BatchPickLine = {
  batchId: string;
  batchCode: string;
  qty: number;
  unitCost: number;
  subtotal: number;
  expDate: Date | null;
};

export type BatchPickResult = {
  lines: BatchPickLine[];
  totalQty: number;
  totalCost: number;
  avgCost: number;
  shortfall: number;
  success: boolean;
};

export type CreateBatchInput = {
  productId: string;
  grId?: string | null;
  batchCode: string;
  mfgDate?: Date | string | null;
  expDate?: Date | string | null;
  qtyReceived: number;
  unitCost: number;
  note?: string | null;
};

/**
 * Quản lý lô hàng (batch) cho FIFO/FEFO inventory.
 *
 * Chiến lược pick: HYBRID FEFO + FIFO
 *  - Lô có exp_date IS NOT NULL → ưu tiên theo exp_date ASC (sắp hết hạn trước)
 *  - Lô có exp_date IS NULL → fallback FIFO theo created_at ASC
 *  - Hai group được merge theo thứ tự: group có exp trước (đã sort), sau đó group không exp.
 *
 * Bỏ qua lô đã hết hàng (qty_remaining = 0) và lô đã hết hạn ở thời điểm pick.
 */
@Injectable()
export class ProductBatchService {
  constructor(
    @InjectRepository(ProductBatchEntity)
    private readonly batchRepo: Repository<ProductBatchEntity>,
  ) {}

  // ─── Read helpers ─────────────────────────────────────────────────────────
  async findAll(filters: { productId?: string; includeDepleted?: boolean } = {}) {
    const qb = this.batchRepo
      .createQueryBuilder('b')
      .orderBy('b.expDate IS NULL', 'ASC')
      .addOrderBy('b.expDate', 'ASC')
      .addOrderBy('b.createdAt', 'ASC');
    if (filters.productId) qb.andWhere('b.productId = :pid', { pid: filters.productId });
    if (!filters.includeDepleted) qb.andWhere('b.qtyRemaining > 0');
    return qb.getMany();
  }

  async findById(batchId: string) {
    const b = await this.batchRepo.findOne({ where: { batchId } });
    if (!b) throw new NotFoundException(`Không tìm thấy lô ${batchId}`);
    return b;
  }

  /**
   * Lô sắp hết hạn (còn hàng) trong N ngày kể từ now.
   */
  async findExpiring(daysAhead = 30) {
    const now = new Date();
    const cutoff = new Date(now.getTime() + daysAhead * 86_400_000);
    return this.batchRepo
      .createQueryBuilder('b')
      .where('b.qtyRemaining > 0')
      .andWhere('b.expDate IS NOT NULL')
      .andWhere('b.expDate >= :now AND b.expDate <= :cutoff', { now, cutoff })
      .orderBy('b.expDate', 'ASC')
      .getMany();
  }

  /**
   * Lô đã hết hạn nhưng vẫn còn hàng → cần write-off.
   */
  async findExpired() {
    const now = new Date();
    return this.batchRepo
      .createQueryBuilder('b')
      .where('b.qtyRemaining > 0')
      .andWhere('b.expDate IS NOT NULL')
      .andWhere('b.expDate < :now', { now })
      .orderBy('b.expDate', 'ASC')
      .getMany();
  }

  // ─── Create batch ─────────────────────────────────────────────────────────
  /**
   * Tạo mới 1 batch. Phải gọi trong transaction khi confirm GR để rollback được nếu lỗi.
   */
  createInTx(em: EntityManager, input: CreateBatchInput): Promise<ProductBatchEntity> {
    if (input.qtyReceived <= 0) {
      throw new BadRequestException('Số lượng nhập phải > 0');
    }
    if (!input.batchCode) {
      throw new BadRequestException('Số lô không được rỗng');
    }
    const batch = em.create(ProductBatchEntity, {
      batchId: randomUUID(),
      productId: input.productId,
      grId: input.grId ?? null,
      batchCode: input.batchCode,
      mfgDate: input.mfgDate ? new Date(input.mfgDate) : null,
      expDate: input.expDate ? new Date(input.expDate) : null,
      qtyReceived: input.qtyReceived,
      qtyRemaining: input.qtyReceived,
      unitCost: input.unitCost.toFixed(4),
      note: input.note ?? null,
    });
    return em.save(ProductBatchEntity, batch);
  }

  // ─── FIFO/FEFO pick ───────────────────────────────────────────────────────
  /**
   * Pick batches cho 1 đơn xuất kho với chiến lược hybrid FEFO+FIFO.
   *
   *  - Loại bỏ: lô đã hết hàng, lô đã hết hạn (tránh bán hàng quá date).
   *  - Sort: exp_date ASC (NULL last), tie-break theo created_at ASC.
   *  - Lấy lần lượt từng lô cho đến khi đủ qty hoặc hết lô eligible.
   *
   * Hàm này CHỈ TÍNH TOÁN, không trừ batch. Dùng để preview.
   * Để thực sự trừ → gọi consumeInTx().
   */
  async previewPick(productId: string, qty: number, referenceDate: Date = new Date()): Promise<BatchPickResult> {
    if (qty <= 0) {
      return { lines: [], totalQty: 0, totalCost: 0, avgCost: 0, shortfall: qty, success: false };
    }
    const eligible = await this.batchRepo
      .createQueryBuilder('b')
      .where('b.productId = :pid', { pid: productId })
      .andWhere('b.qtyRemaining > 0')
      .andWhere('(b.expDate IS NULL OR b.expDate >= :ref)', { ref: referenceDate })
      .orderBy('CASE WHEN b.expDate IS NULL THEN 1 ELSE 0 END', 'ASC')
      .addOrderBy('b.expDate', 'ASC')
      .addOrderBy('b.createdAt', 'ASC')
      .getMany();

    return this.computePick(eligible, qty);
  }

  /**
   * Logic pick thuần (không touch DB). Dùng được trong transaction với batches đã lock.
   */
  computePick(eligibleBatches: ProductBatchEntity[], qty: number): BatchPickResult {
    let remaining = qty;
    const lines: BatchPickLine[] = [];

    for (const b of eligibleBatches) {
      if (remaining <= 0) break;
      const take = Math.min(b.qtyRemaining, remaining);
      const unitCost = Number(b.unitCost);
      lines.push({
        batchId: b.batchId,
        batchCode: b.batchCode,
        qty: take,
        unitCost,
        subtotal: take * unitCost,
        expDate: b.expDate,
      });
      remaining -= take;
    }

    const totalQty = qty - remaining;
    const totalCost = lines.reduce((s, l) => s + l.subtotal, 0);
    return {
      lines,
      totalQty,
      totalCost,
      avgCost: totalQty > 0 ? totalCost / totalQty : 0,
      shortfall: remaining,
      success: remaining === 0,
    };
  }

  /**
   * Pick + trừ qty trong cùng transaction. Throw nếu không đủ hàng.
   *
   *  - Lock batch hàng nhập trước bằng pessimistic_write → tránh race với order khác.
   *  - Trừ qty_remaining trên từng batch picked.
   *  - Trả về breakdown để caller log inventory transactions kèm batch_id.
   */
  async consumeInTx(
    em: EntityManager,
    productId: string,
    qty: number,
    referenceDate: Date = new Date(),
  ): Promise<BatchPickResult> {
    if (qty <= 0) {
      return { lines: [], totalQty: 0, totalCost: 0, avgCost: 0, shortfall: 0, success: true };
    }

    // Lock các batch còn hàng + chưa hết hạn theo thứ tự FEFO/FIFO
    const eligible = await em
      .createQueryBuilder(ProductBatchEntity, 'b')
      .setLock('pessimistic_write')
      .where('b.productId = :pid', { pid: productId })
      .andWhere('b.qtyRemaining > 0')
      .andWhere('(b.expDate IS NULL OR b.expDate >= :ref)', { ref: referenceDate })
      .orderBy('CASE WHEN b.expDate IS NULL THEN 1 ELSE 0 END', 'ASC')
      .addOrderBy('b.expDate', 'ASC')
      .addOrderBy('b.createdAt', 'ASC')
      .getMany();

    const pick = this.computePick(eligible, qty);
    if (!pick.success) {
      throw new BadRequestException(
        `Không đủ hàng để xuất theo FIFO/FEFO. Thiếu ${pick.shortfall} (cần ${qty}, có thể xuất ${pick.totalQty}).`,
      );
    }

    // Trừ qty thực tế
    for (const line of pick.lines) {
      await em
        .createQueryBuilder()
        .update(ProductBatchEntity)
        .set({ qtyRemaining: () => `qty_remaining - ${line.qty}` })
        .where('batch_id = :id AND qty_remaining >= :qty', { id: line.batchId, qty: line.qty })
        .execute();
    }

    return pick;
  }

  /**
   * Cộng lại qty cho 1 batch cụ thể. Dùng trong restock (cancel/refund order).
   *
   * KHÔNG kiểm tra qtyRemaining + qty <= qtyReceived vì:
   *  - Có thể có rounding hoặc bù trừ do nhiều lần partial cancel.
   *  - Source of truth là inventory_transactions; batch chỉ là cache.
   */
  async restoreInTx(em: EntityManager, batchId: string, qty: number): Promise<void> {
    if (qty <= 0) return;
    await em
      .createQueryBuilder()
      .update(ProductBatchEntity)
      .set({ qtyRemaining: () => `qty_remaining + ${qty}` })
      .where('batch_id = :id', { id: batchId })
      .execute();
  }

  /**
   * Tính NET consumption (đã trừ - đã hoàn) của 1 order cho 1 product.
   *
   *  - Truy vấn inventory_transactions của order với batch_id != NULL
   *  - EXPORT = consume (quantityChange < 0)
   *  - RETURN_IN = restore (quantityChange > 0)
   *  - Trả về Map<batchId, netQty> để biết còn lại bao nhiêu chưa hoàn
   *
   * Idempotent: gọi nhiều lần vẫn ra cùng kết quả.
   */
  async getOrderBatchConsumption(
    em: EntityManager,
    orderId: string,
    productId?: string,
  ): Promise<Map<string, number>> {
    const qb = em
      .createQueryBuilder(InventoryTransactionEntity, 'tx')
      .where('tx.relatedOrderId = :oid', { oid: orderId })
      .andWhere('tx.batchId IS NOT NULL');
    if (productId) qb.andWhere('tx.productId = :pid', { pid: productId });
    const txns = await qb.getMany();

    const netMap = new Map<string, number>();
    for (const tx of txns) {
      if (!tx.batchId) continue;
      // EXPORT: quantityChange âm → consume; RETURN_IN: quantityChange dương → restore
      const consumed = -tx.quantityChange; // dương = đã trừ; âm = đã hoàn
      netMap.set(tx.batchId, (netMap.get(tx.batchId) ?? 0) + consumed);
    }
    return netMap;
  }

  // ─── Write-off + price reduction ──────────────────────────────────────────
  /**
   * Hủy lô (qty = remaining → 0). Sinh inventory_transaction type DAMAGE với batch_id.
   */
  async writeOff(
    batchId: string,
    reason: 'expired' | 'damaged' | 'quality_fail' | 'other',
    notes: string,
    performer?: { userId: string; username: string },
  ) {
    return this.batchRepo.manager.transaction(async (em) => {
      const batch = await em.findOne(ProductBatchEntity, {
        where: { batchId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!batch) throw new NotFoundException(`Không tìm thấy lô ${batchId}`);
      if (batch.qtyRemaining <= 0) {
        throw new BadRequestException('Lô này đã hết hàng, không cần hủy.');
      }

      const product = await em.findOne(ProductEntity, {
        where: { productId: batch.productId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!product) throw new NotFoundException('Sản phẩm không tồn tại.');

      const qty = batch.qtyRemaining;
      const unitCost = Number(batch.unitCost);
      const totalLoss = qty * unitCost;

      const qtyBefore = product.quantityAvailable;
      product.quantityAvailable = Math.max(0, product.quantityAvailable - qty);
      await em.save(ProductEntity, product);

      batch.qtyRemaining = 0;
      await em.save(ProductBatchEntity, batch);

      const tx = em.create(InventoryTransactionEntity, {
        productId: batch.productId,
        performedBy: performer?.userId ?? null,
        transactionType: InventoryTransactionType.DAMAGE,
        quantityChange: -qty,
        quantityBefore: qtyBefore,
        quantityAfter: product.quantityAvailable,
        referenceType: 'BATCH_WRITEOFF',
        referenceId: batch.batchId,
        batchId: batch.batchId,
        unitCostAtTime: batch.unitCost,
        note: `Hủy lô ${batch.batchCode} (${reason})${notes ? ': ' + notes : ''}`,
      });
      await em.save(InventoryTransactionEntity, tx);

      return { batch, totalLoss, reason };
    });
  }

  /**
   * Giảm giá lô. Chỉ update unit_cost của batch; KHÔNG ảnh hưởng product.avgCost.
   * Lý do: avgCost dùng để tính COGS, batch.unit_cost mới là nguồn sự thật khi FIFO consume.
   */
  async priceReduction(
    batchId: string,
    newUnitCost: number,
    notes: string,
  ) {
    if (newUnitCost <= 0) {
      throw new BadRequestException('Giá mới phải > 0.');
    }
    const batch = await this.findById(batchId);
    if (batch.qtyRemaining <= 0) {
      throw new BadRequestException('Lô đã hết hàng, không thể giảm giá.');
    }
    const oldCost = Number(batch.unitCost);
    if (newUnitCost >= oldCost) {
      throw new BadRequestException(`Giá mới phải thấp hơn giá hiện tại ${oldCost}.`);
    }

    batch.unitCost = newUnitCost.toFixed(4);
    batch.note = `${batch.note ?? ''}\n[Giảm giá ${new Date().toISOString().slice(0, 10)}: ${oldCost} → ${newUnitCost}${notes ? ' - ' + notes : ''}]`.trim();
    await this.batchRepo.save(batch);
    return { batch, oldCost, newUnitCost };
  }

  // ─── Stats ─────────────────────────────────────────────────────────────────
  async stats(productId?: string) {
    const qb = this.batchRepo.createQueryBuilder('b').where('b.qtyRemaining > 0');
    if (productId) qb.andWhere('b.productId = :pid', { pid: productId });
    const batches = await qb.getMany();

    const now = new Date();
    const in30 = new Date(now.getTime() + 30 * 86_400_000);
    const in7 = new Date(now.getTime() + 7 * 86_400_000);

    let totalQty = 0;
    let totalValue = 0;
    let expired = 0;
    let critical = 0;
    let expiringSoon = 0;
    let active = 0;

    for (const b of batches) {
      const qty = b.qtyRemaining;
      const cost = Number(b.unitCost);
      totalQty += qty;
      totalValue += qty * cost;

      if (b.expDate === null) {
        active += 1;
      } else if (b.expDate < now) {
        expired += 1;
      } else if (b.expDate <= in7) {
        critical += 1;
      } else if (b.expDate <= in30) {
        expiringSoon += 1;
      } else {
        active += 1;
      }
    }

    return {
      totalBatches: batches.length,
      totalQty,
      totalValue,
      breakdown: { active, expiringSoon, critical, expired },
    };
  }

  /**
   * Trả về tất cả batch của 1 product (kể cả depleted) — debug / audit dùng.
   */
  async findAllByProduct(productId: string) {
    return this.batchRepo.find({
      where: { productId, qtyRemaining: Not(IsNull() as any) },
      order: { expDate: 'ASC', createdAt: 'ASC' },
    });
  }

  /**
   * MIGRATION: Tạo legacy batch cho mỗi product có quantityAvailable > 0 mà
   * chưa có batch nào. Idempotent — chạy nhiều lần vẫn an toàn.
   *
   *  - Batch code: "LEGACY-{productId-prefix6}"
   *  - mfgDate: null (không biết)
   *  - expDate: product.expiredAt (nếu có), null nếu không
   *  - qtyReceived = qtyRemaining = product.quantityAvailable
   *  - unitCost: product.avgCost || product.costPrice || 0
   *
   * Trả về số product đã tạo legacy batch.
   */
  async backfillLegacyBatches(): Promise<{ created: number; skipped: number; totalProducts: number }> {
    const products = await this.batchRepo.manager.find(ProductEntity, {
      where: [], // all
    });

    let created = 0;
    let skipped = 0;

    for (const p of products) {
      if (p.quantityAvailable <= 0) {
        skipped += 1;
        continue;
      }
      const existing = await this.batchRepo.count({ where: { productId: p.productId } });
      if (existing > 0) {
        skipped += 1;
        continue;
      }

      const unitCost = Number(p.avgCost ?? p.costPrice ?? 0);
      await this.batchRepo.manager.transaction(async (em) => {
        await this.createInTx(em, {
          productId: p.productId,
          grId: null,
          batchCode: `LEGACY-${p.productId.slice(0, 6)}`,
          mfgDate: null,
          expDate: p.expiredAt ?? null,
          qtyReceived: p.quantityAvailable,
          unitCost,
          note: 'Legacy batch — auto-tạo bởi backfill cho stock có sẵn trước khi bật FIFO tracking',
        });
      });
      created += 1;
    }

    return { created, skipped, totalProducts: products.length };
  }
}
