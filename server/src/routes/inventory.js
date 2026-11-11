import { Router } from 'express';
import { query, transaction } from '../db/index.js';
import { HttpError } from './products.js';

const router = Router();

// 可售 = 實體 - 預留 - 展示 - 瑕疵（在途還沒到店，不算）
const available = (r) => r.on_hand - r.reserved - r.display - r.damaged;
const AVAILABLE_SQL = '(i.on_hand - i.reserved - i.display - i.damaged)';

// 門市人員可以手動做的庫存動作
export const ACTIONS = {
  receive: { label: '進貨入庫', hint: '實體庫存增加，可售跟著增加' },
  display_add: { label: '上展示機', hint: '從可售中撥出當展示機' },
  display_remove: { label: '撤展示機', hint: '展示機收回，變回可售' },
  damage: { label: '標記瑕疵', hint: '從可售中標記為瑕疵品' },
  scrap: { label: '瑕疵報廢', hint: '瑕疵品報廢，實體庫存減少' },
  count: { label: '盤點調整', hint: '輸入盤點後的實體數量' },
};

function apply(action, row, qty) {
  const next = { ...row };
  const avail = available(row);
  switch (action) {
    case 'receive':
      next.on_hand += qty;
      break;
    case 'display_add':
      if (qty > avail) throw new HttpError(400, `可售只剩 ${avail} 件，不能撥出 ${qty} 件當展示機`);
      next.display += qty;
      break;
    case 'display_remove':
      if (qty > row.display) throw new HttpError(400, `目前只有 ${row.display} 件展示機`);
      next.display -= qty;
      break;
    case 'damage':
      if (qty > avail) throw new HttpError(400, `可售只剩 ${avail} 件，不能標記 ${qty} 件瑕疵`);
      next.damaged += qty;
      break;
    case 'scrap':
      if (qty > row.damaged) throw new HttpError(400, `目前只有 ${row.damaged} 件瑕疵品可以報廢`);
      next.damaged -= qty;
      next.on_hand -= qty;
      break;
    case 'count': {
      const locked = row.reserved + row.display + row.damaged;
      if (qty < locked) {
        throw new HttpError(400, `盤點數量不能少於 ${locked}（預留 ${row.reserved}＋展示 ${row.display}＋瑕疵 ${row.damaged}）`);
      }
      next.on_hand = qty;
      break;
    }
    default:
      throw new HttpError(400, '請選擇庫存動作');
  }
  return next;
}

function readQty(value, { min = 1 } = {}) {
  const qty = Number(value);
  if (!Number.isInteger(qty) || qty < min || qty > 9999) throw new HttpError(400, `數量必須是 ${min}～9999 的整數`);
  return qty;
}

const cleanNote = (note) => (typeof note === 'string' ? note.trim().slice(0, 200) || null : null);

// 鎖住一列庫存（沒有就先建立 0 庫存），避免兩個人同時調整算錯
async function lockRow(tx, storeId, productId) {
  await tx.query('INSERT INTO inventory (store_id, product_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [storeId, productId]);
  const [row] = await tx.query(
    'SELECT on_hand, reserved, display, damaged, in_transit FROM inventory WHERE store_id = $1 AND product_id = $2 FOR UPDATE',
    [storeId, productId],
  );
  return row;
}

async function saveRow(tx, storeId, productId, row) {
  await tx.query(
    'UPDATE inventory SET on_hand = $3, display = $4, damaged = $5, in_transit = $6 WHERE store_id = $1 AND product_id = $2',
    [storeId, productId, row.on_hand, row.display, row.damaged, row.in_transit],
  );
}

async function logMovement(tx, { storeId, productId, type, qty, before, after, note = null, transferId = null }) {
  await tx.query(
    `INSERT INTO inventory_transactions (store_id, product_id, type, qty, qty_change, available_after, note, ref_transfer_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [storeId, productId, type, qty, after.on_hand - before.on_hand, available(after), note, transferId],
  );
}

async function requireStore(q, storeId, label = '門市') {
  const [store] = await q('SELECT store_id, name FROM stores WHERE store_id = $1', [storeId]);
  if (!store) throw new HttpError(400, `請選擇${label}`);
  return store;
}

async function requireProduct(q, productId) {
  const [product] = await q('SELECT product_id, name FROM products WHERE product_id = $1', [productId]);
  if (!product) throw new HttpError(404, '找不到這個商品');
  return product;
}

// ===== 庫存查詢 =====

// 每個商品 × 每家門市一列；前端再依需要排成總表
router.get('/inventory', async (req, res) => {
  const { q = '', category = '', store = '', status = 'active' } = req.query;
  const where = [];
  const params = [];
  if (q.trim()) {
    params.push(`%${q.trim()}%`);
    where.push(`(p.name ILIKE $${params.length} OR p.model ILIKE $${params.length} OR p.brand ILIKE $${params.length} OR p.product_id ILIKE $${params.length})`);
  }
  if (category) {
    params.push(category);
    where.push(`p.category = $${params.length}`);
  }
  if (store) {
    params.push(store);
    where.push(`i.store_id = $${params.length}`);
  }
  if (status === 'active') where.push('p.is_active');

  const rows = await query(
    `SELECT p.product_id, p.name, p.model, p.brand, p.category, p.is_active,
            i.store_id, i.on_hand, i.reserved, i.display, i.damaged, i.in_transit, ${AVAILABLE_SQL} AS available
     FROM inventory i JOIN products p ON p.product_id = i.product_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY p.product_id, i.store_id`,
    params,
  );
  res.json({ ok: true, rows });
});

router.get('/inventory/actions', (req, res) => {
  res.json({ ok: true, actions: ACTIONS });
});

router.get('/inventory/movements', async (req, res) => {
  const { store = '', product = '' } = req.query;
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const where = [];
  const params = [];
  if (store) {
    params.push(store);
    where.push(`t.store_id = $${params.length}`);
  }
  if (product) {
    params.push(product);
    where.push(`t.product_id = $${params.length}`);
  }
  params.push(limit);
  const rows = await query(
    `SELECT t.id, t.type, t.qty, t.qty_change, t.available_after, t.note, t.created_at, t.ref_transfer_id,
            t.store_id, s.name AS store_name, t.product_id, p.name AS product_name, p.model
     FROM inventory_transactions t
     JOIN stores s ON s.store_id = t.store_id
     JOIN products p ON p.product_id = t.product_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY t.created_at DESC, t.id DESC LIMIT $${params.length}`,
    params,
  );
  res.json({ ok: true, movements: rows });
});

// ===== 手動調整 =====

router.post('/inventory/adjust', async (req, res) => {
  const { store_id: storeId, product_id: productId, action, note } = req.body ?? {};
  if (!ACTIONS[action]) throw new HttpError(400, '請選擇庫存動作');
  const qty = readQty(req.body?.qty, { min: action === 'count' ? 0 : 1 });

  const result = await transaction(async (tx) => {
    const store = await requireStore(tx.query, storeId);
    await requireProduct(tx.query, productId);
    const row = await lockRow(tx, storeId, productId);
    const next = apply(action, row, qty);
    await saveRow(tx, storeId, productId, next);
    await logMovement(tx, { storeId, productId, type: action, qty, before: row, after: next, note: cleanNote(note) });
    return { store: store.name, before: available(row), after: available(next) };
  });

  res.json({
    ok: true,
    message: `${result.store}「${ACTIONS[action].label}」完成，可售 ${result.before} → ${result.after}`,
    ...result,
  });
});

// ===== 調貨 =====

const TRANSFER_SQL = `
  SELECT t.id, t.product_id, p.name AS product_name, p.model, t.from_store_id, fs.name AS from_store_name,
         t.to_store_id, ts.name AS to_store_name, t.qty, t.status, t.note, t.created_at, t.updated_at
  FROM stock_transfers t
  JOIN products p ON p.product_id = t.product_id
  LEFT JOIN stores fs ON fs.store_id = t.from_store_id
  JOIN stores ts ON ts.store_id = t.to_store_id
`;

router.get('/transfers', async (req, res) => {
  const { status = '', store = '' } = req.query;
  const where = [];
  const params = [];
  if (status) {
    params.push(status);
    where.push(`t.status = $${params.length}`);
  }
  if (store) {
    params.push(store);
    where.push(`(t.from_store_id = $${params.length} OR t.to_store_id = $${params.length})`);
  }
  const rows = await query(
    `${TRANSFER_SQL} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY (t.status = 'in_transit') DESC, t.created_at DESC, t.id DESC LIMIT 100`,
    params,
  );
  res.json({ ok: true, transfers: rows });
});

// 建立調貨：調出門市立刻扣實體庫存；調入門市先記「在途」，按到貨才入庫
router.post('/transfers', async (req, res) => {
  const { product_id: productId, to_store_id: toId, note } = req.body ?? {};
  const fromId = req.body?.from_store_id || null; // 空值 = 總倉
  const qty = readQty(req.body?.qty);
  if (fromId && fromId === toId) throw new HttpError(400, '調出和調入不能是同一家門市');

  const transfer = await transaction(async (tx) => {
    const product = await requireProduct(tx.query, productId);
    const to = await requireStore(tx.query, toId, '調入門市');
    let fromName = '總倉';
    let fromRow;
    if (fromId) {
      fromName = (await requireStore(tx.query, fromId, '調出門市')).name;
      fromRow = await lockRow(tx, fromId, productId);
      if (qty > available(fromRow)) {
        throw new HttpError(400, `${fromName}可售只有 ${available(fromRow)} 件，不能調出 ${qty} 件`);
      }
    }
    const [created] = await tx.query(
      `INSERT INTO stock_transfers (product_id, from_store_id, to_store_id, qty, note)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [productId, fromId, toId, qty, cleanNote(note)],
    );
    if (fromId) {
      const next = { ...fromRow, on_hand: fromRow.on_hand - qty };
      await saveRow(tx, fromId, productId, next);
      await logMovement(tx, {
        storeId: fromId, productId, type: 'transfer_out', qty, before: fromRow, after: next,
        note: `調貨單 #${created.id} → ${to.name}`, transferId: created.id,
      });
    }
    const toRow = await lockRow(tx, toId, productId);
    await saveRow(tx, toId, productId, { ...toRow, in_transit: toRow.in_transit + qty });
    return { id: created.id, message: `已建立調貨單 #${created.id}：${product.name} ${qty} 件，${fromName} → ${to.name}` };
  });
  res.status(201).json({ ok: true, ...transfer });
});

async function lockTransfer(tx, id) {
  const [t] = await tx.query('SELECT * FROM stock_transfers WHERE id = $1 FOR UPDATE', [id]);
  if (!t) throw new HttpError(404, '找不到這張調貨單');
  if (t.status !== 'in_transit') throw new HttpError(400, '這張調貨單已經處理過了');
  return t;
}

// 到貨：調入門市在途 → 實體庫存
router.post('/transfers/:id/receive', async (req, res) => {
  const message = await transaction(async (tx) => {
    const t = await lockTransfer(tx, req.params.id);
    const row = await lockRow(tx, t.to_store_id, t.product_id);
    const next = { ...row, in_transit: Math.max(row.in_transit - t.qty, 0), on_hand: row.on_hand + t.qty };
    await saveRow(tx, t.to_store_id, t.product_id, next);
    await logMovement(tx, {
      storeId: t.to_store_id, productId: t.product_id, type: 'transfer_in', qty: t.qty, before: row, after: next,
      note: `調貨單 #${t.id} 到貨`, transferId: t.id,
    });
    await tx.query(`UPDATE stock_transfers SET status = 'received', updated_at = now() WHERE id = $1`, [t.id]);
    return `調貨單 #${t.id} 已到貨入庫`;
  });
  res.json({ ok: true, message });
});

// 取消：調入門市扣掉在途；如果是門市調出，退回調出門市
router.post('/transfers/:id/cancel', async (req, res) => {
  const message = await transaction(async (tx) => {
    const t = await lockTransfer(tx, req.params.id);
    const toRow = await lockRow(tx, t.to_store_id, t.product_id);
    await saveRow(tx, t.to_store_id, t.product_id, { ...toRow, in_transit: Math.max(toRow.in_transit - t.qty, 0) });
    if (t.from_store_id) {
      const row = await lockRow(tx, t.from_store_id, t.product_id);
      const next = { ...row, on_hand: row.on_hand + t.qty };
      await saveRow(tx, t.from_store_id, t.product_id, next);
      await logMovement(tx, {
        storeId: t.from_store_id, productId: t.product_id, type: 'transfer_cancel', qty: t.qty, before: row, after: next,
        note: `調貨單 #${t.id} 取消，退回`, transferId: t.id,
      });
    }
    await tx.query(`UPDATE stock_transfers SET status = 'cancelled', updated_at = now() WHERE id = $1`, [t.id]);
    return `調貨單 #${t.id} 已取消`;
  });
  res.json({ ok: true, message });
});

export default router;
