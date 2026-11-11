import { Router } from 'express';
import { query } from '../db/index.js';
import { STORE_ORDER_SQL } from '../regions.js';

const router = Router();

const STORE_LOW = 2; // 跟門市庫存頁一致：單店可售 ≤ 2 為偏低
const AVAILABLE = '(i.on_hand - i.reserved - i.display - i.damaged)';

// 營運儀表板需要的數字，一次算好
router.get('/analytics', async (req, res) => {
  const [kpis] = await query(`
    SELECT
      (SELECT COALESCE(SUM(total), 0)::bigint FROM orders WHERE status IN ('shipped', 'completed')) AS revenue,
      (SELECT count(*)::int FROM orders WHERE status IN ('shipped', 'completed')) AS revenue_orders,
      (SELECT COALESCE(SUM(total), 0)::bigint FROM orders WHERE status = 'reserved') AS reserved_value,
      (SELECT count(*)::int FROM orders WHERE status = 'reserved') AS reserved_orders,
      (SELECT COALESCE(SUM(i.on_hand * pr.sale_price), 0)::bigint
         FROM inventory i JOIN product_prices pr ON pr.product_id = i.product_id AND pr.valid_to IS NULL) AS inventory_value,
      (SELECT COALESCE(SUM(on_hand), 0)::int FROM inventory) AS inventory_units,
      (SELECT count(*)::int FROM inventory i JOIN products p ON p.product_id = i.product_id
         WHERE p.is_active AND ${AVAILABLE} <= 0) AS out_cells,
      (SELECT count(*)::int FROM inventory i JOIN products p ON p.product_id = i.product_id WHERE p.is_active) AS total_cells
  `);

  // 各分類：可售件數與庫存價值（實體 × 售價）
  const categories = await query(`
    SELECT p.category,
           COALESCE(SUM(${AVAILABLE}), 0)::int AS available,
           COALESCE(SUM(i.on_hand * pr.sale_price), 0)::bigint AS value
    FROM products p
    JOIN inventory i ON i.product_id = p.product_id
    JOIN product_prices pr ON pr.product_id = p.product_id AND pr.valid_to IS NULL
    WHERE p.is_active
    GROUP BY p.category ORDER BY value DESC
  `);

  // 各門市庫存健康：上架商品在這家店是正常／偏低／缺貨
  const storeHealth = await query(`
    SELECT s.store_id, s.name, s.region,
           count(*) FILTER (WHERE ${AVAILABLE} > ${STORE_LOW})::int AS ok,
           count(*) FILTER (WHERE ${AVAILABLE} BETWEEN 1 AND ${STORE_LOW})::int AS low,
           count(*) FILTER (WHERE ${AVAILABLE} <= 0)::int AS out
    FROM stores s
    JOIN inventory i ON i.store_id = s.store_id
    JOIN products p ON p.product_id = i.product_id AND p.is_active
    GROUP BY s.store_id, s.name, s.region
    ORDER BY ${STORE_ORDER_SQL('s')}
  `);

  // 各門市訂單金額（不含取消）
  const storeSales = await query(`
    SELECT s.store_id, s.name, COALESCE(SUM(o.total), 0)::bigint AS total, count(o.order_no)::int AS orders
    FROM stores s LEFT JOIN orders o ON o.store_id = s.store_id AND o.status <> 'cancelled'
    GROUP BY s.store_id, s.name
    ORDER BY total DESC, ${STORE_ORDER_SQL('s')}
  `);

  const orderStatus = await query(`
    SELECT status, count(*)::int AS count, COALESCE(SUM(total), 0)::bigint AS total
    FROM orders GROUP BY status
  `);

  // 熱銷商品：不含取消的訂單
  const topProducts = await query(`
    SELECT oi.product_id, p.name, SUM(oi.qty)::int AS qty, SUM(oi.qty * oi.unit_price)::bigint AS revenue
    FROM order_items oi JOIN orders o ON o.order_no = oi.order_no JOIN products p ON p.product_id = oi.product_id
    WHERE o.status <> 'cancelled'
    GROUP BY oi.product_id, p.name
    ORDER BY qty DESC, revenue DESC LIMIT 5
  `);

  // bigint 轉成一般數字（金額不會超過 JS 安全整數）
  const num = (rows, keys) => rows.map((r) => ({ ...r, ...Object.fromEntries(keys.map((k) => [k, Number(r[k])])) }));
  res.json({
    ok: true,
    store_low: STORE_LOW,
    kpis: Object.fromEntries(Object.entries(kpis).map(([k, v]) => [k, Number(v)])),
    categories: num(categories, ['value']),
    store_health: storeHealth,
    store_sales: num(storeSales, ['total']),
    order_status: num(orderStatus, ['total']),
    top_products: num(topProducts, ['revenue']),
  });
});

export default router;
