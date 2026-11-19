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

// 前台需求訊號：3D 坪數選購頁的試算紀錄與報價／預約單
const CAT_LABEL = { ac: '冷氣', ap: '空氣清淨機', dh: '除濕機' };
// 冷氣修正後需求坪數 → 官網級距（與 3D 頁、商品規格一致）
const AC_BUCKETS = ['3-4 坪', '4-5 坪', '5-6 坪', '6-7 坪', '7-8 坪', '8-10 坪', '11-12 坪', '13 坪以上'];
const AC_BUCKET_SQL = `CASE
  WHEN eff_ping <= 4 THEN '3-4 坪' WHEN eff_ping <= 5 THEN '4-5 坪' WHEN eff_ping <= 6 THEN '5-6 坪'
  WHEN eff_ping <= 7 THEN '6-7 坪' WHEN eff_ping <= 8 THEN '7-8 坪' WHEN eff_ping <= 10 THEN '8-10 坪'
  WHEN eff_ping <= 12 THEN '11-12 坪' ELSE '13 坪以上' END`;

router.get('/analytics/demand', async (req, res) => {
  const days = Math.min(Math.max(Math.round(Number(req.query.days)) || 56, 7), 365);
  const since = `now() - make_interval(days => ${days})`;

  const [totals] = await query(`
    SELECT count(*)::int AS records,
           count(DISTINCT session)::int AS sessions,
           count(*) FILTER (WHERE fit = 'low')::int AS low,
           count(*) FILTER (WHERE category = 'ac' AND (west OR top_floor))::int AS ac_harsh,
           count(*) FILTER (WHERE category = 'ac')::int AS ac
    FROM fit_sessions WHERE created_at >= ${since}`);

  // 每週各類別試算次數（看趨勢）
  const weekly = await query(`
    SELECT to_char(date_trunc('week', created_at AT TIME ZONE 'Asia/Taipei'), 'MM/DD') AS week,
           count(*) FILTER (WHERE category = 'ac')::int AS ac,
           count(*) FILTER (WHERE category = 'ap')::int AS ap,
           count(*) FILTER (WHERE category = 'dh')::int AS dh
    FROM fit_sessions WHERE created_at >= ${since}
    GROUP BY date_trunc('week', created_at AT TIME ZONE 'Asia/Taipei'), 1
    ORDER BY date_trunc('week', created_at AT TIME ZONE 'Asia/Taipei')`);

  // 冷氣需求坪數分布（修正後），依級距順序補齊
  const acRows = await query(`
    SELECT ${AC_BUCKET_SQL} AS bucket, count(*)::int AS count, count(*) FILTER (WHERE fit = 'low')::int AS low
    FROM fit_sessions WHERE category = 'ac' AND created_at >= ${since}
    GROUP BY 1`);
  const acBuckets = AC_BUCKETS.map((b) => acRows.find((r) => r.bucket === b) ?? { bucket: b, count: 0, low: 0 });

  // 各區域（依顧客選的門市；沒選門市的歸「未指定門市」）
  const regions = await query(`
    SELECT COALESCE(s.region, '未指定門市') AS region,
           count(*) FILTER (WHERE f.category = 'ac')::int AS ac,
           count(*) FILTER (WHERE f.category = 'ap')::int AS ap,
           count(*) FILTER (WHERE f.category = 'dh')::int AS dh
    FROM fit_sessions f LEFT JOIN stores s ON s.store_id = f.store_id
    WHERE f.created_at >= ${since}
    GROUP BY 1
    ORDER BY array_position(ARRAY['北區','中區','南區','東區','未指定門市']::text[], COALESCE(s.region, '未指定門市'))`);

  // 被看最多的機型 + 目前全部門市庫存 + 報價／預約次數：看得多、庫存少 → 備貨提醒
  const topViewed = await query(`
    SELECT f.product_id, p.name, p.category, count(*)::int AS views,
           (SELECT COALESCE(SUM(GREATEST(i.on_hand - i.reserved - i.display - i.damaged, 0)), 0)::int
              FROM inventory i WHERE i.product_id = f.product_id) AS available,
           (SELECT count(*)::int FROM service_requests r WHERE r.product_id = f.product_id AND r.created_at >= ${since}) AS requests
    FROM fit_sessions f JOIN products p ON p.product_id = f.product_id
    WHERE f.created_at >= ${since}
    GROUP BY f.product_id, p.name, p.category
    ORDER BY views DESC, f.product_id LIMIT 8`);

  const requests = await query(`
    SELECT type, status, count(*)::int AS count, count(order_no)::int AS converted
    FROM service_requests WHERE created_at >= ${since}
    GROUP BY type, status`);

  res.json({ ok: true, days, category_labels: CAT_LABEL, totals, weekly, ac_buckets: acBuckets, regions, top_viewed: topViewed, requests });
});

export default router;
