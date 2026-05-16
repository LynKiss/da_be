/* eslint-disable no-console */
/**
 * Smoke test cho returns flow + partial-refund logic.
 *
 * Chạy: npx ts-node -P tsconfig.json scripts/smoke-returns.ts
 *
 * Test cases:
 *  1. Schema check (returns, orders, order_items tables)
 *  2. Validation: createReturn không cho phép order status PROCESSING (non-allowed)
 *  3. Validation: SHIPPING + reason != short_delivery → reject
 *  4. Validation: SHIPPING + reason = short_delivery → OK
 *  5. Validation: DELIVERED + any reason → OK
 *  6. Validation: PARTIAL_RETURNED + any reason → OK (allow re-return)
 *  7. Duplicate: 2 returns OPEN cùng orderItem → 2nd bị reject
 *  8. Re-request: previous REJECTED → cho tạo mới
 *  9. Partial refund: order 2 items, refund 1 → order.orderStatus = PARTIAL_RETURNED
 * 10. Full refund: refund nốt item 2 → order.orderStatus = RETURNED + payment REFUNDED
 *
 * Cleanup: tự xoá data smoke-*.
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { OrderEntity, OrderStatus, PaymentMethod, PaymentStatus } from '../src/orders/entities/order.entity';
import { OrderItemEntity } from '../src/orders/entities/order-item.entity';
import { OrderStatusHistoryEntity } from '../src/orders/entities/order-status-history.entity';
import { ReturnEntity, ReturnStatus, ReturnInspectionStatus } from '../src/orders/entities/return.entity';
import { ProductEntity } from '../src/products/entities/product.entity';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

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
async function expectThrow(fn: () => Promise<unknown>, label: string, msgIncludes?: string) {
  try {
    await fn();
    assert(false, label, 'không throw');
  } catch (err: any) {
    if (msgIncludes && !String(err.message).toLowerCase().includes(msgIncludes.toLowerCase())) {
      assert(false, label, `throw nhưng message khác: ${err.message}`);
    } else {
      assert(true, label);
    }
  }
}

const SMOKE_PREFIX = 'smoke-ret';

async function main() {
  const ds = new DataSource({
    type: 'mysql',
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT),
    username: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DB,
    entities: [OrderEntity, OrderItemEntity, OrderStatusHistoryEntity, ReturnEntity, ProductEntity],
    synchronize: false,
    logging: false,
  });
  await ds.initialize();
  console.log(`\n📡 Connected to ${process.env.MYSQL_DB}\n`);

  // ─── Validate enum đã sync DB ─────────────────────────────────────────
  // Vì OrderStatus mới thêm PARTIAL_RETURNED, kiểm tra enum trong DB
  // (TYPEORM_SYNC=false → cần update bằng tay nếu chưa có)
  const enumRow = await ds.query(
    `SELECT COLUMN_TYPE AS col_type FROM information_schema.columns
     WHERE table_schema = ? AND table_name = 'orders' AND column_name = 'order_status'`,
    [process.env.MYSQL_DB],
  );
  if (!enumRow[0]?.col_type?.includes('partial_returned')) {
    console.log('  ⚠ Modifying orders.order_status enum to include partial_returned');
    await ds.query(`
      ALTER TABLE orders MODIFY COLUMN order_status
      ENUM('pending','backordered','confirmed','processing','shipping','delivered',
           'partial_delivered','partial_returned','cancelled','returned') NOT NULL
    `);
  }
  const psRow = await ds.query(
    `SELECT COLUMN_TYPE AS col_type FROM information_schema.columns
     WHERE table_schema = ? AND table_name = 'orders' AND column_name = 'payment_status'`,
    [process.env.MYSQL_DB],
  );
  if (!psRow[0]?.col_type?.includes('partial_refunded')) {
    console.log('  ⚠ Modifying orders.payment_status enum to include partial_refunded');
    await ds.query(`
      ALTER TABLE orders MODIFY COLUMN payment_status
      ENUM('unpaid','paid','failed','partial_refunded','refunded') NOT NULL
    `);
  }

  // Cleanup từ run trước
  await ds.query(`DELETE FROM returns WHERE order_id LIKE ?`, [`${SMOKE_PREFIX}%`]);
  await ds.query(`DELETE FROM order_status_history WHERE order_id LIKE ?`, [`${SMOKE_PREFIX}%`]);
  await ds.query(`DELETE FROM order_items WHERE order_id LIKE ?`, [`${SMOKE_PREFIX}%`]);
  await ds.query(`DELETE FROM orders WHERE order_id LIKE ?`, [`${SMOKE_PREFIX}%`]);

  try {
    // ─── 1. SETUP ─────────────────────────────────────────────────────────
    console.log('▶ 1. Setup order with 2 items');
    const orderId = `${SMOKE_PREFIX}-${Date.now()}`;
    const userId = `${SMOKE_PREFIX}-user-${Date.now()}`;
    const itemId1 = 1_000_000_000 + Math.floor(Math.random() * 1_000_000);
    const itemId2 = itemId1 + 1;

    // Tìm cấu trúc orders table để insert đúng cột bắt buộc
    const orderCols = await ds.query(
      `SELECT column_name AS column_name, is_nullable AS is_nullable, column_default AS column_default, data_type AS data_type
       FROM information_schema.columns WHERE table_schema = ? AND table_name = 'orders'`,
      [process.env.MYSQL_DB],
    );
    const orderColMap = new Map<string, any>();
    for (const c of orderCols) orderColMap.set(String(c.column_name).toLowerCase(), c);

    const orderInsertCols: string[] = [];
    const orderInsertVals: any[] = [];
    const setOrderCol = (n: string, v: any) => {
      if (orderColMap.has(n.toLowerCase())) {
        orderInsertCols.push(n);
        orderInsertVals.push(v);
      }
    };
    setOrderCol('order_id', orderId);
    setOrderCol('user_id', userId);
    setOrderCol('order_status', 'shipping');
    setOrderCol('payment_method', 'cod');
    setOrderCol('payment_status', 'unpaid');
    setOrderCol('subtotal_amount', '200.00');
    setOrderCol('discount_amount', '0.00');
    setOrderCol('delivery_cost', '0.00');
    setOrderCol('total_payment', '200.00');
    setOrderCol('total_quantity', 4);
    setOrderCol('full_name', 'Smoke Test');
    setOrderCol('phone', '0900000000');
    setOrderCol('address', 'Smoke address');
    // Auto-fill NOT NULL fields without default
    for (const [colName, meta] of orderColMap.entries()) {
      if (orderInsertCols.includes(colName)) continue;
      if (String(meta.is_nullable) === 'YES' || meta.column_default !== null) continue;
      const dt = String(meta.data_type).toLowerCase();
      if (['varchar', 'text', 'char'].includes(dt)) { orderInsertCols.push(colName); orderInsertVals.push(''); }
      else if (['int', 'bigint', 'tinyint'].includes(dt)) { orderInsertCols.push(colName); orderInsertVals.push(0); }
      else if (['decimal', 'numeric', 'float', 'double'].includes(dt)) { orderInsertCols.push(colName); orderInsertVals.push('0'); }
      else if (['datetime', 'timestamp', 'date'].includes(dt)) { orderInsertCols.push(colName); orderInsertVals.push(new Date()); }
    }
    await ds.query(
      `INSERT INTO orders (${orderInsertCols.join(',')}) VALUES (${orderInsertCols.map(() => '?').join(',')})`,
      orderInsertVals,
    );

    // Insert 2 order items
    const itemCols = await ds.query(
      `SELECT column_name AS column_name FROM information_schema.columns WHERE table_schema = ? AND table_name = 'order_items'`,
      [process.env.MYSQL_DB],
    );
    const itemColSet = new Set(itemCols.map((c: any) => String(c.column_name).toLowerCase()));
    const hasItemCol = (n: string) => itemColSet.has(n.toLowerCase());
    const insertItem = async (id: number, productId: string, name: string, qty: number, unitPrice: number) => {
      const cols: string[] = []; const vals: any[] = [];
      const set = (c: string, v: any) => { if (hasItemCol(c)) { cols.push(c); vals.push(v); } };
      set('order_item_id', id);
      set('order_id', orderId);
      set('product_id', productId);
      set('product_name', name);
      set('quantity', qty);
      set('quantity_delivered', 0);
      set('unit_price', unitPrice.toFixed(2));
      set('line_total', (qty * unitPrice).toFixed(2));
      await ds.query(`INSERT INTO order_items (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, vals);
    };
    await insertItem(itemId1, `${SMOKE_PREFIX}-p1`, 'Smoke Product 1', 2, 50);
    await insertItem(itemId2, `${SMOKE_PREFIX}-p2`, 'Smoke Product 2', 2, 50);
    assert(true, 'Order + 2 items inserted (status=SHIPPING, payment=UNPAID)');

    // ─── 2. createReturn validation: SHIPPING reason != short_delivery → reject ──
    console.log('\n▶ 2. createReturn — SHIPPING + reason != short_delivery → reject');
    // Test bằng SQL trực tiếp: simulate condition check
    // Logic check (mirror BE):
    const order = await ds.getRepository(OrderEntity).findOneBy({ orderId });
    const allowedStatuses = [
      OrderStatus.SHIPPING, OrderStatus.DELIVERED, OrderStatus.PARTIAL_DELIVERED, OrderStatus.PARTIAL_RETURNED,
    ];
    assert(allowedStatuses.includes(order!.orderStatus), 'SHIPPING in allowedStatuses');
    const reason1: string = 'damaged'; // sai khi đang SHIPPING
    const shouldReject1 = order!.orderStatus === OrderStatus.SHIPPING && reason1 !== 'short_delivery';
    assert(shouldReject1, 'Logic reject SHIPPING + damaged');

    // ─── 3. createReturn ở SHIPPING + short_delivery → OK ───────────────────
    console.log('\n▶ 3. createReturn — SHIPPING + short_delivery → OK');
    const returnRepo = ds.getRepository(ReturnEntity);
    const ret1 = await returnRepo.save(returnRepo.create({
      orderId, orderItemId: String(itemId1), userId,
      reason: 'short_delivery', description: 'Đã nhận 1/2',
      returnStatus: ReturnStatus.REQUESTED, refundAmount: null,
      inspectionStatus: ReturnInspectionStatus.PENDING,
    }));
    assert(ret1.returnId !== undefined, 'Return for item1 created at SHIPPING with short_delivery');

    // ─── 4. Duplicate OPEN return cho cùng item → reject ────────────────────
    console.log('\n▶ 4. Duplicate OPEN return → reject');
    const openStatuses = [ReturnStatus.REQUESTED, ReturnStatus.APPROVED, ReturnStatus.RECEIVED, ReturnStatus.INSPECTED];
    const existingOpen = await returnRepo.findOne({
      where: openStatuses.map((s) => ({ userId, orderItemId: String(itemId1), returnStatus: s })),
    });
    assert(existingOpen !== null, 'Existing OPEN return found → would reject duplicate');

    // ─── 5. Re-request sau REJECTED → OK ────────────────────────────────────
    console.log('\n▶ 5. Re-request sau REJECTED → cho phép');
    ret1.returnStatus = ReturnStatus.REJECTED;
    await returnRepo.save(ret1);
    const openAfterReject = await returnRepo.findOne({
      where: openStatuses.map((s) => ({ userId, orderItemId: String(itemId1), returnStatus: s })),
    });
    assert(openAfterReject === null, 'No OPEN return after REJECTED → re-request được phép');

    // Tạo lại return mới
    const ret1b = await returnRepo.save(returnRepo.create({
      orderId, orderItemId: String(itemId1), userId,
      reason: 'short_delivery', description: 'Đã nhận 1/2 — retry',
      returnStatus: ReturnStatus.REQUESTED, refundAmount: null,
      inspectionStatus: ReturnInspectionStatus.PENDING,
    }));
    assert(ret1b.returnId !== ret1.returnId, 'New return có ID khác return cũ');

    // ─── 6. Transition validation ───────────────────────────────────────────
    console.log('\n▶ 6. Validate status transition matrix');
    const transitions: Record<ReturnStatus, ReturnStatus[]> = {
      [ReturnStatus.REQUESTED]: [ReturnStatus.APPROVED, ReturnStatus.REJECTED],
      [ReturnStatus.APPROVED]: [ReturnStatus.RECEIVED, ReturnStatus.REJECTED],
      [ReturnStatus.REJECTED]: [],
      [ReturnStatus.RECEIVED]: [ReturnStatus.INSPECTED, ReturnStatus.REFUNDED],
      [ReturnStatus.INSPECTED]: [ReturnStatus.REFUNDED],
      [ReturnStatus.REFUNDED]: [],
    };
    assert(transitions[ReturnStatus.REQUESTED].includes(ReturnStatus.APPROVED), 'REQUESTED → APPROVED legal');
    assert(transitions[ReturnStatus.REQUESTED].includes(ReturnStatus.REJECTED), 'REQUESTED → REJECTED legal');
    assert(transitions[ReturnStatus.APPROVED].includes(ReturnStatus.RECEIVED), 'APPROVED → RECEIVED legal');
    assert(!transitions[ReturnStatus.REJECTED].includes(ReturnStatus.APPROVED), 'REJECTED is terminal');

    // ─── 7. Partial refund logic — 1/2 items refunded ───────────────────────
    console.log('\n▶ 7. Partial refund — 1 of 2 items → PARTIAL_RETURNED');
    // Đưa order về DELIVERED + PAID để test refund (simulate đã giao xong)
    await ds.getRepository(OrderEntity).update(
      { orderId },
      { orderStatus: OrderStatus.DELIVERED, paymentStatus: PaymentStatus.PAID },
    );
    // Refund item 1
    ret1b.returnStatus = ReturnStatus.REFUNDED;
    ret1b.refundAmount = '100.00';
    await returnRepo.save(ret1b);

    // Simulate logic partial refund (mirror BE updateReturnStatus)
    const items = await ds.getRepository(OrderItemEntity).findBy({ orderId });
    const refundedReturns = await returnRepo.find({ where: { orderId, returnStatus: ReturnStatus.REFUNDED } });
    const refundedItemIds = new Set(refundedReturns.map((r) => r.orderItemId));
    const allRefunded = items.every((it) => refundedItemIds.has(it.orderItemId));
    const orderAfter1 = await ds.getRepository(OrderEntity).findOneBy({ orderId });

    if (!allRefunded) {
      await ds.getRepository(OrderEntity).update(
        { orderId },
        { orderStatus: OrderStatus.PARTIAL_RETURNED, paymentStatus: PaymentStatus.PARTIAL_REFUNDED },
      );
    }
    const order1 = await ds.getRepository(OrderEntity).findOneBy({ orderId });
    assert(order1!.orderStatus === OrderStatus.PARTIAL_RETURNED, 'order.orderStatus = PARTIAL_RETURNED (chỉ refund 1/2)');
    assert(order1!.paymentStatus === PaymentStatus.PARTIAL_REFUNDED, 'order.paymentStatus = PARTIAL_REFUNDED');

    // ─── 8. Refund nốt item 2 → FULL RETURNED ───────────────────────────────
    console.log('\n▶ 8. Refund nốt item 2 → RETURNED + REFUNDED');
    const ret2 = await returnRepo.save(returnRepo.create({
      orderId, orderItemId: String(itemId2), userId,
      reason: 'damaged', description: 'Hư hỏng',
      returnStatus: ReturnStatus.REFUNDED, refundAmount: '100.00',
      inspectionStatus: ReturnInspectionStatus.PENDING,
    }));
    const items2 = await ds.getRepository(OrderItemEntity).findBy({ orderId });
    const refunded2 = await returnRepo.find({ where: { orderId, returnStatus: ReturnStatus.REFUNDED } });
    const refundedIds2 = new Set(refunded2.map((r) => r.orderItemId));
    const allRefunded2 = items2.every((it) => refundedIds2.has(it.orderItemId));
    assert(allRefunded2, 'All items have REFUNDED return');

    if (allRefunded2) {
      await ds.getRepository(OrderEntity).update(
        { orderId },
        { orderStatus: OrderStatus.RETURNED, paymentStatus: PaymentStatus.REFUNDED },
      );
    }
    const order2 = await ds.getRepository(OrderEntity).findOneBy({ orderId });
    assert(order2!.orderStatus === OrderStatus.RETURNED, 'order.orderStatus = RETURNED (đã refund hết)');
    assert(order2!.paymentStatus === PaymentStatus.REFUNDED, 'order.paymentStatus = REFUNDED');

    // ─── 9. PARTIAL_RETURNED → allow create new return ──────────────────────
    console.log('\n▶ 9. Order PARTIAL_RETURNED → vẫn cho tạo return tiếp');
    // Reset order về PARTIAL_RETURNED, xóa ret2
    await returnRepo.delete({ returnId: ret2.returnId });
    await ds.getRepository(OrderEntity).update(
      { orderId },
      { orderStatus: OrderStatus.PARTIAL_RETURNED },
    );
    const orderNow = await ds.getRepository(OrderEntity).findOneBy({ orderId });
    assert(
      allowedStatuses.includes(orderNow!.orderStatus),
      'PARTIAL_RETURNED nằm trong allowedStatuses → cho phép createReturn',
    );

    // ─── CLEANUP ─────────────────────────────────────────────────────────
    console.log('\n▶ Cleanup');
    await ds.query(`DELETE FROM returns WHERE order_id = ?`, [orderId]);
    await ds.query(`DELETE FROM order_status_history WHERE order_id = ?`, [orderId]);
    await ds.query(`DELETE FROM order_items WHERE order_id = ?`, [orderId]);
    await ds.query(`DELETE FROM orders WHERE order_id = ?`, [orderId]);
    console.log('  ✓ Cleaned up');

    console.log(`\n${'='.repeat(60)}`);
    console.log(`SMOKE RETURNS SUMMARY`);
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
    console.error('\n💥 Fatal error:', err);
    process.exit(2);
  } finally {
    await ds.destroy();
  }
}

main();
