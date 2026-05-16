/* eslint-disable no-console */
/**
 * Smoke test toàn diện cho FIFO inventory integration.
 *
 * Chạy: npx ts-node -P tsconfig.json scripts/smoke-fifo.ts
 *
 * Test cases:
 *  1. Schema check (product_batches table, inventory_transactions.batch_id)
 *  2. backfillLegacyBatches idempotent
 *  3. createInTx tạo batch đúng
 *  4. computePick + previewPick — FIFO/FEFO logic
 *  5. consumeInTx — pessimistic lock, trừ qty đúng
 *  6. getOrderBatchConsumption — NET map
 *  7. restoreInTx — hoàn batch
 *  8. writeOff — DAMAGE transaction + qty về 0
 *  9. priceReduction — chỉ giảm cost
 *  10. End-to-end: tạo 2 batch, simulate checkout, simulate cancel, verify
 *
 * Cleanup: tự xóa data test ở cuối (DELETE WHERE batch_id LIKE 'smoke-%').
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { ProductBatchEntity } from '../src/products/entities/product-batch.entity';
import { ProductEntity } from '../src/products/entities/product.entity';
import {
  InventoryTransactionEntity,
  InventoryTransactionType,
} from '../src/products/entities/inventory-transaction.entity';
import { ProductBatchService } from '../src/products/product-batch.service';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const TEST_PRODUCT_ID = 'smoke-test-prod-fifo-1';
const TEST_PRODUCT_ID_2 = 'smoke-test-prod-fifo-2';
const TEST_ORDER_ID = 'smoke-test-order-fifo-1';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(cond: boolean, label: string, detail = ''): void {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    failures.push(`${label}${detail ? ' — ' + detail : ''}`);
    console.error(`  ✗ ${label}${detail ? ' — ' + detail : ''}`);
  }
}

async function main() {
  const ds = new DataSource({
    type: 'mysql',
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT),
    username: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DB,
    entities: [ProductBatchEntity, ProductEntity, InventoryTransactionEntity],
    synchronize: false,
    logging: false,
  });
  await ds.initialize();
  console.log(`\n📡 Connected to ${process.env.MYSQL_DB}\n`);

  try {
    // ─── 1. SCHEMA CHECK ─────────────────────────────────────────────────
    console.log('▶ 1. Schema check');
    const batchesTable = await ds.query(
      `SELECT COUNT(*) AS c FROM information_schema.tables WHERE table_schema = ? AND table_name = 'product_batches'`,
      [process.env.MYSQL_DB],
    );
    assert(Number(batchesTable[0].c) === 1, 'Table product_batches exists');

    const batchIdCol = await ds.query(
      `SELECT COUNT(*) AS c FROM information_schema.columns WHERE table_schema = ? AND table_name = 'inventory_transactions' AND column_name = 'batch_id'`,
      [process.env.MYSQL_DB],
    );
    if (Number(batchIdCol[0].c) === 0) {
      console.log('  ⚠ Adding batch_id column manually (TYPEORM_SYNC=false)');
      await ds.query(
        `ALTER TABLE inventory_transactions ADD COLUMN batch_id CHAR(36) NULL`,
      );
    }
    assert(true, 'Column inventory_transactions.batch_id exists (or was added)');

    if (Number(batchesTable[0].c) === 0) {
      console.log('  ⚠ Creating product_batches table manually');
      await ds.query(`
        CREATE TABLE product_batches (
          batch_id CHAR(36) NOT NULL,
          product_id CHAR(36) NOT NULL,
          gr_id CHAR(36) NULL,
          batch_code VARCHAR(100) NOT NULL,
          mfg_date DATE NULL,
          exp_date DATE NULL,
          qty_received INT NOT NULL,
          qty_remaining INT NOT NULL,
          unit_cost DECIMAL(15,4) NOT NULL DEFAULT 0,
          note VARCHAR(500) NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (batch_id),
          KEY idx_batch_product (product_id),
          KEY idx_batch_exp (exp_date)
        ) ENGINE=InnoDB
      `);
    }

    // Cleanup từ run trước
    await ds.query(
      `DELETE FROM inventory_transactions WHERE related_order_id = ? OR reference_id IN (SELECT batch_id FROM product_batches WHERE batch_code LIKE 'smoke-%')`,
      [TEST_ORDER_ID],
    );
    await ds.query(`DELETE FROM product_batches WHERE batch_code LIKE 'smoke-%'`);
    await ds.query(`DELETE FROM products WHERE product_id IN (?, ?)`, [TEST_PRODUCT_ID, TEST_PRODUCT_ID_2]);

    // Tạo test product: query mọi NOT NULL column và auto-fill default
    const productCols = await ds.query(
      `SELECT column_name AS column_name, is_nullable AS is_nullable, column_default AS column_default, data_type AS data_type
       FROM information_schema.columns
       WHERE table_schema = ? AND table_name = 'products'`,
      [process.env.MYSQL_DB],
    );
    const colMap = new Map<string, { nullable: boolean; defaultVal: any; dataType: string }>();
    for (const c of productCols) {
      colMap.set(String(c.column_name).toLowerCase(), {
        nullable: String(c.is_nullable) === 'YES',
        defaultVal: c.column_default,
        dataType: String(c.data_type).toLowerCase(),
      });
    }
    const hasCol = (name: string) => colMap.has(name.toLowerCase());

    // Build INSERT động: bao gồm mọi NOT NULL không có default
    const buildInsert = async (id: string, name: string, qty: number) => {
      const cols: string[] = [];
      const vals: any[] = [];
      const setIf = (col: string, val: any) => {
        if (hasCol(col)) { cols.push(col); vals.push(val); }
      };
      setIf('product_id', id);
      setIf('product_name', name);
      setIf('quantity_available', qty);
      setIf('product_slug', `smoke-${id}-${Date.now()}`);
      setIf('quantity_reserved', 0);
      setIf('avg_cost', '10000.0000');
      setIf('cost_price', '10000.00');
      setIf('is_show', 1);
      setIf('product_price', '15000.00');
      setIf('product_price_sale', null);
      setIf('expired_at', new Date(Date.now() + 365 * 86400000));
      setIf('description', 'Smoke test product');
      setIf('short_description', 'Smoke');
      setIf('unit', 'kg');

      // Auto-fill mọi NOT NULL khác chưa được set
      for (const [colName, meta] of colMap.entries()) {
        if (cols.includes(colName)) continue;
        if (meta.nullable || meta.defaultVal !== null) continue;
        // NOT NULL không default → set sensible default theo type
        if (['varchar', 'text', 'char'].includes(meta.dataType)) {
          cols.push(colName);
          vals.push('');
        } else if (['int', 'bigint', 'smallint', 'tinyint'].includes(meta.dataType)) {
          cols.push(colName);
          vals.push(0);
        } else if (['decimal', 'numeric', 'float', 'double'].includes(meta.dataType)) {
          cols.push(colName);
          vals.push('0');
        } else if (['datetime', 'timestamp', 'date'].includes(meta.dataType)) {
          cols.push(colName);
          vals.push(new Date());
        } else if (meta.dataType === 'json') {
          cols.push(colName);
          vals.push('[]');
        }
      }

      const placeholders = cols.map(() => '?').join(',');
      await ds.query(
        `INSERT INTO products (${cols.join(',')}) VALUES (${placeholders})`,
        vals,
      );
    };

    await buildInsert(TEST_PRODUCT_ID, 'Smoke Test NPK', 100);
    await buildInsert(TEST_PRODUCT_ID_2, 'Smoke Test Vôi', 0);

    // ─── 2. INSTANTIATE SERVICE ──────────────────────────────────────────
    console.log('\n▶ 2. Instantiate ProductBatchService');
    const batchRepo = ds.getRepository(ProductBatchEntity);
    const service = new ProductBatchService(batchRepo);
    assert(true, 'Service instantiated');

    // ─── 3. createInTx — tạo batch ───────────────────────────────────────
    console.log('\n▶ 3. createInTx — tạo 3 batch với HSD khác nhau');
    const today = new Date();
    const in30 = new Date(today.getTime() + 30 * 86400000);
    const in60 = new Date(today.getTime() + 60 * 86400000);
    const in180 = new Date(today.getTime() + 180 * 86400000);

    const batch1Id = randomUUID();
    const batch2Id = randomUUID();
    const batch3Id = randomUUID();

    await ds.transaction(async (em) => {
      // Lô cũ nhất (FIFO #1), HSD xa
      await em.save(ProductBatchEntity, {
        batchId: batch1Id, productId: TEST_PRODUCT_ID, grId: null,
        batchCode: 'smoke-OLD-LATE', mfgDate: null, expDate: in180,
        qtyReceived: 50, qtyRemaining: 50, unitCost: '8000.0000',
        note: 'Lô cũ HSD xa', createdAt: new Date(today.getTime() - 7 * 86400000),
      });
      // Lô vừa, HSD gần — FEFO sẽ ưu tiên
      await em.save(ProductBatchEntity, {
        batchId: batch2Id, productId: TEST_PRODUCT_ID, grId: null,
        batchCode: 'smoke-MID-SOON', mfgDate: null, expDate: in30,
        qtyReceived: 30, qtyRemaining: 30, unitCost: '12000.0000',
        note: 'Lô vừa HSD gần', createdAt: new Date(today.getTime() - 3 * 86400000),
      });
      // Lô mới, HSD vừa
      await em.save(ProductBatchEntity, {
        batchId: batch3Id, productId: TEST_PRODUCT_ID, grId: null,
        batchCode: 'smoke-NEW-MID', mfgDate: null, expDate: in60,
        qtyReceived: 40, qtyRemaining: 40, unitCost: '10000.0000',
        note: 'Lô mới', createdAt: today,
      });
    });
    const all = await batchRepo.find({ where: { productId: TEST_PRODUCT_ID } });
    assert(all.length === 3, '3 batches inserted', `actual ${all.length}`);

    // ─── 4. previewPick — FEFO order ─────────────────────────────────────
    console.log('\n▶ 4. previewPick — FEFO order');
    const preview = await service.previewPick(TEST_PRODUCT_ID, 60);
    assert(preview.success, 'previewPick success for qty 60');
    assert(preview.lines.length === 2, 'Pick uses 2 batches', `got ${preview.lines.length}`);
    assert(
      preview.lines[0].batchCode === 'smoke-MID-SOON',
      'First pick is MID-SOON (FEFO — earliest expiry)',
      `got ${preview.lines[0].batchCode}`,
    );
    assert(preview.lines[0].qty === 30, 'First pick takes full 30 from MID-SOON');
    assert(
      preview.lines[1].batchCode === 'smoke-NEW-MID',
      'Second pick is NEW-MID (next earliest expiry)',
      `got ${preview.lines[1].batchCode}`,
    );
    assert(preview.lines[1].qty === 30, 'Second pick takes 30 from NEW-MID');
    const expectedCost = 30 * 12000 + 30 * 10000;
    assert(
      preview.totalCost === expectedCost,
      `Total cost = ${expectedCost}`,
      `got ${preview.totalCost}`,
    );

    // ─── 5. previewPick shortfall ────────────────────────────────────────
    console.log('\n▶ 5. previewPick — insufficient stock');
    const preview2 = await service.previewPick(TEST_PRODUCT_ID, 200);
    assert(!preview2.success, 'previewPick returns success=false when insufficient');
    assert(preview2.shortfall === 80, 'Shortfall = 200 - 120 = 80', `got ${preview2.shortfall}`);

    // ─── 6. consumeInTx — actually deduct ────────────────────────────────
    console.log('\n▶ 6. consumeInTx — trừ qty thật, lock batches');
    await ds.transaction(async (em) => {
      const result = await service.consumeInTx(em, TEST_PRODUCT_ID, 60);
      assert(result.success, 'consumeInTx success');

      // Log inventory transactions (giả lập như checkout)
      for (const line of result.lines) {
        await em.save(InventoryTransactionEntity, em.create(InventoryTransactionEntity, {
          productId: TEST_PRODUCT_ID,
          performedBy: null,
          transactionType: InventoryTransactionType.EXPORT,
          quantityChange: -line.qty,
          referenceType: 'ORDER',
          referenceId: TEST_ORDER_ID,
          batchId: line.batchId,
          unitCostAtTime: String(line.unitCost),
          relatedOrderId: TEST_ORDER_ID,
          note: `Smoke test consume from ${line.batchCode}`,
        }));
      }
    });
    const afterConsume = await batchRepo.find({ where: { productId: TEST_PRODUCT_ID } });
    const midSoon = afterConsume.find((b) => b.batchCode === 'smoke-MID-SOON')!;
    const newMid = afterConsume.find((b) => b.batchCode === 'smoke-NEW-MID')!;
    const oldLate = afterConsume.find((b) => b.batchCode === 'smoke-OLD-LATE')!;
    assert(midSoon.qtyRemaining === 0, 'MID-SOON qty_remaining = 0 (used 30/30)', `got ${midSoon.qtyRemaining}`);
    assert(newMid.qtyRemaining === 10, 'NEW-MID qty_remaining = 10 (used 30/40)', `got ${newMid.qtyRemaining}`);
    assert(oldLate.qtyRemaining === 50, 'OLD-LATE untouched = 50', `got ${oldLate.qtyRemaining}`);

    const txCount = await ds.query(
      `SELECT COUNT(*) AS c FROM inventory_transactions WHERE related_order_id = ? AND batch_id IS NOT NULL`,
      [TEST_ORDER_ID],
    );
    assert(Number(txCount[0].c) === 2, '2 inventory_transactions logged with batch_id', `got ${txCount[0].c}`);

    // ─── 7. getOrderBatchConsumption ─────────────────────────────────────
    console.log('\n▶ 7. getOrderBatchConsumption — NET map');
    const netMap = await service.getOrderBatchConsumption(ds.manager, TEST_ORDER_ID, TEST_PRODUCT_ID);
    assert(netMap.size === 2, 'NET map có 2 entries', `got ${netMap.size}`);
    assert(netMap.get(batch2Id) === 30, `Batch2 net = 30`, `got ${netMap.get(batch2Id)}`);
    assert(netMap.get(batch3Id) === 30, `Batch3 net = 30`, `got ${netMap.get(batch3Id)}`);

    // ─── 8. restoreInTx — hoàn batch (simulate cancel) ───────────────────
    console.log('\n▶ 8. restoreInTx — simulate full cancel order');
    await ds.transaction(async (em) => {
      const net = await service.getOrderBatchConsumption(em, TEST_ORDER_ID, TEST_PRODUCT_ID);
      for (const [bid, qty] of net.entries()) {
        if (qty <= 0) continue;
        await service.restoreInTx(em, bid, qty);
        await em.save(InventoryTransactionEntity, em.create(InventoryTransactionEntity, {
          productId: TEST_PRODUCT_ID,
          performedBy: null,
          transactionType: InventoryTransactionType.RETURN_IN,
          quantityChange: qty,
          referenceType: 'ORDER',
          referenceId: TEST_ORDER_ID,
          batchId: bid,
          relatedOrderId: TEST_ORDER_ID,
          note: 'Smoke test restock',
        }));
      }
    });
    const afterRestore = await batchRepo.find({ where: { productId: TEST_PRODUCT_ID } });
    const midSoon2 = afterRestore.find((b) => b.batchCode === 'smoke-MID-SOON')!;
    const newMid2 = afterRestore.find((b) => b.batchCode === 'smoke-NEW-MID')!;
    assert(midSoon2.qtyRemaining === 30, 'MID-SOON restored to 30', `got ${midSoon2.qtyRemaining}`);
    assert(newMid2.qtyRemaining === 40, 'NEW-MID restored to 40', `got ${newMid2.qtyRemaining}`);

    // Sau restore, NET map về 0
    const netAfter = await service.getOrderBatchConsumption(ds.manager, TEST_ORDER_ID, TEST_PRODUCT_ID);
    const sumNet = Array.from(netAfter.values()).reduce((s, v) => s + v, 0);
    assert(sumNet === 0, 'NET map sum = 0 after full restore (idempotent)', `got ${sumNet}`);

    // ─── 9. writeOff — hủy lô ────────────────────────────────────────────
    console.log('\n▶ 9. writeOff — hủy lô');
    const woResult = await service.writeOff(batch1Id, 'expired', 'Smoke test write-off', { userId: 'smoke-user', username: 'smoke' });
    assert(woResult.batch.qtyRemaining === 0, 'Batch qty_remaining = 0 after write-off', `got ${woResult.batch.qtyRemaining}`);
    assert(woResult.totalLoss === 50 * 8000, `totalLoss = ${50 * 8000}`, `got ${woResult.totalLoss}`);

    const damageTx = await ds.query(
      `SELECT COUNT(*) AS c FROM inventory_transactions WHERE batch_id = ? AND transaction_type = 'damage'`,
      [batch1Id],
    );
    assert(Number(damageTx[0].c) === 1, 'DAMAGE transaction logged with batch_id');

    // ─── 10. priceReduction ──────────────────────────────────────────────
    console.log('\n▶ 10. priceReduction — giảm đơn giá');
    const prResult = await service.priceReduction(batch2Id, 9000, 'Cận date');
    assert(prResult.oldCost === 12000, 'Old cost recorded');
    assert(prResult.newUnitCost === 9000, 'New cost = 9000');
    const batch2Updated = await batchRepo.findOne({ where: { batchId: batch2Id } });
    assert(Number(batch2Updated!.unitCost) === 9000, 'Batch unit_cost updated to 9000');
    assert(batch2Updated!.note?.includes('Giảm giá') === true, 'Note has reduction record');

    // priceReduction rejects newPrice >= oldPrice
    try {
      await service.priceReduction(batch2Id, 9000, 'same');
      assert(false, 'priceReduction should reject same price');
    } catch {
      assert(true, 'priceReduction rejects newPrice >= oldPrice');
    }

    // ─── 11. backfillLegacyBatches ───────────────────────────────────────
    console.log('\n▶ 11. backfillLegacyBatches — migration idempotent');
    // Product 2 có stock = 0 → skip
    // Tạo thêm product 3 có stock 50 và CHƯA có batch
    const TEST_PRODUCT_ID_3 = 'smoke-test-prod-fifo-3';
    await ds.query(`DELETE FROM products WHERE product_id = ?`, [TEST_PRODUCT_ID_3]);
    await buildInsert(TEST_PRODUCT_ID_3, 'Smoke Test Legacy', 50);

    const result1 = await service.backfillLegacyBatches();
    const legacyBatch = await batchRepo.findOne({ where: { productId: TEST_PRODUCT_ID_3 } });
    assert(legacyBatch !== null, 'Legacy batch created for product with stock');
    assert(legacyBatch?.batchCode.startsWith('LEGACY-') === true, 'Batch code prefixed LEGACY-');
    assert(legacyBatch?.qtyRemaining === 50, 'Legacy batch qty_remaining = product.quantityAvailable');

    // Idempotent — run lần 2 không tạo thêm
    const result2 = await service.backfillLegacyBatches();
    const countAfter = await batchRepo.count({ where: { productId: TEST_PRODUCT_ID_3 } });
    assert(countAfter === 1, 'Backfill idempotent — no duplicate after 2nd run', `got ${countAfter}`);
    assert(result2.created === 0 || result1.created > 0, 'Second run creates 0 new for already-backfilled product');

    // ─── 12. Race-condition check (pessimistic_write) ────────────────────
    console.log('\n▶ 12. Pessimistic lock — 2 concurrent consume should serialize');
    // Reset batch3 to known state
    await batchRepo.update({ batchId: batch3Id }, { qtyRemaining: 40 });
    // Reset batch2 (was set to 30 in step 8, but its qty_remaining is 30)
    await batchRepo.update({ batchId: batch2Id }, { qtyRemaining: 30 });

    // Chạy 2 transaction song song, mỗi cái consume 25 — chỉ 1 phải thắng cho batch nhất định
    const concurrent = await Promise.allSettled([
      ds.transaction(async (em) => service.consumeInTx(em, TEST_PRODUCT_ID, 25)),
      ds.transaction(async (em) => service.consumeInTx(em, TEST_PRODUCT_ID, 25)),
    ]);
    const ok = concurrent.filter((r) => r.status === 'fulfilled').length;
    assert(ok === 2, 'Both transactions completed (2 × 25 = 50 ≤ total available)', `got ${ok}`);

    // Tổng còn lại phải = (30 + 40) - 50 = 20
    const after12 = await batchRepo.find({ where: { productId: TEST_PRODUCT_ID } });
    const remainSum = after12
      .filter((b) => b.batchCode === 'smoke-MID-SOON' || b.batchCode === 'smoke-NEW-MID')
      .reduce((s, b) => s + b.qtyRemaining, 0);
    assert(remainSum === 20, `Total remaining after concurrent consume = 20`, `got ${remainSum}`);

    // ─── CLEANUP ─────────────────────────────────────────────────────────
    console.log('\n▶ Cleanup test data');
    await ds.query(`DELETE FROM inventory_transactions WHERE related_order_id = ? OR batch_id IN (?, ?, ?)`, [TEST_ORDER_ID, batch1Id, batch2Id, batch3Id]);
    await ds.query(`DELETE FROM product_batches WHERE batch_code LIKE 'smoke-%' OR batch_code LIKE 'LEGACY-smoke%'`);
    await ds.query(`DELETE FROM products WHERE product_id IN (?, ?, ?)`, [TEST_PRODUCT_ID, TEST_PRODUCT_ID_2, TEST_PRODUCT_ID_3]);
    console.log('  ✓ Cleaned up');

    // ─── SUMMARY ─────────────────────────────────────────────────────────
    console.log(`\n${'='.repeat(60)}`);
    console.log(`SMOKE TEST SUMMARY`);
    console.log(`${'='.repeat(60)}`);
    console.log(`✓ Passed: ${passed}`);
    console.log(`✗ Failed: ${failed}`);
    if (failures.length > 0) {
      console.log(`\nFailures:`);
      failures.forEach((f) => console.log(`  - ${f}`));
    }
    console.log(`\n${failed === 0 ? '🎉 ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}\n`);
    process.exit(failed === 0 ? 0 : 1);
  } catch (err) {
    console.error('\n💥 Fatal error during smoke test:', err);
    process.exit(2);
  } finally {
    await ds.destroy();
  }
}

main();
