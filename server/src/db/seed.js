// 示範資料：
// - 冷氣、除濕機、空氣清淨機：全國電子官網公開商品（型號、品名、網路價、原價，見 data/elifemall-products.json）
// - 其他分類：虛構示範商品（型號 DM- 開頭）
// - 門市、庫存、訂單、顧客：全部模擬
import { readFileSync } from 'node:fs';
import { regionForCity } from '../regions.js';
import { LEGACY_AC_PING, SPEC_TEMPLATES, validateBrand, validateSpecs } from '../specTemplates.js';
import { getDb } from './index.js';

const SCHEMA = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
const ELIFE = JSON.parse(readFileSync(new URL('./data/elifemall-products.json', import.meta.url), 'utf8'));
// 這些分類改用官網商品，不再放虛構商品
export const REAL_CATEGORIES = new Set(ELIFE.products.map((p) => p.category));

export const STORES = [
  ['TN01', '台南中西店', '台南市', '台南市中西區示範路 101 號（虛構）'],
  ['TN02', '台南永康店', '台南市', '台南市永康區示範路 202 號（虛構）'],
  ['KH01', '高雄左營店', '高雄市', '高雄市左營區示範路 303 號（虛構）'],
  ['TC01', '台中西屯店', '台中市', '台中市西屯區示範路 404 號（虛構）'],
  ['TP01', '台北內湖店', '台北市', '台北市內湖區示範路 505 號（虛構）'],
];

// [分類, 品牌, 型號, 品名, 保固, 原價, 售價, 規格]
// 品牌為真實品牌名稱，僅作情境示範；型號一律用 DM-（Demo）開頭，價格、規格、庫存皆為虛構。
const PRODUCTS = [
  ['冰箱', 'Panasonic 國際', 'DM-RF480', 'Panasonic 480L 變頻雙門冰箱', '3 年', 32900, 28900, { 容量: 480, 門數: '雙門', 能效: '1 級', 尺寸: { 寬: 68, 深: 70, 高: 178 } }],
  ['冰箱', 'HITACHI 日立', 'DM-RF560', 'HITACHI 560L 變頻四門冰箱', '3 年', 45900, 41900, { 容量: 560, 門數: '四門', 能效: '1 級', 特色: '急速冷凍室' }],
  ['冰箱', 'SAMPO 聲寶', 'DM-RF320', 'SAMPO 320L 小家庭雙門冰箱', '2 年', 18900, 16900, { 容量: 320, 門數: '雙門', 能效: '2 級' }],
  ['冰箱', 'LG 樂金', 'DM-RF650', 'LG 650L 對開門大冰箱', '3 年', 58900, 54900, { 容量: 650, 門數: '對開', 能效: '1 級', 特色: '製冰機' }],
  ['洗衣機', 'TECO 東元', 'DM-WM13', 'TECO 13kg 直立式洗衣機', '2 年', 15900, 13900, { 容量: 13, 類型: '直立式', 能效: '1 級' }],
  ['洗衣機', 'Panasonic 國際', 'DM-WM17', 'Panasonic 17kg 變頻直立洗衣機', '3 年', 21900, 19900, { 容量: 17, 類型: '直立式', 能效: '1 級', 特色: '變頻、溫水洗' }],
  ['洗衣機', 'LG 樂金', 'DM-WD12', 'LG 12kg 滾筒洗脫烘', '3 年', 39900, 35900, { 容量: 12, 類型: '滾筒', 能效: '2 級', 烘乾容量: 7 }],
  ['洗衣機', 'LG 樂金', 'DM-WD10', 'LG 10kg 滾筒洗衣機（舊款）', '2 年', 29900, 22900, { 容量: 10, 類型: '滾筒', 能效: '3 級' }],
  ['電視', 'SONY 索尼', 'DM-TV55', 'SONY 55 吋 4K 智慧電視', '3 年', 22900, 18900, { 尺寸: 55, 解析度: '4K', 面板: 'LCD', 系統: '智慧電視' }],
  ['電視', 'LG 樂金', 'DM-TV65', 'LG 65 吋 4K 智慧電視', '3 年', 32900, 27900, { 尺寸: 65, 解析度: '4K', 面板: 'LCD', 系統: '智慧電視' }],
  ['電視', 'HERAN 禾聯', 'DM-TV43', 'HERAN 43 吋 FHD 液晶電視', '2 年', 10900, 9490, { 尺寸: 43, 解析度: 'FHD', 面板: 'LCD', 系統: '一般電視' }],
  ['電視', 'SAMSUNG 三星', 'DM-TV75', 'SAMSUNG 75 吋 4K 量子點電視', '3 年', 49900, 44900, { 尺寸: 75, 解析度: '4K', 面板: '量子點', 系統: '智慧電視' }],
  ['吸塵器', 'dyson', 'DM-VC10', 'dyson 無線手持吸塵器', '2 年', 19900, 16900, { 類型: '無線手持', 續航: 60 }],
  ['吸塵器', 'iRobot', 'DM-RB20', 'iRobot 掃拖機器人', '2 年', 25900, 21900, { 類型: '掃地機器人', 續航: 120, 特色: '掃拖、自動集塵' }],
  ['吸塵器', 'Electrolux 伊萊克斯', 'DM-VC05', 'Electrolux 有線吸塵器', '1 年', 3990, 3490, { 類型: '有線', 特色: '旋風式集塵' }],
  ['廚房家電', 'ZOJIRUSHI 象印', 'DM-RC10', '象印 10 人份 IH 電子鍋', '2 年', 8900, 7490, { 類型: '電子鍋', 容量: '10 人份', 功率: 1200, 特色: 'IH 加熱' }],
  ['廚房家電', 'Philips 飛利浦', 'DM-AF06', 'Philips 6L 氣炸鍋', '1 年', 3990, 2990, { 類型: '氣炸鍋', 容量: '6L', 功率: 1500, 特色: '氣炸、烘烤' }],
  ['廚房家電', 'SHARP 夏普', 'DM-MW25', 'SHARP 25L 微波爐', '1 年', 4990, 4290, { 類型: '微波爐', 容量: '25L', 功率: 900 }],
  ['廚房家電', 'Panasonic 國際', 'DM-WP06', 'Panasonic 6L 濾淨飲水機', '2 年', 6990, 5990, { 類型: '飲水機', 容量: '6L', 特色: '冷熱、RO 過濾' }],
  ['廚房家電', 'TATUNG 大同', 'DM-OV32', '大同 32L 蒸烤爐', '2 年', 15900, 13900, { 類型: '蒸烤爐', 容量: '32L', 功率: 1800, 特色: '蒸、烤、發酵' }],
];

// 舊款由新款取代
const REPLACED_BY = { 'DM-WD10': 'DM-WD12' };

// 固定的「亂數」，讓每次重置都得到一樣的示範庫存
function pseudoRandom(seed) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0) / 4294967296;
}

const BIG_ITEMS = new Set(['冰箱', '洗衣機', '冷氣', '電視']);
// 熱銷缺貨中的商品，讓「低庫存」提醒有東西可以示範
const SCARCE = new Set(['DM-RF650', 'DM-TV75', 'DM-RB20', 'LSU22DST/LSN22DST', 'CU-UK22BCA2/CS-UK22BA2']);

// 全部示範商品（物件格式）：虛構商品在前，官網商品在後
const ALL_PRODUCTS = [
  ...PRODUCTS.filter((p) => !REAL_CATEGORIES.has(p[0])).map(([category, brand, model, name, warranty, list, sale, specs]) => (
    { category, brand, model, name, warranty, list_price: list, sale_price: sale, specs, source_code: null, meta: {} }
  )),
  ...ELIFE.products.map((p) => ({ ...p, warranty: null })),
];

function stockFor(storeId, { category, model }) {
  const r = pseudoRandom(storeId + model);
  const big = BIG_ITEMS.has(category);
  let onHand = Math.floor(r * (big ? 9 : 16));
  if (r < 0.12) onHand = 0; // 有些門市缺貨
  if (SCARCE.has(model)) onHand = Math.floor(r * 2.5);
  const display = big && onHand > 0 && r > 0.4 ? 1 : 0;
  const damaged = onHand > 3 && r > 0.85 ? 1 : 0;
  // 「預留」一律由訂單產生（見下方 DEMO_ORDERS），這裡從 0 開始
  const inTransit = onHand <= 1 ? Math.floor(pseudoRandom(model + storeId) * 4) : 0;
  return { onHand, reserved: 0, display, damaged, inTransit };
}

export const productId = (i) => `P${String(i + 1).padStart(4, '0')}`;

// 新增一項示範商品：商品主檔、目前價格、各店模擬庫存（在途數量附上總倉補貨單）
async function insertProduct(tx, id, p, storeIds, { oldPrice = false, active = true } = {}) {
  validateBrand(p.category, p.brand); // 示範資料也必須符合品牌清單與規格範本
  // 品名有「變頻」的，規格的「變頻」欄位也填上
  const withInverter = p.name.includes('變頻') && SPEC_TEMPLATES[p.category].some((f) => f.key === '變頻') && !p.specs.變頻
    ? { ...p.specs, 變頻: '變頻' } : p.specs;
  const specs = validateSpecs(p.category, withInverter);
  await tx.query(
    `INSERT INTO products (product_id, category, brand, model, name, specs, warranty, is_active, source_code, meta)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [id, p.category, p.brand, p.model, p.name, JSON.stringify(specs), p.warranty, active && !REPLACED_BY[p.model],
      p.source_code, JSON.stringify(p.meta ?? {})],
  );
  // 虛構商品有一半多一筆舊價格，示範價格歷史；官網商品從擷取日起算
  if (oldPrice) {
    await tx.query(
      `INSERT INTO product_prices (product_id, list_price, sale_price, valid_from, valid_to)
       VALUES ($1, $2, $2, now() - interval '90 days', now() - interval '30 days')`,
      [id, p.list_price],
    );
  }
  await tx.query(
    `INSERT INTO product_prices (product_id, list_price, sale_price, valid_from)
     VALUES ($1, $2, $3, ${p.source_code ? '$4::date' : "now() - interval '30 days'"})`,
    p.source_code ? [id, p.list_price, p.sale_price, ELIFE.captured_at] : [id, p.list_price, p.sale_price],
  );
  // 各店庫存一次寫入（商品多時，逐筆寫入雲端資料庫會太慢）
  const stock = storeIds.map((storeId) => ({ storeId, ...stockFor(storeId, p) }));
  await tx.query(
    `INSERT INTO inventory (store_id, product_id, on_hand, reserved, display, damaged, in_transit)
     SELECT s, $1, o, 0, d, g, t FROM unnest($2::text[], $3::int[], $4::int[], $5::int[], $6::int[]) AS x(s, o, d, g, t)`,
    [id, stock.map((s) => s.storeId), stock.map((s) => s.onHand), stock.map((s) => s.display), stock.map((s) => s.damaged), stock.map((s) => s.inTransit)],
  );
  // 在途數量要有對應的調貨單：示範資料一律是「總倉補貨」，兩天前出發
  const moving = stock.filter((s) => s.inTransit > 0);
  if (moving.length) {
    await tx.query(
      `INSERT INTO stock_transfers (product_id, from_store_id, to_store_id, qty, status, note, created_at, updated_at)
       SELECT $1, NULL, s, q, 'in_transit', '總倉例行補貨', now() - interval '2 days', now() - interval '2 days'
       FROM unnest($2::text[], $3::int[]) AS x(s, q)`,
      [id, moving.map((s) => s.storeId), moving.map((s) => s.inTransit)],
    );
  }
}

// 舊資料庫升級：加入官網商品（已有同型號就補上官網編號與價格），並把這幾個分類的虛構商品下架。
// 不刪除任何資料，既有訂單、庫存紀錄都保留。每次啟動都會檢查，已升級過就直接跳過。
export async function syncElifemallProducts(db) {
  const [{ n }] = await db.query('SELECT count(*)::int AS n FROM products WHERE source_code IS NOT NULL');
  if (n >= ELIFE.products.length) return null;

  return db.transaction(async (tx) => {
    const storeIds = (await tx.query('SELECT store_id FROM stores ORDER BY store_id')).map((s) => s.store_id);
    const [{ next }] = await tx.query(
      `SELECT COALESCE(MAX(substring(product_id from 2)::int), 0) AS next FROM products WHERE product_id ~ '^P[0-9]+$'`,
    );
    let nextNo = next;
    let added = 0;
    let updated = 0;
    for (const p of ELIFE.products) {
      const [existing] = await tx.query(
        'SELECT product_id, source_code FROM products WHERE model = $1 OR source_code = $2',
        [p.model, p.source_code],
      );
      if (!existing) {
        await insertProduct(tx, productId(nextNo++), { ...p, warranty: null }, storeIds);
        added++;
      } else if (!existing.source_code) {
        // 同型號的既有商品：補上官網編號、外型資料與目前官網價格（價格歷史保留）
        await tx.query(
          'UPDATE products SET source_code = $2, meta = $3, updated_at = now() WHERE product_id = $1',
          [existing.product_id, p.source_code, JSON.stringify(p.meta ?? {})],
        );
        await tx.query('UPDATE product_prices SET valid_to = now() WHERE product_id = $1 AND valid_to IS NULL', [existing.product_id]);
        await tx.query('INSERT INTO product_prices (product_id, list_price, sale_price) VALUES ($1, $2, $3)', [
          existing.product_id, p.list_price, p.sale_price,
        ]);
        updated++;
      }
    }
    // 這幾個分類的虛構商品（DM-）下架：不再出現在導購與下單，舊訂單仍看得到
    const hidden = await tx.query(
      `UPDATE products SET is_active = false, updated_at = now()
       WHERE model LIKE 'DM-%' AND category = ANY($1) AND is_active RETURNING product_id`,
      [[...REAL_CATEGORIES]],
    );
    // 冷氣坪數改用官網級距：舊級距換成最接近的新級距
    for (const [from, to] of Object.entries(LEGACY_AC_PING)) {
      await tx.query(
        `UPDATE products SET specs = jsonb_set(specs, '{適用坪數}', to_jsonb($2::text))
         WHERE category = '冷氣' AND specs->>'適用坪數' = $1`,
        [from, to],
      );
    }
    return { added, updated, hidden: hidden.length };
  });
}

// 示範訂單（顧客姓名、電話皆為虛構）。商品會挑「那家門市有貨」的同分類商品
const DEMO_ORDERS = [
  { name: '王小明', phone: '0912000001', store: 'TN01', fulfillment: 'pickup', items: [['冰箱', 1]], steps: ['confirm'] },
  { name: '陳美玲', phone: '0912000002', store: 'KH01', fulfillment: 'delivery', address: '高雄市左營區示範街 1 號（虛構）', items: [['電視', 1], ['廚房家電', 1]], steps: [] },
  { name: '林志豪', phone: '0912000003', store: 'TP01', fulfillment: 'pickup', items: [['冷氣', 1]], steps: ['confirm', 'ship'] },
  { name: '張雅婷', phone: '0912000004', store: 'TC01', fulfillment: 'delivery', address: '台中市西屯區示範街 2 號（虛構）', items: [['除濕機', 2]], steps: ['confirm', 'ship', 'complete'] },
  { name: '黃建國', phone: '0912000005', store: 'TN02', fulfillment: 'pickup', items: [['洗衣機', 1]], steps: ['confirm', 'cancel'] },
  { name: '李佩珊', phone: '0912000006', store: 'TN01', fulfillment: 'delivery', address: '台南市中西區示範街 3 號（虛構）', items: [['空氣清淨機', 1], ['吸塵器', 1]], steps: ['confirm'] },
  { name: '吳俊傑', phone: '0912000007', store: 'TC01', fulfillment: 'pickup', items: [['電視', 1]], steps: ['confirm'] },
];

async function createDemoOrders(tx) {
  const orders = await import('../routes/orders.js');
  for (const o of DEMO_ORDERS) {
    const items = [];
    for (const [category, qty] of o.items) {
      const [pick] = await tx.query(
        `SELECT p.product_id FROM products p JOIN inventory i ON i.product_id = p.product_id
         WHERE p.category = $1 AND p.is_active AND i.store_id = $2 AND (i.on_hand - i.reserved - i.display - i.damaged) >= $3
         ORDER BY md5(p.product_id || $2) LIMIT 1`,
        [category, o.store, qty + 1],
      );
      if (pick) items.push({ product_id: pick.product_id, qty });
    }
    if (!items.length) continue;
    const orderNo = await orders.createOrder(tx, {
      customer: { name: o.name, phone: o.phone },
      store_id: o.store,
      fulfillment: o.fulfillment,
      delivery_address: o.address,
      items,
    });
    for (const step of o.steps) {
      if (step === 'confirm') await orders.confirmOrder(tx, orderNo);
      if (step === 'ship') await orders.shipOrder(tx, orderNo);
      if (step === 'complete') await orders.completeOrder(tx, orderNo);
      if (step === 'cancel') await orders.cancelOrder(tx, orderNo, '顧客改變心意');
    }
  }
}

// 刪除系統補建的 SO-LEGACY 訂單（釋放預留），並補上示範訂單。不動其他資料
export async function replaceLegacyOrders() {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const legacy = await tx.query(
      `SELECT o.order_no, o.store_id, o.status, oi.product_id, oi.qty
       FROM orders o JOIN order_items oi ON oi.order_no = o.order_no
       WHERE o.order_no LIKE 'SO-LEGACY-%'`,
    );
    for (const l of legacy) {
      if (l.status !== 'reserved') continue;
      const [before] = await tx.query(
        'SELECT on_hand, reserved, display, damaged FROM inventory WHERE store_id = $1 AND product_id = $2 FOR UPDATE',
        [l.store_id, l.product_id],
      );
      const [after] = await tx.query(
        `UPDATE inventory SET reserved = GREATEST(reserved - $3, 0) WHERE store_id = $1 AND product_id = $2
         RETURNING on_hand, reserved, display, damaged`,
        [l.store_id, l.product_id, l.qty],
      );
      if (before && after) {
        await tx.query(
          `INSERT INTO inventory_transactions (store_id, product_id, type, qty, qty_change, available_after, note, ref_order_no)
           VALUES ($1, $2, 'order_release', $3, 0, $4, '清除系統補建訂單，釋放預留', $5)`,
          [l.store_id, l.product_id, l.qty, after.on_hand - after.reserved - after.display - after.damaged, l.order_no],
        );
      }
    }
    const removed = new Set(legacy.map((l) => l.order_no)).size;
    await tx.query(`DELETE FROM orders WHERE order_no LIKE 'SO-LEGACY-%'`);
    await tx.query(`DELETE FROM customers c WHERE c.phone = '0900000000' AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id)`);

    // 還沒有示範訂單才補（用示範顧客的電話判斷）
    const [{ count }] = await tx.query(
      `SELECT count(*)::int AS count FROM orders o JOIN customers c ON c.id = o.customer_id WHERE c.phone LIKE '091200000_'`,
    );
    const before = (await tx.query('SELECT count(*)::int AS n FROM orders'))[0].n;
    if (count === 0) await createDemoOrders(tx);
    const added = (await tx.query('SELECT count(*)::int AS n FROM orders'))[0].n - before;
    return { removed, added };
  });
}

// 舊版資料庫有「預留」數量卻沒有訂單：每一筆補建一張「已預留」的示範訂單（只在還沒有任何訂單時執行）
async function backfillReservations(db) {
  const [{ count }] = await db.query('SELECT count(*)::int AS count FROM orders');
  if (count > 0) return;
  const rows = await db.query(
    `SELECT i.store_id, i.product_id, i.reserved, pr.sale_price
     FROM inventory i LEFT JOIN product_prices pr ON pr.product_id = i.product_id AND pr.valid_to IS NULL
     WHERE i.reserved > 0 ORDER BY i.store_id, i.product_id`,
  );
  if (!rows.length) return;
  await db.transaction(async (tx) => {
    const [customer] = await tx.query(
      `INSERT INTO customers (name, phone) VALUES ('既有預留（系統補建）', '0900000000')
       ON CONFLICT (phone) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
    );
    for (const [i, r] of rows.entries()) {
      const orderNo = `SO-LEGACY-${String(i + 1).padStart(3, '0')}`;
      const price = r.sale_price ?? 0;
      await tx.query(
        `INSERT INTO orders (order_no, customer_id, store_id, fulfillment, status, total, note)
         VALUES ($1, $2, $3, 'pickup', 'reserved', $4, '升級前就存在的預留庫存，系統自動補建訂單')`,
        [orderNo, customer.id, r.store_id, price * r.reserved],
      );
      await tx.query('INSERT INTO order_items (order_no, product_id, qty, unit_price) VALUES ($1, $2, $3, $4)', [
        orderNo, r.product_id, r.reserved, price,
      ]);
      await tx.query(`INSERT INTO order_status_history (order_no, status, note) VALUES ($1, 'reserved', '系統補建')`, [orderNo]);
    }
  });
}

// 舊版資料庫有「在途」數量卻沒有調貨單：補建成總倉補貨單（只在還沒有任何調貨單時執行）
async function backfillTransfers(db) {
  const [{ count }] = await db.query('SELECT count(*)::int AS count FROM stock_transfers');
  if (count > 0) return;
  await db.query(
    `INSERT INTO stock_transfers (product_id, from_store_id, to_store_id, qty, status, note, created_at, updated_at)
     SELECT product_id, NULL, store_id, in_transit, 'in_transit', '總倉例行補貨', now() - interval '2 days', now() - interval '2 days'
     FROM inventory WHERE in_transit > 0`,
  );
}

// 舊版資料庫的門市沒有區域：依縣市補上
async function backfillRegions(db) {
  const missing = await db.query('SELECT store_id, city FROM stores WHERE region IS NULL');
  for (const s of missing) {
    await db.query('UPDATE stores SET region = $2 WHERE store_id = $1', [s.store_id, regionForCity(s.city)]);
  }
}

export async function seed({ reset = false } = {}) {
  const db = await getDb();
  if (reset) {
    await db.exec(`DROP TABLE IF EXISTS import_batches, order_status_history, order_items, orders, customers,
      inventory_transactions, stock_transfers, inventory, product_prices, products, stores CASCADE;`);
  }
  await db.exec(SCHEMA);

  const [{ count }] = await db.query('SELECT count(*)::int AS count FROM stores');
  if (count > 0) {
    await backfillTransfers(db);
    await backfillRegions(db);
    await backfillReservations(db);
    const synced = await syncElifemallProducts(db);
    if (synced) console.log(`已加入全國電子官網商品：新增 ${synced.added}、更新 ${synced.updated}、下架虛構商品 ${synced.hidden}`);
    return false;
  }

  await db.transaction(async (tx) => {
    for (const [storeId, name, city, address] of STORES) {
      await tx.query(
        'INSERT INTO stores (store_id, name, city, address, region) VALUES ($1, $2, $3, $4, $5)',
        [storeId, name, city, address, regionForCity(city)],
      );
    }
    const idByModel = Object.fromEntries(ALL_PRODUCTS.map((p, i) => [p.model, productId(i)]));
    const storeIds = STORES.map(([id]) => id);
    for (const [i, p] of ALL_PRODUCTS.entries()) {
      await insertProduct(tx, productId(i), p, storeIds, { oldPrice: !p.source_code && i % 2 === 0 });
    }
    for (const [oldModel, newModel] of Object.entries(REPLACED_BY)) {
      if (idByModel[oldModel] && idByModel[newModel]) await tx.query('UPDATE products SET replaced_by = $1 WHERE product_id = $2', [idByModel[newModel], idByModel[oldModel]]);
    }
    await createDemoOrders(tx);
  });
  return true;
}
