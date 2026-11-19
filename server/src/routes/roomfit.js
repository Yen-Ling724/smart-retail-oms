// 3D 坪數選購頁（client/public/room-fit.html）用的 API：
// - 商品目錄：冷氣、空氣清淨機、除濕機 + 各門市可售數量
// - 報價／預約單：顧客或店員在 3D 頁送出，門市在 CCC「訂單管理 → 報價／預約」追蹤
// - 試算紀錄：每次試算的條件（不含個資），作為營運分析的需求訊號
import { Router } from 'express';
import { query, transaction } from '../db/index.js';
import { STORE_ORDER_SQL } from '../regions.js';
import { createOrder } from './orders.js';
import { HttpError } from './products.js';

const router = Router();

const ROOM_FIT_CATEGORIES = ['冷氣', '空氣清淨機', '除濕機'];
export const REQUEST_TYPE = { quote: '請門市報價', survey: '到府場勘', visit: '到店諮詢' };
export const REQUEST_STATUS = { new: '新進', contacted: '已聯絡', scheduled: '已排定', done: '已完成', cancelled: '已取消' };
// 狀態可以往哪裡走
const NEXT_STATUS = {
  new: ['contacted', 'scheduled', 'done', 'cancelled'],
  contacted: ['scheduled', 'done', 'cancelled'],
  scheduled: ['done', 'cancelled'],
  done: [],
  cancelled: [],
};

const text = (v, max) => {
  const s = String(v ?? '').trim();
  return s ? s.slice(0, max) : null;
};
const numOrNull = (v, min, max) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};

// ---- 商品目錄 ----
router.get('/room-fit/catalog', async (req, res) => {
  const stores = await query(`SELECT store_id, name, region, city, district, store_type FROM stores s ORDER BY ${STORE_ORDER_SQL('s')}`);
  const rows = await query(
    `SELECT p.product_id, p.category, p.brand, p.model, p.name, p.specs, p.meta, p.source_code,
            pr.sale_price AS price, pr.list_price,
            COALESCE(jsonb_object_agg(i.store_id, GREATEST(i.on_hand - i.reserved - i.display - i.damaged, 0))
                     FILTER (WHERE i.store_id IS NOT NULL), '{}'::jsonb) AS stock
     FROM products p
     JOIN product_prices pr ON pr.product_id = p.product_id AND pr.valid_to IS NULL
     LEFT JOIN inventory i ON i.product_id = p.product_id
     WHERE p.is_active AND p.category = ANY($1)
     GROUP BY p.product_id, pr.sale_price, pr.list_price
     ORDER BY p.product_id`,
    [ROOM_FIT_CATEGORIES],
  );
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true, stores, products: rows });
});

// ---- 試算紀錄（需求訊號）----
router.post('/fit-sessions', async (req, res) => {
  const b = req.body ?? {};
  const category = ['ac', 'ap', 'dh'].includes(b.category) ? b.category : null;
  const ping = numOrNull(b.ping, 0.5, 100);
  const eff = numOrNull(b.eff_ping, 0.5, 200);
  if (!category || ping === null || eff === null) throw new HttpError(400, '試算資料不完整');
  const storeId = text(b.store_id, 10);
  const productId = text(b.product_id, 20);
  // 門市、商品不存在就不記（避免外部亂送資料造成外鍵錯誤）
  const [refs] = await query(
    `SELECT (SELECT store_id FROM stores WHERE store_id = $1) AS store_id,
            (SELECT product_id FROM products WHERE product_id = $2) AS product_id`,
    [storeId, productId],
  );
  await query(
    `INSERT INTO fit_sessions (session, view, category, store_id, ping, room, ceil, west, top_floor, people, eff_ping,
       budget, brand, product_id, fit, coverage, result_count, ok_count)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
    [
      text(b.session, 20), ['customer', 'staff', 'internal'].includes(b.view) ? b.view : null, category, refs.store_id,
      ping, ['bedroom', 'living', 'study'].includes(b.room) ? b.room : null, numOrNull(b.ceil, 2, 6),
      b.west === true, b.top === true, numOrNull(b.people, 1, 20), eff, numOrNull(b.budget, 0, 10_000_000),
      text(b.brand, 40), refs.product_id, ['ok', 'big', 'low'].includes(b.fit) ? b.fit : null,
      numOrNull(b.coverage, 0, 100), numOrNull(b.result_count, 0, 10000), numOrNull(b.ok_count, 0, 10000),
    ],
  );
  res.json({ ok: true });
});

// ---- 報價／預約單 ----
async function nextRequestNo(tx, at = null) {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(at ? new Date(at) : new Date()).replaceAll('-', '');
  const prefix = `SR${ymd}-`;
  const [{ n }] = await tx.query(
    `SELECT COALESCE(MAX(substring(request_no from ${prefix.length + 1})::int), 0) + 1 AS n FROM service_requests WHERE request_no LIKE $1`,
    [`${prefix}%`],
  );
  return `${prefix}${String(n).padStart(3, '0')}`;
}

export async function createServiceRequest(tx, b, { createdAt = null } = {}) {
  const type = REQUEST_TYPE[b.type] ? b.type : null;
  if (!type) throw new HttpError(400, '請選擇報價或預約');
  const name = text(b.name, 20);
  const phone = String(b.phone ?? '').replace(/[\s-]/g, '');
  if (!name) throw new HttpError(400, '請填寫稱呼');
  if (!/^09\d{8}$/.test(phone)) throw new HttpError(400, '手機格式不正確，例如 0912345678');
  const [store] = await tx.query('SELECT store_id FROM stores WHERE store_id = $1', [b.store_id]);
  if (!store) throw new HttpError(400, '請選擇服務門市');
  const [product] = await tx.query(
    `SELECT p.product_id, p.is_active, pr.sale_price FROM products p
     LEFT JOIN product_prices pr ON pr.product_id = p.product_id AND pr.valid_to IS NULL WHERE p.product_id = $1`,
    [b.product_id],
  );
  if (!product || !product.is_active) throw new HttpError(400, '找不到這項商品，請重新整理頁面');
  const date = text(b.preferred_date, 10);
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, '日期格式不正確');
  if (type !== 'quote' && !date && !createdAt) throw new HttpError(400, '請選擇希望日期');
  const room = typeof b.room === 'object' && b.room !== null ? b.room : {};
  // room 只留需要的欄位，避免存入任意資料
  const cleanRoom = {
    category: ['ac', 'ap', 'dh'].includes(room.category) ? room.category : null,
    ping: numOrNull(room.ping, 0.5, 100), room: text(room.room, 10), ceil: numOrNull(room.ceil, 2, 6),
    west: room.west === true, top: room.top === true, people: numOrNull(room.people, 1, 20),
    eff_ping: numOrNull(room.eff_ping, 0.5, 200), text: text(room.text, 100),
  };

  const requestNo = await nextRequestNo(tx, createdAt);
  const [row] = await tx.query(
    `INSERT INTO service_requests (request_no, type, source, product_id, store_id, customer_name, phone, county, floor,
       preferred_date, slot, memo, room, quoted_price, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, COALESCE($15, now()), COALESCE($15, now()))
     RETURNING request_no, type, status, created_at`,
    [
      requestNo, type, b.source === 'staff' ? 'staff' : 'customer', product.product_id, store.store_id, name, phone,
      text(b.county, 10), numOrNull(b.floor, 1, 100), date, text(b.slot, 20), text(b.memo, 200), JSON.stringify(cleanRoom),
      product.sale_price, createdAt,
    ],
  );
  return row;
}

router.post('/service-requests', async (req, res) => {
  const request = await transaction((tx) => createServiceRequest(tx, req.body ?? {}));
  res.status(201).json({ ok: true, request });
});

router.get('/service-requests', async (req, res) => {
  const where = [];
  const params = [];
  if (REQUEST_STATUS[req.query.status]) { params.push(req.query.status); where.push(`r.status = $${params.length}`); }
  if (REQUEST_TYPE[req.query.type]) { params.push(req.query.type); where.push(`r.type = $${params.length}`); }
  if (req.query.store_id) { params.push(req.query.store_id); where.push(`r.store_id = $${params.length}`); }
  const rows = await query(
    `SELECT r.*, p.name AS product_name, p.model, p.category, s.name AS store_name,
            GREATEST(i.on_hand - i.reserved - i.display - i.damaged, 0) AS store_available
     FROM service_requests r
     JOIN products p ON p.product_id = r.product_id
     JOIN stores s ON s.store_id = r.store_id
     LEFT JOIN inventory i ON i.product_id = r.product_id AND i.store_id = r.store_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY r.created_at DESC LIMIT 300`,
    params,
  );
  const counts = await query('SELECT status, count(*)::int AS n FROM service_requests GROUP BY status');
  res.json({ ok: true, requests: rows, counts: Object.fromEntries(counts.map((c) => [c.status, c.n])), types: REQUEST_TYPE, statuses: REQUEST_STATUS });
});

router.patch('/service-requests/:no', async (req, res) => {
  const status = req.body?.status;
  const note = text(req.body?.staff_note, 200);
  const updated = await transaction(async (tx) => {
    const [r] = await tx.query('SELECT status FROM service_requests WHERE request_no = $1 FOR UPDATE', [req.params.no]);
    if (!r) throw new HttpError(404, '找不到這張單');
    if (status && status !== r.status) {
      if (!NEXT_STATUS[r.status]?.includes(status)) {
        throw new HttpError(409, `這張單目前是「${REQUEST_STATUS[r.status]}」，不能改成「${REQUEST_STATUS[status] ?? status}」`);
      }
    }
    const [row] = await tx.query(
      `UPDATE service_requests SET status = COALESCE($2, status), staff_note = COALESCE($3, staff_note), updated_at = now()
       WHERE request_no = $1 RETURNING request_no, status, staff_note`,
      [req.params.no, status || null, note],
    );
    return row;
  });
  res.json({ ok: true, request: updated });
});

// 轉成訂單：用單上的顧客、商品、門市建立一張「待確認」訂單（數量 1，門市自取；之後可在訂單頁確認預留）
router.post('/service-requests/:no/convert', async (req, res) => {
  const result = await transaction(async (tx) => {
    const [r] = await tx.query('SELECT * FROM service_requests WHERE request_no = $1 FOR UPDATE', [req.params.no]);
    if (!r) throw new HttpError(404, '找不到這張單');
    if (r.order_no) throw new HttpError(409, `這張單已經轉成訂單 ${r.order_no}`);
    if (r.status === 'cancelled') throw new HttpError(409, '已取消的單不能轉成訂單');
    const orderNo = await createOrder(tx, {
      customer: { name: r.customer_name, phone: r.phone },
      store_id: r.store_id,
      fulfillment: 'pickup',
      note: `由${REQUEST_TYPE[r.type]}單 ${r.request_no} 轉入`,
      items: [{ product_id: r.product_id, qty: 1 }],
    });
    await tx.query(
      `UPDATE service_requests SET order_no = $2, status = 'done', updated_at = now() WHERE request_no = $1`,
      [r.request_no, orderNo],
    );
    return { order_no: orderNo };
  });
  res.json({ ok: true, ...result });
});

export default router;
