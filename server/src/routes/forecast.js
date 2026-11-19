// 06 需求預測與補貨 API（目前做冷氣）
import { Router } from 'express';
import { query } from '../db/index.js';
import { AC_TIERS } from '../db/demoHistory.js';
import { backtest, classify, plan, runForecast, SERVICE_LEVEL, transfers } from '../forecast/engine.js';
import { STORE_ORDER_SQL } from '../regions.js';

const router = Router();
const sum = (a) => a.reduce((s, x) => s + x, 0);

async function loadData() {
  const stores = await query(`SELECT store_id, name, region, city, store_type FROM stores s ORDER BY ${STORE_ORDER_SQL('s')}`);
  const hist = await query(`SELECT month, store_id, tier, units FROM sales_history WHERE category = '冷氣' ORDER BY month`);
  const months = [...new Set(hist.map((h) => h.month))].sort();
  const mi = new Map(months.map((m, i) => [m, i]));
  const history = new Map();
  for (const h of hist) {
    const key = `${h.store_id}|${h.tier}`;
    if (!history.has(key)) history.set(key, months.map(() => 0));
    history.get(key)[mi.get(h.month)] = h.units;
  }
  const weather = new Map((await query('SELECT month, region, avg_temp FROM weather_monthly')).map((w) => [`${w.month}|${w.region}`, Number(w.avg_temp)]));
  const events = await query('SELECT id, name, type, category, start_month, end_month, uplift, note FROM demand_events ORDER BY start_month, id');

  // 目前庫存與在途：門市 × 坪數級距（上架中的冷氣加總）
  const pos = await query(
    `SELECT i.store_id, p.specs->>'適用坪數' AS tier,
            SUM(GREATEST(i.on_hand - i.reserved - i.display - i.damaged, 0))::int AS available, SUM(i.in_transit)::int AS in_transit
     FROM inventory i JOIN products p ON p.product_id = i.product_id
     WHERE p.category = '冷氣' AND p.is_active GROUP BY 1, 2`,
  );
  const position = new Map(pos.map((p) => [`${p.store_id}|${p.tier}`, { available: p.available, in_transit: p.in_transit }]));

  // 各級距平均售價、交期（依該級距各品牌的機型數加權）
  const tierInfo = await query(
    `SELECT p.specs->>'適用坪數' AS tier, round(avg(pr.sale_price))::int AS price,
            SUM(COALESCE(l.lead_days, 10)) / count(*) AS lead_days, SUM(COALESCE(l.lead_sd_days, 3)) / count(*) AS lead_sd,
            count(*)::int AS skus
     FROM products p JOIN product_prices pr ON pr.product_id = p.product_id AND pr.valid_to IS NULL
     LEFT JOIN brand_lead_times l ON l.brand = p.brand
     WHERE p.category = '冷氣' AND p.is_active GROUP BY 1`,
  );
  const priceByTier = Object.fromEntries(tierInfo.map((t) => [t.tier, t.price]));
  const leadByTier = Object.fromEntries(tierInfo.map((t) => [t.tier, { days: Math.round(Number(t.lead_days) * 10) / 10, sd: Math.round(Number(t.lead_sd) * 10) / 10 }]));

  // 3D 坪數選購的領先指標：各區近 28 天冷氣試算＋場勘預約，跟前 28 天比
  const lead = await query(
    `WITH x AS (
       SELECT s.region, f.created_at FROM fit_sessions f JOIN stores s ON s.store_id = f.store_id WHERE f.category = 'ac'
       UNION ALL
       SELECT s.region, r.created_at FROM service_requests r JOIN stores s ON s.store_id = r.store_id WHERE r.type = 'survey')
     SELECT region, count(*) FILTER (WHERE created_at >= now() - interval '28 days')::int AS recent,
            count(*) FILTER (WHERE created_at < now() - interval '28 days' AND created_at >= now() - interval '56 days')::int AS prior
     FROM x GROUP BY region`,
  );
  const leading = Object.fromEntries(lead.map((l) => [l.region, (l.recent + 1) / (l.prior + 1)]));
  const leadingRows = lead.map((l) => ({ ...l, ratio: Math.round(((l.recent + 1) / (l.prior + 1)) * 100) / 100 }));

  const leadTimes = await query('SELECT brand, lead_days, lead_sd_days, note FROM brand_lead_times ORDER BY lead_days, brand');
  return { stores, months, history, weather, events, position, priceByTier, leadByTier, leading, leadingRows, tierInfo, leadTimes, tiers: AC_TIERS };
}

router.get('/forecast', async (req, res) => {
  const data = await loadData();
  if (data.months.length < 24) {
    return res.json({ ok: true, empty: true, message: '銷售歷史不足 24 個月，無法建立季節性預測' });
  }
  const tempDelta = Math.max(-3, Math.min(3, Number(req.query.temp_delta) || 0));
  const useLeading = req.query.leading === '1';
  const run = runForecast(data, { horizon: 12, tempDelta, useLeading });
  const cls = classify(run.series, data.priceByTier);
  const rows = plan(run, data, cls);
  const moves = transfers(rows);
  // 調入的數量可以少向供應商訂；調出的門市本來就有多，不影響它自己的需求
  const inQty = {};
  for (const m of moves) inQty[`${m.to_store_id}|${m.tier}`] = (inQty[`${m.to_store_id}|${m.tier}`] ?? 0) + m.qty;
  for (const r of rows) {
    r.transfer_in = inQty[`${r.store_id}|${r.tier}`] ?? 0;
    r.transfer_out = moves.filter((m) => m.from_store_id === r.store_id && m.tier === r.tier).reduce((s, m) => s + m.qty, 0);
    r.order_qty = r.need_month ? Math.max(0, r.suggested_qty - r.transfer_in) : 0;
  }

  // 篩選範圍：全部／區域／門市
  const region = req.query.region || '';
  const store = req.query.store || '';
  const inScope = (r) => (store ? r.store_id === store : region ? r.region === region : true);
  const scoped = run.series.filter(inScope);
  const scopedRows = rows.filter(inScope);

  const T = data.months.length;
  const actual = data.months.map((_, t) => sum(scoped.map((s) => s.actual[t])));
  const fitted = data.months.map((_, t) => Math.round(sum(scoped.map((s) => s.fitted[t]))));
  const forecast = run.future.map((_, h) => sum(scoped.map((s) => s.forecast[h])));
  const sigma = Math.sqrt(sum(scoped.map((s) => s.sigma ** 2)));
  const byTier = data.tiers.map((tier) => ({
    tier,
    last12: sum(scoped.filter((s) => s.tier === tier).flatMap((s) => s.actual.slice(-12))),
    forecast: run.future.map((_, h) => Math.round(sum(scoped.filter((s) => s.tier === tier).map((s) => s.forecast[h])))),
  }));
  const storeName = Object.fromEntries(data.stores.map((s) => [s.store_id, s.name]));

  const bt = backtest(data, 6);
  const matrix = {};
  for (const r of scopedRows) matrix[`${r.abc}${r.xyz}`] = (matrix[`${r.abc}${r.xyz}`] ?? 0) + 1;

  res.json({
    ok: true,
    category: '冷氣',
    simulated: true,
    months: data.months,
    future: run.future,
    stores: data.stores,
    regions: [...new Set(data.stores.map((s) => s.region))],
    scope: { region, store },
    chart: {
      actual,
      fitted,
      forecast: forecast.map((x) => Math.round(x)),
      // 80% 預測區間：±1.28σ，越後面的月份不確定性越大
      lower: forecast.map((x, h) => Math.max(0, Math.round(x - 1.28 * sigma * Math.sqrt(1 + h / 3)))),
      upper: forecast.map((x, h) => Math.round(x + 1.28 * sigma * Math.sqrt(1 + h / 3))),
    },
    by_tier: byTier,
    model: {
      method: '季節分解＋門市水準指數平滑',
      seasonal_index: Object.fromEntries(Object.entries(run.regionModel).map(([r, m]) => [r, m.S.map((x) => Math.round(x * 100) / 100)])),
      yearly_growth: Object.fromEntries(Object.entries(run.regionModel).map(([r, m]) => [r, Math.round(((1 + m.g) ** 12 - 1) * 1000) / 10])),
      temp_elasticity: Math.round(run.tempElasticity * 1000) / 1000,
      temp_delta: tempDelta,
      use_leading: useLeading,
      service_levels: SERVICE_LEVEL,
    },
    backtest: {
      months: bt.months,
      wape_model: Math.round(bt.wape_model * 1000) / 10,
      wape_naive: Math.round(bt.wape_naive * 1000) / 10,
      wape_total_model: Math.round(bt.wape_total_model * 1000) / 10,
      wape_total_naive: Math.round(bt.wape_total_naive * 1000) / 10,
      total_actual: bt.total_actual,
      total_model: bt.total_model.map(Math.round),
      total_naive: bt.total_naive,
    },
    plan: scopedRows.map((r) => ({ ...r, store_name: storeName[r.store_id] })),
    abc_xyz: matrix,
    transfers: moves.filter((m) => inScope({ store_id: m.to_store_id, region: m.region }) || (store && m.from_store_id === store))
      .map((m) => ({ ...m, from_name: storeName[m.from_store_id], to_name: storeName[m.to_store_id] })),
    events: data.events,
    lead_times: data.leadTimes,
    leading: data.leadingRows,
    tier_info: data.tierInfo,
    history_end: data.months[T - 1],
  });
});

export default router;
