import { Router } from 'express';
import { query, transaction } from '../db/index.js';
import { REGIONS, STORE_ORDER_SQL } from '../regions.js';
import { BRANDS, SPEC_TEMPLATES, validateBrand, validateSpecs } from '../specTemplates.js';

const router = Router();

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function checkSpecs(category, specs) {
  try {
    return validateSpecs(category, specs);
  } catch (err) {
    throw new HttpError(400, err.message);
  }
}

function checkBrand(category, brand) {
  try {
    return validateBrand(category, brand);
  } catch (err) {
    throw new HttpError(400, err.message);
  }
}

// 各分類的規格欄位與品牌清單（前端表單用）
router.get('/catalog-config', (req, res) => {
  res.json({ ok: true, templates: SPEC_TEMPLATES, brands: BRANDS });
});

// 目前價格 + 全門市可售總數
const PRODUCT_LIST_SQL = `
  SELECT p.product_id, p.category, p.brand, p.model, p.name, p.warranty, p.is_active, p.replaced_by,
         pr.list_price, pr.sale_price,
         COALESCE(SUM(i.on_hand - i.reserved - i.display - i.damaged), 0)::int AS available,
         COALESCE(SUM(i.in_transit), 0)::int AS in_transit
  FROM products p
  LEFT JOIN product_prices pr ON pr.product_id = p.product_id AND pr.valid_to IS NULL
  LEFT JOIN inventory i ON i.product_id = p.product_id
`;

router.get('/categories', async (req, res) => {
  const rows = await query('SELECT category, count(*)::int AS count FROM products GROUP BY category ORDER BY category');
  res.json({ ok: true, categories: rows });
});

router.get('/stores', async (req, res) => {
  const rows = await query(`SELECT * FROM stores s ORDER BY ${STORE_ORDER_SQL('s')}`);
  const regions = REGIONS.filter((r) => rows.some((s) => s.region === r));
  res.json({ ok: true, stores: rows, regions });
});

router.get('/stats', async (req, res) => {
  const [stats] = await query(`
    SELECT
      (SELECT count(*)::int FROM products) AS products,
      (SELECT count(*)::int FROM products WHERE is_active) AS active_products,
      (SELECT count(*)::int FROM stores) AS stores,
      (SELECT COALESCE(SUM(on_hand - reserved - display - damaged), 0)::int FROM inventory) AS available_units,
      (SELECT count(*)::int FROM stock_transfers WHERE status = 'in_transit') AS transfers_in_transit,
      (SELECT count(*)::int FROM (
         SELECT i.product_id FROM inventory i JOIN products p USING (product_id)
         WHERE p.is_active GROUP BY i.product_id
         HAVING SUM(i.on_hand - i.reserved - i.display - i.damaged) <= 5) low) AS low_stock_products
  `);
  res.json({ ok: true, stats });
});

router.get('/products', async (req, res) => {
  const { q = '', category = '', brand = '', status = 'all' } = req.query;
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
  if (brand) {
    params.push(brand);
    where.push(`p.brand = $${params.length}`);
  }
  if (status === 'active') where.push('p.is_active');
  if (status === 'inactive') where.push('NOT p.is_active');

  const rows = await query(
    `${PRODUCT_LIST_SQL} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     GROUP BY p.product_id, pr.list_price, pr.sale_price
     ORDER BY p.product_id`,
    params,
  );
  res.json({ ok: true, products: rows });
});

async function loadProduct(id, q = query) {
  const [product] = await q(`${PRODUCT_LIST_SQL} WHERE p.product_id = $1 GROUP BY p.product_id, pr.list_price, pr.sale_price`, [id]);
  if (!product) throw new HttpError(404, '找不到這個商品');
  const [detail] = await q('SELECT specs, image_url FROM products WHERE product_id = $1', [id]);
  const prices = await q(
    'SELECT list_price, sale_price, valid_from, valid_to FROM product_prices WHERE product_id = $1 ORDER BY valid_from DESC',
    [id],
  );
  const inventory = await q(
    `SELECT s.store_id, s.name AS store_name, s.region, i.on_hand, i.reserved, i.display, i.damaged, i.in_transit,
            (i.on_hand - i.reserved - i.display - i.damaged) AS available
     FROM stores s LEFT JOIN inventory i ON i.store_id = s.store_id AND i.product_id = $1
     ORDER BY ${STORE_ORDER_SQL('s')}`,
    [id],
  );
  const movements = await q(
    `SELECT t.id, t.type, t.qty, t.qty_change, t.available_after, t.note, t.created_at, s.name AS store_name
     FROM inventory_transactions t JOIN stores s ON s.store_id = t.store_id
     WHERE t.product_id = $1 ORDER BY t.created_at DESC, t.id DESC LIMIT 10`,
    [id],
  );
  const replacedBy = product.replaced_by
    ? (await q('SELECT product_id, name, model FROM products WHERE product_id = $1', [product.replaced_by]))[0]
    : null;
  return { ...product, ...detail, prices, inventory, movements, replaced_by_product: replacedBy };
}

router.get('/products/:id', async (req, res) => {
  res.json({ ok: true, product: await loadProduct(req.params.id) });
});

function readProductBody(body, { partial = false } = {}) {
  const text = (v) => (typeof v === 'string' ? v.trim() : '');
  const out = {};
  for (const field of ['name', 'brand', 'model', 'category']) {
    if (partial && body[field] === undefined) continue;
    const value = text(body[field]);
    if (!value) throw new HttpError(400, `請填寫${{ name: '品名', brand: '品牌', model: '型號', category: '分類' }[field]}`);
    out[field] = value;
  }
  if (!partial || body.warranty !== undefined) out.warranty = text(body.warranty) || null;
  if (!partial || body.is_active !== undefined) out.is_active = body.is_active !== false;
  if (out.category && !SPEC_TEMPLATES[out.category]) {
    throw new HttpError(400, `分類必須是：${Object.keys(SPEC_TEMPLATES).join('、')}`);
  }
  // 品牌、規格要依分類檢查；新增時在這裡檢查，修改時要等讀到原本的分類才檢查
  if (!partial) {
    checkBrand(out.category, out.brand);
    out.specs = checkSpecs(out.category, body.specs ?? {});
  }
  else if (body.specs !== undefined) out.specs = body.specs;
  if (!partial || body.list_price !== undefined || body.sale_price !== undefined) {
    const list = Number(body.list_price);
    const sale = Number(body.sale_price);
    if (!Number.isInteger(list) || list < 0) throw new HttpError(400, '原價必須是 0 以上的整數');
    if (!Number.isInteger(sale) || sale < 0) throw new HttpError(400, '售價必須是 0 以上的整數');
    if (sale > list) throw new HttpError(400, '售價不能高於原價');
    out.list_price = list;
    out.sale_price = sale;
  }
  return out;
}

function translateDbError(err) {
  if (err.code === '23505') return new HttpError(409, '這個型號已經存在');
  return err;
}

router.post('/products', async (req, res) => {
  const data = readProductBody(req.body ?? {});
  try {
    const product = await transaction(async (tx) => {
      const [{ next }] = await tx.query(
        `SELECT COALESCE(MAX(substring(product_id from 2)::int), 0) + 1 AS next FROM products WHERE product_id ~ '^P[0-9]+$'`,
      );
      const id = `P${String(next).padStart(4, '0')}`;
      await tx.query(
        `INSERT INTO products (product_id, category, brand, model, name, specs, warranty, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, data.category, data.brand, data.model, data.name, JSON.stringify(data.specs), data.warranty, data.is_active],
      );
      await tx.query('INSERT INTO product_prices (product_id, list_price, sale_price) VALUES ($1, $2, $3)', [
        id, data.list_price, data.sale_price,
      ]);
      // 新商品在每家門市先建立 0 庫存
      await tx.query('INSERT INTO inventory (store_id, product_id) SELECT store_id, $1 FROM stores', [id]);
      return loadProduct(id, tx.query);
    });
    res.status(201).json({ ok: true, product });
  } catch (err) {
    throw translateDbError(err);
  }
});

router.put('/products/:id', async (req, res) => {
  const data = readProductBody(req.body ?? {}, { partial: true });
  try {
    const product = await transaction(async (tx) => {
      const current = await loadProduct(req.params.id, tx.query);
      // 換分類、改品牌或改規格時，用（新的）分類重新檢查
      if ('category' in data || 'brand' in data) {
        checkBrand(data.category ?? current.category, data.brand ?? current.brand);
      }
      if ('category' in data || 'specs' in data) {
        data.specs = checkSpecs(data.category ?? current.category, data.specs ?? current.specs);
      }
      const fields = ['category', 'brand', 'model', 'name', 'warranty', 'is_active', 'specs'].filter((f) => f in data);
      if (fields.length) {
        const sets = fields.map((f, i) => `${f} = $${i + 2}`);
        const values = fields.map((f) => (f === 'specs' ? JSON.stringify(data[f]) : data[f]));
        await tx.query(`UPDATE products SET ${sets.join(', ')}, updated_at = now() WHERE product_id = $1`, [req.params.id, ...values]);
      }
      // 價格有變才新增一筆價格歷史
      if ('list_price' in data && (data.list_price !== current.list_price || data.sale_price !== current.sale_price)) {
        await tx.query('UPDATE product_prices SET valid_to = now() WHERE product_id = $1 AND valid_to IS NULL', [req.params.id]);
        await tx.query('INSERT INTO product_prices (product_id, list_price, sale_price) VALUES ($1, $2, $3)', [
          req.params.id, data.list_price, data.sale_price,
        ]);
      }
      return loadProduct(req.params.id, tx.query);
    });
    res.json({ ok: true, product });
  } catch (err) {
    throw translateDbError(err);
  }
});

export { HttpError };
export default router;
