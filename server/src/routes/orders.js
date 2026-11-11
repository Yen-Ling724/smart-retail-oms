import { Router } from 'express';
import { query, transaction } from '../db/index.js';
import { available, logMovement } from './inventory.js';
import { HttpError } from './products.js';

const router = Router();

export const ORDER_STATUS = {
  pending: '待確認',
  reserved: '已預留',
  shipped: '已出貨',
  completed: '已完成',
  cancelled: '已取消',
};

const MAX_ITEMS = 20;
const MAX_QTY = 99;

// ===== 共用：其他程式（示範資料）也會呼叫 =====

// 訂單編號：SO + 台灣日期 + 當天流水號，例如 SO20261111-003
async function nextOrderNo(tx) {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date()).replaceAll('-', '');
  const prefix = `SO${ymd}-`;
  const [{ n }] = await tx.query(
    `SELECT COALESCE(MAX(substring(order_no from ${prefix.length + 1})::int), 0) + 1 AS n FROM orders WHERE order_no LIKE $1`,
    [`${prefix}%`],
  );
  return `${prefix}${String(n).padStart(3, '0')}`;
}

function normalizePhone(phone) {
  return String(phone ?? '').replace(/[\s-]/g, '');
}

function readOrderInput(body) {
  const customer = body?.customer ?? {};
  const name = String(customer.name ?? '').trim();
  const phone = normalizePhone(customer.phone);
  const fulfillment = body?.fulfillment;
  const address = String(body?.delivery_address ?? '').trim();
  if (!name) throw new HttpError(400, '請填寫顧客姓名');
  if (name.length > 50) throw new HttpError(400, '顧客姓名最多 50 字');
  if (!/^0\d{8,9}$/.test(phone)) throw new HttpError(400, '電話格式不正確，例如 0912345678');
  if (!['pickup', 'delivery'].includes(fulfillment)) throw new HttpError(400, '請選擇取貨方式');
  if (fulfillment === 'delivery' && !address) throw new HttpError(400, '宅配請填寫收件地址');

  const items = Array.isArray(body?.items) ? body.items : [];
  if (!items.length) throw new HttpError(400, '購物車是空的');
  if (items.length > MAX_ITEMS) throw new HttpError(400, `一張訂單最多 ${MAX_ITEMS} 種商品`);
  const merged = new Map();
  for (const item of items) {
    const qty = Number(item?.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) throw new HttpError(400, `每項商品數量必須是 1～${MAX_QTY}`);
    merged.set(item.product_id, (merged.get(item.product_id) ?? 0) + qty);
  }
  return {
    customer: { name, phone },
    storeId: body?.store_id,
    fulfillment,
    address: fulfillment === 'delivery' ? address.slice(0, 200) : null,
    note: typeof body?.note === 'string' ? body.note.trim().slice(0, 200) || null : null,
    items: [...merged].map(([productId, qty]) => ({ productId, qty })),
  };
}

async function addHistory(tx, orderNo, status, note = null) {
  await tx.query('INSERT INTO order_status_history (order_no, status, note) VALUES ($1, $2, $3)', [orderNo, status, note]);
}

async function setStatus(tx, orderNo, status, note) {
  await tx.query('UPDATE orders SET status = $2, updated_at = now() WHERE order_no = $1', [orderNo, status]);
  await addHistory(tx, orderNo, status, note);
}

export async function createOrder(tx, input) {
  const data = readOrderInput(input);
  const [store] = await tx.query('SELECT store_id, name FROM stores WHERE store_id = $1', [data.storeId]);
  if (!store) throw new HttpError(400, '請選擇出貨門市');

  // 下單當下的售價
  const lines = [];
  for (const item of data.items) {
    const [p] = await tx.query(
      `SELECT p.product_id, p.name, p.is_active, pr.sale_price
       FROM products p LEFT JOIN product_prices pr ON pr.product_id = p.product_id AND pr.valid_to IS NULL
       WHERE p.product_id = $1`,
      [item.productId],
    );
    if (!p) throw new HttpError(400, `找不到商品 ${item.productId}`);
    if (!p.is_active) throw new HttpError(400, `「${p.name}」已停售，不能下單`);
    if (p.sale_price == null) throw new HttpError(400, `「${p.name}」沒有設定售價`);
    lines.push({ ...item, unitPrice: p.sale_price });
  }
  const total = lines.reduce((sum, l) => sum + l.qty * l.unitPrice, 0);

  // 同一支電話視為同一位顧客，名字以最新的為準
  const [customer] = await tx.query(
    `INSERT INTO customers (name, phone, address) VALUES ($1, $2, $3)
     ON CONFLICT (phone) DO UPDATE SET name = EXCLUDED.name, address = COALESCE(EXCLUDED.address, customers.address)
     RETURNING id`,
    [data.customer.name, data.customer.phone, data.address],
  );

  const orderNo = await nextOrderNo(tx);
  await tx.query(
    `INSERT INTO orders (order_no, customer_id, store_id, fulfillment, delivery_address, status, total, note)
     VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7)`,
    [orderNo, customer.id, data.storeId, data.fulfillment, data.address, total, data.note],
  );
  for (const l of lines) {
    await tx.query('INSERT INTO order_items (order_no, product_id, qty, unit_price) VALUES ($1, $2, $3, $4)', [
      orderNo, l.productId, l.qty, l.unitPrice,
    ]);
  }
  await addHistory(tx, orderNo, 'pending', '建立訂單');
  return orderNo;
}

async function lockOrder(tx, orderNo, allowed) {
  const [order] = await tx.query('SELECT * FROM orders WHERE order_no = $1 FOR UPDATE', [orderNo]);
  if (!order) throw new HttpError(404, '找不到這張訂單');
  if (!allowed.includes(order.status)) {
    throw new HttpError(409, `訂單目前是「${ORDER_STATUS[order.status]}」，不能執行這個動作`);
  }
  const items = await tx.query(
    `SELECT oi.product_id, oi.qty, p.name FROM order_items oi JOIN products p ON p.product_id = oi.product_id
     WHERE oi.order_no = $1 ORDER BY oi.product_id`,
    [orderNo],
  );
  return { order, items };
}

// 確認訂單：預留庫存。用「可售夠才加預留」的條件式更新，任何一項不夠就整張訂單回復原狀（防超賣）
export async function confirmOrder(tx, orderNo) {
  const { order, items } = await lockOrder(tx, orderNo, ['pending']);
  for (const item of items) {
    const [before] = await tx.query(
      'SELECT on_hand, reserved, display, damaged FROM inventory WHERE store_id = $1 AND product_id = $2 FOR UPDATE',
      [order.store_id, item.product_id],
    );
    const [after] = await tx.query(
      `UPDATE inventory SET reserved = reserved + $3
       WHERE store_id = $1 AND product_id = $2 AND (on_hand - reserved - display - damaged) >= $3
       RETURNING on_hand, reserved, display, damaged`,
      [order.store_id, item.product_id, item.qty],
    );
    if (!after) {
      const [store] = await tx.query('SELECT name FROM stores WHERE store_id = $1', [order.store_id]);
      const left = before ? available(before) : 0;
      throw new HttpError(409, `庫存不足：「${item.name}」在${store.name}可售只剩 ${left} 件，訂單需要 ${item.qty} 件。整張訂單沒有預留，可以改數量、換門市或先調貨。`);
    }
    await logMovement(tx, {
      storeId: order.store_id, productId: item.product_id, type: 'order_reserve', qty: item.qty,
      before, after, note: `訂單 ${orderNo} 預留`, orderNo,
    });
  }
  await setStatus(tx, orderNo, 'reserved', '確認訂單，已預留庫存');
}

// 出貨／取貨：扣實體庫存，同時扣掉預留
export async function shipOrder(tx, orderNo) {
  const { order, items } = await lockOrder(tx, orderNo, ['reserved']);
  for (const item of items) {
    const [before] = await tx.query(
      'SELECT on_hand, reserved, display, damaged FROM inventory WHERE store_id = $1 AND product_id = $2 FOR UPDATE',
      [order.store_id, item.product_id],
    );
    const [after] = await tx.query(
      `UPDATE inventory SET on_hand = on_hand - $3, reserved = reserved - $3
       WHERE store_id = $1 AND product_id = $2 AND reserved >= $3 AND on_hand >= $3
       RETURNING on_hand, reserved, display, damaged`,
      [order.store_id, item.product_id, item.qty],
    );
    if (!after) throw new HttpError(409, `「${item.name}」的預留數量不一致，無法出貨，請先檢查庫存`);
    await logMovement(tx, {
      storeId: order.store_id, productId: item.product_id, type: 'order_ship', qty: item.qty,
      before, after, note: `訂單 ${orderNo} ${order.fulfillment === 'pickup' ? '取貨' : '出貨'}`, orderNo,
    });
  }
  await setStatus(tx, orderNo, 'shipped', order.fulfillment === 'pickup' ? '顧客已到店取貨' : '已出貨');
}

export async function completeOrder(tx, orderNo) {
  await lockOrder(tx, orderNo, ['shipped']);
  await setStatus(tx, orderNo, 'completed', '訂單完成');
}

// 取消：已預留的要把預留還回去
export async function cancelOrder(tx, orderNo, reason) {
  const { order, items } = await lockOrder(tx, orderNo, ['pending', 'reserved']);
  if (order.status === 'reserved') {
    for (const item of items) {
      const [before] = await tx.query(
        'SELECT on_hand, reserved, display, damaged FROM inventory WHERE store_id = $1 AND product_id = $2 FOR UPDATE',
        [order.store_id, item.product_id],
      );
      const [after] = await tx.query(
        `UPDATE inventory SET reserved = GREATEST(reserved - $3, 0) WHERE store_id = $1 AND product_id = $2
         RETURNING on_hand, reserved, display, damaged`,
        [order.store_id, item.product_id, item.qty],
      );
      await logMovement(tx, {
        storeId: order.store_id, productId: item.product_id, type: 'order_release', qty: item.qty,
        before, after, note: `訂單 ${orderNo} 取消，釋放預留`, orderNo,
      });
    }
  }
  await setStatus(tx, orderNo, 'cancelled', reason ? `取消：${reason}` : '取消訂單');
}

// ===== API =====

const ORDER_LIST_SQL = `
  SELECT o.order_no, o.status, o.fulfillment, o.total, o.created_at, o.updated_at, o.store_id, s.name AS store_name,
         c.name AS customer_name, c.phone AS customer_phone,
         (SELECT COALESCE(SUM(qty), 0)::int FROM order_items oi WHERE oi.order_no = o.order_no) AS item_count,
         (SELECT p.name FROM order_items oi JOIN products p ON p.product_id = oi.product_id
          WHERE oi.order_no = o.order_no ORDER BY oi.id LIMIT 1) AS first_item
  FROM orders o JOIN customers c ON c.id = o.customer_id JOIN stores s ON s.store_id = o.store_id
`;

router.get('/orders', async (req, res) => {
  const { status = '', store = '', q = '' } = req.query;
  const where = [];
  const params = [];
  if (status === 'open') where.push(`o.status IN ('pending', 'reserved', 'shipped')`);
  else if (status) {
    params.push(status);
    where.push(`o.status = $${params.length}`);
  }
  if (store) {
    params.push(store);
    where.push(`o.store_id = $${params.length}`);
  }
  if (q.trim()) {
    params.push(`%${q.trim().replace(/[\s-]/g, '')}%`);
    where.push(`(o.order_no ILIKE $${params.length} OR c.name ILIKE $${params.length} OR c.phone ILIKE $${params.length})`);
  }
  const orders = await query(
    `${ORDER_LIST_SQL} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY o.created_at DESC, o.order_no DESC LIMIT 200`,
    params,
  );
  const counts = await query('SELECT status, count(*)::int AS count FROM orders GROUP BY status');
  res.json({ ok: true, orders, counts: Object.fromEntries(counts.map((c) => [c.status, c.count])) });
});

async function loadOrder(orderNo) {
  const [order] = await query(
    `SELECT o.*, s.name AS store_name, c.name AS customer_name, c.phone AS customer_phone
     FROM orders o JOIN customers c ON c.id = o.customer_id JOIN stores s ON s.store_id = o.store_id
     WHERE o.order_no = $1`,
    [orderNo],
  );
  if (!order) throw new HttpError(404, '找不到這張訂單');
  const items = await query(
    `SELECT oi.product_id, p.name, p.model, p.brand, oi.qty, oi.unit_price, oi.qty * oi.unit_price AS subtotal,
            (i.on_hand - i.reserved - i.display - i.damaged) AS store_available
     FROM order_items oi JOIN products p ON p.product_id = oi.product_id
     LEFT JOIN inventory i ON i.product_id = oi.product_id AND i.store_id = $2
     WHERE oi.order_no = $1 ORDER BY oi.id`,
    [orderNo, order.store_id],
  );
  const history = await query(
    'SELECT status, note, created_at FROM order_status_history WHERE order_no = $1 ORDER BY created_at, id',
    [orderNo],
  );
  return { ...order, items, history };
}

router.get('/orders/:no', async (req, res) => {
  res.json({ ok: true, order: await loadOrder(req.params.no) });
});

router.post('/orders', async (req, res) => {
  const orderNo = await transaction((tx) => createOrder(tx, req.body ?? {}));
  let reserveError = null;
  // 勾選「建立後立即預留」：預留失敗不影響訂單本身，訂單留在「待確認」
  if (req.body?.reserve_now) {
    try {
      await transaction((tx) => confirmOrder(tx, orderNo));
    } catch (err) {
      if (!(err instanceof HttpError)) throw err;
      reserveError = err.message;
    }
  }
  res.status(201).json({ ok: true, order: await loadOrder(orderNo), reserve_error: reserveError });
});

const ACTIONS = {
  confirm: { run: confirmOrder, message: '已確認訂單並預留庫存' },
  ship: { run: shipOrder, message: '已出貨，庫存已扣除' },
  complete: { run: completeOrder, message: '訂單已完成' },
  cancel: { run: (tx, no, body) => cancelOrder(tx, no, String(body?.reason ?? '').trim().slice(0, 100)), message: '訂單已取消' },
};

router.post('/orders/:no/:action', async (req, res) => {
  const action = ACTIONS[req.params.action];
  if (!action) throw new HttpError(404, '找不到這個 API');
  await transaction((tx) => action.run(tx, req.params.no, req.body ?? {}));
  res.json({ ok: true, message: action.message, order: await loadOrder(req.params.no) });
});

export default router;
