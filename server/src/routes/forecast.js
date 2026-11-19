// 06 需求預測與補貨 API（目前做冷氣）
import { Router } from 'express';
import { query, transaction } from '../db/index.js';
import { AC_TIERS, addMonths, createDemoHistory } from '../db/demoHistory.js';
import { backtest, classify, plan, runForecast, SERVICE_LEVEL, transfers } from '../forecast/engine.js';
import { checkHistory, validateSales } from '../forecast/salesImport.js';
import { STORE_ORDER_SQL } from '../regions.js';

const router = Router();
const sum = (a) => a.reduce((s, x) => s + x, 0);

// 匯入的資料存在哪裡：
// db      ＝ 寫進資料庫（本機版；資料只在自己的電腦）
// browser ＝ 只存在使用者自己的瀏覽器，每次計算時送來（公開的線上版：真實資料不進共用資料庫，也不會蓋掉別人看到的畫面）
export const IMPORT_MODE = process.env.FORECAST_IMPORT_MODE || (process.env.DEMO_RESET_ON_START === 'true' ? 'browser' : 'db');

// override：瀏覽器模式送來的 { history: [[month, store_id, tier, units]], source }
async function loadData(override) {
  const allStores = await query(`SELECT store_id, name, region, city, store_type FROM stores s ORDER BY ${STORE_ORDER_SQL('s')}`);
  let hist;
  let source;
  if (override) {
    hist = override.history.map(([month, store_id, tier, units]) => ({ month, store_id, tier, units }));
    const o = override.source ?? {};
    source = { kind: 'browser', filename: String(o.filename ?? '').slice(0, 120), imported_at: o.imported_at ?? null };
  } else {
    hist = await query(`SELECT month, store_id, tier, units FROM sales_history WHERE category = '冷氣' ORDER BY month`);
    const [row] = await query(`SELECT * FROM forecast_sources WHERE category = '冷氣'`);
    source = row ? { kind: 'db', filename: row.filename, imported_at: row.imported_at } : { kind: 'demo' };
  }
  // 匯入的資料只算有出現的門市（沒資料的門市不要出現一堆 0）
  const present = new Set(hist.map((h) => h.store_id));
  const stores = source.kind === 'demo' ? allStores : allStores.filter((s) => present.has(s.store_id));
  // 月份補成連續（中間缺的月份是 0）
  const seen = [...new Set(hist.map((h) => h.month))].sort();
  const months = [];
  if (seen.length) for (let m = seen[0]; m <= seen.at(-1); m = addMonths(m, 1)) months.push(m);
  const mi = new Map(months.map((m, i) => [m, i]));
  const history = new Map();
  for (const s of stores) for (const tier of AC_TIERS) history.set(`${s.store_id}|${tier}`, months.map(() => 0));
  for (const h of hist) {
    const arr = history.get(`${h.store_id}|${h.tier}`);
    if (arr) arr[mi.get(h.month)] += h.units;
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
  return { stores, months, history, weather, events, position, priceByTier, leadByTier, leading, leadingRows, tierInfo, leadTimes, tiers: AC_TIERS, source };
}

async function forecastHandler(req, res) {
  const override = req.method === 'POST' && req.body?.history ? { history: await checkHistory(req.body.history), source: req.body.source } : null;
  const data = await loadData(override);
  if (data.months.length < 24) {
    return res.json({ ok: true, empty: true, source: data.source, import_mode: IMPORT_MODE, message: '銷售歷史不足 24 個月，無法建立季節性預測' });
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
    simulated: data.source.kind === 'demo',
    source: { ...data.source, month_from: data.months[0], month_to: data.months.at(-1), store_count: data.stores.length },
    import_mode: IMPORT_MODE,
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
}
router.get('/forecast', forecastHandler);
router.post('/forecast', forecastHandler); // 瀏覽器模式：帶著匯入的資料來算

// ===== 匯入真實銷售資料 =====
// 前端讀好試算表後送來 { rows: [{ row, month, store, model, tier, units, category }] }
router.post('/import/sales/preview', async (req, res) => {
  const { history, ...result } = await validateSales(req.body?.rows);
  res.json({ ok: true, import_mode: IMPORT_MODE, ...result });
});

router.post('/import/sales/commit', async (req, res) => {
  const result = await validateSales(req.body?.rows);
  if (!result.can_import) return res.status(400).json({ ok: false, error: result.block_reason });
  if (result.summary.error_rows && !req.body.skip_errors) {
    return res.status(400).json({ ok: false, error: `有 ${result.summary.error_rows} 列資料有問題，請修正，或勾選「略過有問題的列」` });
  }
  const filename = String(req.body.filename ?? '').slice(0, 120);
  const s = result.summary;
  const message = `已匯入 ${s.month_from}～${s.month_to}（${s.month_count} 個月）、${s.store_count} 間門市、共 ${s.total_units.toLocaleString()} 台`;
  if (IMPORT_MODE === 'browser') {
    // 不存進共用資料庫，整理好的資料交給瀏覽器保存
    return res.json({ ok: true, mode: 'browser', message, history: result.history, source: { filename, imported_at: new Date().toISOString() } });
  }
  await transaction(async (tx) => {
    await tx.query(`DELETE FROM sales_history WHERE category = '冷氣'`);
    const cols = [0, 1, 2, 3].map((i) => result.history.map((h) => h[i]));
    await tx.query(
      `INSERT INTO sales_history (month, store_id, category, tier, units)
       SELECT m, s, '冷氣', t, u FROM unnest($1::text[], $2::text[], $3::text[], $4::int[]) AS x(m, s, t, u)`,
      cols,
    );
    await tx.query(
      `INSERT INTO forecast_sources (category, filename, rows_used, month_from, month_to, store_count, imported_at)
       VALUES ('冷氣', $1, $2, $3, $4, $5, now())
       ON CONFLICT (category) DO UPDATE SET filename = $1, rows_used = $2, month_from = $3, month_to = $4, store_count = $5, imported_at = now()`,
      [filename, s.used_rows, s.month_from, s.month_to, s.store_count],
    );
  });
  res.json({ ok: true, mode: 'db', message });
});

// 還原成示範用的模擬銷售資料（資料庫模式）
router.post('/forecast/restore-demo', async (req, res) => {
  if (IMPORT_MODE !== 'db') return res.json({ ok: true, message: '線上版的匯入資料只存在你的瀏覽器，清除後就是模擬資料' });
  await transaction(async (tx) => {
    await tx.query(`DELETE FROM sales_history WHERE category = '冷氣'`);
    await tx.query(`DELETE FROM forecast_sources WHERE category = '冷氣'`);
    await createDemoHistory(tx, { salesOnly: true });
  });
  res.json({ ok: true, message: '已還原成模擬資料' });
});

// 下載目前資料庫裡的銷售資料（也是一份完整的匯入範例）
router.get('/forecast/export.csv', async (req, res) => {
  const rows = await query(
    `SELECT h.month, h.store_id, s.name, h.tier, h.units FROM sales_history h JOIN stores s ON s.store_id = h.store_id
     WHERE h.category = '冷氣' ORDER BY h.month, h.store_id, array_position($1::text[], h.tier)`,
    [AC_TIERS],
  );
  const lines = ['月份,門市代碼,門市名稱,坪數級距,銷售台數', ...rows.map((r) => [r.month, r.store_id, r.name, r.tier, r.units].join(','))];
  res.setHeader('content-type', 'text/csv; charset=utf-8');
  res.setHeader('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent('冷氣月銷售資料.csv')}`);
  res.send('﻿' + lines.join('\r\n'));
});

export default router;
