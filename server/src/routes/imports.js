// 試算表匯入（目前只有商品）
// 流程：前端讀 Excel／CSV → POST preview（只檢查、不寫入）→ POST commit（全部通過才在同一個交易寫入）
//      每次匯入寫一筆 import_batches，最近一次可以復原。
import { Router } from 'express';
import { query, transaction } from '../db/index.js';
import { BRANDS, SPEC_TEMPLATES, normalizeWarranty, validateSpecs } from '../specTemplates.js';
import { HttpError } from './products.js';

const router = Router();

export const IMPORT_LIMITS = { maxRows: 1000, maxFileMB: 2 };

// ===== 值的整理：讓舊系統常見的寫法也能對上 =====

const clean = (v) => (v === undefined || v === null ? '' : String(v).trim());

// 「NT$ 28,900」「480L」「55吋」→ 數字；沒有數字回傳 NaN
function toNumber(v) {
  const m = clean(v).replace(/[,，\s]/g, '').match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : NaN;
}

// 比對下拉選項時忽略空白、大小寫、「坪」「級」，並把各種破折號、國字數字統一
const CN_DIGIT = { 一: '1', 二: '2', 兩: '2', 三: '3', 四: '4', 五: '5' };
function looseKey(v) {
  return clean(v)
    .toLowerCase()
    .replace(/[一二兩三四五](?=級)/g, (c) => CN_DIGIT[c])
    .replace(/[~～－—–]/g, '-')
    .replace(/[\s坪級]/g, '');
}

// 品牌：「日立」「HITACHI」「國際牌」都能對到清單裡的正式名稱
const BRAND_EXTRA = { 'Panasonic 國際': ['國際牌', '松下'], 'TATUNG 大同': ['大同'], 'ZOJIRUSHI 象印': ['象印'], 'TIGER 虎牌': ['虎牌'] };
function resolveBrand(category, input) {
  const list = BRANDS[category] ?? [];
  const v = clean(input).toLowerCase();
  if (!v) return null;
  return list.find((b) => {
    if (b.toLowerCase() === v) return true;
    const aliases = [...b.split(/\s+/), ...(BRAND_EXTRA[b] ?? [])].map((a) => a.toLowerCase());
    return aliases.includes(v);
  }) ?? null;
}

function parseActive(v) {
  const s = clean(v).toLowerCase();
  if (!s) return null;
  if (['是', 'y', 'yes', 'true', '1', '上架', '上架中', 'v', '✓'].includes(s)) return true;
  if (['否', 'n', 'no', 'false', '0', '停售', '下架', '已停售', 'x'].includes(s)) return false;
  return undefined; // 看不懂
}

// 選項是區間（例如冷氣「9-11 坪」），但只填了一個數字「10」或「10坪」：
// 自動換成「能涵蓋這個數字的最小區間」→ 10 → 9-11 坪；剛好在交界（如 3）時選小的那個（2-3 坪）。
// 比最小區間還小就用第一個；比最大區間還大就不猜，交給檢查回報錯誤。
function pickRange(options, input) {
  if (!/^\d+(?:\.\d+)?$/.test(looseKey(input))) return null;
  const n = Number(looseKey(input));
  const ranges = options.map((o) => ({ o, m: String(o).match(/^(\d+)\s*-\s*(\d+)/) }));
  if (!ranges.length || ranges.some((r) => !r.m)) return null;
  const hit = ranges.find((r) => n <= Number(r.m[2]));
  return hit && n > 0 ? hit.o : null;
}

// 把一列裡的規格欄位整理成 validateSpecs 吃的格式（只處理有填的格子）
function specsFromRow(category, raw, notes = []) {
  const out = {};
  for (const field of SPEC_TEMPLATES[category] ?? []) {
    if (field.type === 'dimensions') {
      const parts = ['寬', '深', '高'].map((k) => clean(raw[k]));
      if (parts.some(Boolean)) out[field.key] = { 寬: parts[0], 深: parts[1], 高: parts[2] };
      else if (clean(raw[field.key])) out[field.key] = clean(raw[field.key]); // 「68×70×178」寫在同一格也可以
      continue;
    }
    const v = clean(raw[field.key]);
    if (!v) continue;
    if (field.type === 'number' || (field.type === 'select' && field.numeric)) {
      const n = toNumber(v);
      out[field.key] = Number.isFinite(n) ? n : v; // 不是數字就原樣交給檢查，讓錯誤訊息講清楚
    } else if (field.type === 'select') {
      const exact = field.options.find((o) => looseKey(o) === looseKey(v));
      const range = exact ? null : pickRange(field.options, v);
      if (range) notes.push(`${field.key}「${v}」→「${range}」`);
      out[field.key] = exact ?? range ?? v;
    } else {
      out[field.key] = v;
    }
  }
  return out;
}

const PRICE_LABEL = { list_price: '原價', sale_price: '售價' };

// ===== 檢查每一列 =====
async function analyze(rows, q = query) {
  if (!Array.isArray(rows) || !rows.length) throw new HttpError(400, '檔案裡沒有資料列');
  if (rows.length > IMPORT_LIMITS.maxRows) {
    throw new HttpError(400, `一次最多匯入 ${IMPORT_LIMITS.maxRows} 列，這個檔案有 ${rows.length} 列，請分批匯入`);
  }

  const existing = await q(`
    SELECT p.product_id, p.model, p.name, p.category, p.brand, p.warranty, p.is_active, p.specs,
           pr.list_price, pr.sale_price
    FROM products p LEFT JOIN product_prices pr ON pr.product_id = p.product_id AND pr.valid_to IS NULL`);
  const byModel = new Map(existing.map((p) => [p.model.toLowerCase(), p]));
  const seen = new Map(); // 型號 → 第幾列（找同一個檔案裡重複的型號）

  return rows.map((input, i) => {
    const raw = input?.cells ?? input ?? {};
    const rowNo = Number(input?.row) || i + 2;
    const errors = [];
    const model = clean(raw['型號']);
    const current = model ? byModel.get(model.toLowerCase()) : null;
    const isUpdate = Boolean(current);

    if (!model) errors.push('型號沒有填');
    else if (model.length > 50) errors.push('型號最多 50 個字');
    else if (seen.has(model.toLowerCase())) errors.push(`型號跟第 ${seen.get(model.toLowerCase())} 列重複`);
    if (model) seen.set(model.toLowerCase(), rowNo);

    // 更新時空白 = 不修改；新增時必填欄位一定要有
    const name = clean(raw['品名']) || current?.name || '';
    const category = clean(raw['分類']) || current?.category || '';
    if (!name) errors.push('品名沒有填');
    else if (name.length > 100) errors.push('品名最多 100 個字');
    if (!category) errors.push('分類沒有填');
    else if (!SPEC_TEMPLATES[category]) errors.push(`分類「${category}」不存在，可用：${Object.keys(SPEC_TEMPLATES).join('、')}`);

    let brand = current?.brand ?? '';
    if (clean(raw['品牌'])) {
      brand = SPEC_TEMPLATES[category] ? resolveBrand(category, raw['品牌']) : null;
      if (!brand && SPEC_TEMPLATES[category]) errors.push(`品牌「${clean(raw['品牌'])}」不在「${category}」的品牌清單`);
    } else if (!isUpdate) errors.push('品牌沒有填');
    else if (SPEC_TEMPLATES[category] && !(BRANDS[category] ?? []).includes(brand)) {
      errors.push(`原本的品牌「${brand}」不在「${category}」的品牌清單，請一起填品牌`);
    }

    let warranty = current?.warranty ?? null;
    if (clean(raw['保固'])) {
      try { warranty = normalizeWarranty(raw['保固']); } catch (err) { errors.push(err.message); }
    }

    let isActive = current?.is_active ?? true;
    if (clean(raw['上架'])) {
      const a = parseActive(raw['上架']);
      if (a === undefined) errors.push('上架只能填「是」或「否」');
      else isActive = a;
    }

    const prices = { list_price: current?.list_price ?? null, sale_price: current?.sale_price ?? null };
    for (const [key, label] of Object.entries(PRICE_LABEL)) {
      const v = clean(raw[label]);
      if (!v) continue;
      const n = toNumber(v);
      if (!Number.isInteger(n) || n < 0) errors.push(`${label}必須是 0 以上的整數`);
      else prices[key] = n;
    }
    if (prices.list_price == null) errors.push('原價沒有填');
    if (prices.sale_price == null) errors.push('售價沒有填');
    if (prices.list_price != null && prices.sale_price != null && prices.sale_price > prices.list_price) {
      errors.push('售價不能高於原價');
    }

    let specs = {};
    const notes = []; // 系統自動轉換的地方，預覽時顯示給使用者看
    if (SPEC_TEMPLATES[category]) {
      const base = isUpdate ? { ...(current.specs ?? {}) } : {};
      try {
        specs = validateSpecs(category, { ...base, ...specsFromRow(category, raw, notes) });
      } catch (err) {
        errors.push(...(err.errors ?? [err.message]));
      }
    }

    const data = { model, name, category, brand, warranty, is_active: isActive, specs, ...prices };
    let action = errors.length ? 'error' : isUpdate ? 'update' : 'create';
    let changes = [];
    if (action === 'update') {
      const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
      const sortKeys = (o) => Object.fromEntries(Object.entries(o ?? {}).sort());
      const labels = { name: '品名', category: '分類', brand: '品牌', warranty: '保固', is_active: '上架', list_price: '原價', sale_price: '售價' };
      changes = Object.entries(labels).filter(([k]) => !same(data[k], current[k])).map(([, l]) => l);
      if (!same(sortKeys(data.specs), sortKeys(current.specs))) changes.push('規格');
      if (!changes.length) action = 'unchanged';
    }
    return { row: rowNo, model, name, action, errors, changes, notes, product_id: current?.product_id ?? null, data };
  });
}

function summarize(results) {
  const count = (a) => results.filter((r) => r.action === a).length;
  return { total: results.length, create: count('create'), update: count('update'), unchanged: count('unchanged'), error: count('error') };
}

router.get('/import/products/info', (req, res) => {
  res.json({ ok: true, limits: IMPORT_LIMITS });
});

// 預覽：只檢查，不寫入
router.post('/import/products/preview', async (req, res) => {
  const results = await analyze(req.body?.rows);
  res.json({
    ok: true,
    summary: summarize(results),
    rows: results.map(({ data, ...r }) => ({ ...r, category: data.category, brand: data.brand })),
  });
});

// 確認匯入：後端重新檢查一次（不相信前端），有任何一列錯誤就整批不寫入
router.post('/import/products/commit', async (req, res) => {
  const filename = clean(req.body?.filename).slice(0, 200) || null;
  const result = await transaction(async (tx) => {
    const results = await analyze(req.body?.rows, tx.query);
    const summary = summarize(results);
    if (summary.error) throw new HttpError(400, `有 ${summary.error} 列有錯誤，整批都沒有匯入。請修正後重新上傳。`);
    if (!summary.create && !summary.update) throw new HttpError(400, '檔案裡的商品都跟系統裡一樣，沒有需要匯入的資料');

    const [{ next }] = await tx.query(
      `SELECT COALESCE(MAX(substring(product_id from 2)::int), 0) + 1 AS next FROM products WHERE product_id ~ '^P[0-9]+$'`,
    );
    let nextId = Number(next);
    const created = [];
    const updated = [];

    for (const r of results) {
      const d = r.data;
      if (r.action === 'create') {
        const id = `P${String(nextId++).padStart(4, '0')}`;
        await tx.query(
          `INSERT INTO products (product_id, category, brand, model, name, specs, warranty, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [id, d.category, d.brand, d.model, d.name, JSON.stringify(d.specs), d.warranty, d.is_active],
        );
        await tx.query('INSERT INTO product_prices (product_id, list_price, sale_price) VALUES ($1, $2, $3)', [id, d.list_price, d.sale_price]);
        await tx.query('INSERT INTO inventory (store_id, product_id) SELECT store_id, $1 FROM stores', [id]);
        created.push(id);
      } else if (r.action === 'update') {
        const [before] = await tx.query(
          `SELECT p.name, p.category, p.brand, p.warranty, p.is_active, p.specs, pr.list_price, pr.sale_price
           FROM products p LEFT JOIN product_prices pr ON pr.product_id = p.product_id AND pr.valid_to IS NULL
           WHERE p.product_id = $1 FOR UPDATE OF p`,
          [r.product_id],
        );
        await tx.query(
          `UPDATE products SET name = $2, category = $3, brand = $4, warranty = $5, is_active = $6, specs = $7, updated_at = now()
           WHERE product_id = $1`,
          [r.product_id, d.name, d.category, d.brand, d.warranty, d.is_active, JSON.stringify(d.specs)],
        );
        if (before.list_price !== d.list_price || before.sale_price !== d.sale_price) {
          await tx.query('UPDATE product_prices SET valid_to = now() WHERE product_id = $1 AND valid_to IS NULL', [r.product_id]);
          await tx.query('INSERT INTO product_prices (product_id, list_price, sale_price) VALUES ($1, $2, $3)', [r.product_id, d.list_price, d.sale_price]);
        }
        updated.push({ product_id: r.product_id, before });
      }
    }

    const [batch] = await tx.query(
      `INSERT INTO import_batches (type, filename, row_count, created_count, updated_count, details)
       VALUES ('products', $1, $2, $3, $4, $5) RETURNING id`,
      [filename, results.length, created.length, updated.length, JSON.stringify({ created, updated })],
    );
    return { batch_id: batch.id, summary, created, updated: updated.map((u) => u.product_id) };
  });
  res.json({
    ok: true,
    ...result,
    message: `匯入完成：新增 ${result.created.length} 項、更新 ${result.updated.length} 項${result.summary.unchanged ? `，${result.summary.unchanged} 項沒有變更` : ''}`,
  });
});

router.get('/import/batches', async (req, res) => {
  const batches = await query(
    `SELECT id, type, filename, row_count, created_count, updated_count, status, created_at, undone_at
     FROM import_batches WHERE type = $1 ORDER BY id DESC LIMIT 10`,
    [req.query.type || 'products'],
  );
  const latest = batches.find((b) => b.status === 'done');
  res.json({ ok: true, batches: batches.map((b) => ({ ...b, can_undo: b === latest })) });
});

// 復原：只能復原「最近一次」還沒復原的匯入，避免前後批次互相影響
router.post('/import/batches/:id/undo', async (req, res) => {
  const message = await transaction(async (tx) => {
    const [latest] = await tx.query(
      `SELECT * FROM import_batches WHERE status = 'done' AND type = 'products' ORDER BY id DESC LIMIT 1 FOR UPDATE`,
    );
    if (!latest || String(latest.id) !== String(req.params.id)) {
      throw new HttpError(409, '只能復原最近一次的匯入');
    }
    const { created = [], updated = [] } = latest.details ?? {};

    // 新增的商品：如果已經有人進貨、下單、調貨，就不能直接刪掉
    for (const id of created) {
      const [used] = await tx.query(
        `SELECT
           (SELECT count(*)::int FROM order_items WHERE product_id = $1) +
           (SELECT count(*)::int FROM stock_transfers WHERE product_id = $1) +
           (SELECT count(*)::int FROM inventory_transactions WHERE product_id = $1) +
           (SELECT count(*)::int FROM inventory WHERE product_id = $1 AND (on_hand + reserved + display + damaged + in_transit) > 0) +
           (SELECT count(*)::int FROM products WHERE replaced_by = $1) AS n`,
        [id],
      );
      if (used.n > 0) throw new HttpError(409, `商品 ${id} 匯入後已經有庫存、訂單或調貨紀錄，無法復原這次匯入`);
    }
    for (const id of created) {
      await tx.query('DELETE FROM inventory WHERE product_id = $1', [id]);
      await tx.query('DELETE FROM product_prices WHERE product_id = $1', [id]);
      await tx.query('DELETE FROM products WHERE product_id = $1', [id]);
    }

    // 更新的商品：還原成匯入前的樣子（價格改回去會留下一筆新的價格歷史）
    for (const { product_id: id, before } of updated) {
      await tx.query(
        `UPDATE products SET name = $2, category = $3, brand = $4, warranty = $5, is_active = $6, specs = $7, updated_at = now()
         WHERE product_id = $1`,
        [id, before.name, before.category, before.brand, before.warranty, before.is_active, JSON.stringify(before.specs ?? {})],
      );
      const [now] = await tx.query('SELECT list_price, sale_price FROM product_prices WHERE product_id = $1 AND valid_to IS NULL', [id]);
      if (before.list_price != null && (!now || now.list_price !== before.list_price || now.sale_price !== before.sale_price)) {
        await tx.query('UPDATE product_prices SET valid_to = now() WHERE product_id = $1 AND valid_to IS NULL', [id]);
        await tx.query('INSERT INTO product_prices (product_id, list_price, sale_price) VALUES ($1, $2, $3)', [id, before.list_price, before.sale_price]);
      }
    }
    await tx.query(`UPDATE import_batches SET status = 'undone', undone_at = now() WHERE id = $1`, [latest.id]);
    return `已復原第 ${latest.id} 次匯入：刪除 ${created.length} 項新增的商品、還原 ${updated.length} 項更新`;
  });
  res.json({ ok: true, message });
});

export default router;
