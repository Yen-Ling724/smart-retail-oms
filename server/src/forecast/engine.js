// 冷氣季節性需求預測與備貨建議（可解釋的統計方法，不是黑盒子）
//
// 1. 先把已知事件（補助、促銷）的影響除掉，得到「一般月份」的需求
// 2. 用「區域總量」估計季節指數（每個月是全年平均的幾倍）與每年成長率 —— 總量比單店穩定
// 3. 每間門市 × 坪數級距只估自己的「水準」（去季節化後的指數平滑）
// 4. 預測 = 水準 × 成長 × 季節指數 × 已排定事件 × 氣溫情境（× 3D 試算領先指標）
// 5. 安全庫存 = z × √(交期 × 日需求變異 + 日需求² × 交期變異)；再訂購點 = 日需求 × 交期 + 安全庫存
// 6. 用預測推算未來 12 個月的庫存，找出「哪個月會低於安全庫存」與「最晚下單日」

import { addMonths, monthIndex } from '../db/demoHistory.js';

const SMOOTHING = 0.3; // 門市水準的指數平滑係數（越大越重視近期）
const ORDER_COST = 800; // 每次下單的作業成本（示範設定）
const HOLDING_RATE = 0.2; // 年持有成本率（資金、倉儲、跌價）
const REVIEW_DAYS = 7; // 下單後到貨前的緩衝天數
export const SERVICE_LEVEL = { A: 0.98, B: 0.95, C: 0.9 };
const Z = { 0.9: 1.28, 0.95: 1.65, 0.98: 2.05 };

const sum = (a) => a.reduce((s, x) => s + x, 0);
const mean = (a) => (a.length ? sum(a) / a.length : 0);
const std = (a) => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(sum(a.map((x) => (x - m) ** 2)) / (a.length - 1));
};

export function eventFactor(events, month, category) {
  return events.reduce((f, e) => ((!e.category || e.category === category) && month >= e.start_month && month <= e.end_month ? f * Number(e.uplift) : f), 1);
}

// 區域季節指數與成長率：classical decomposition（以整年平均為基準的比值，取各年平均）
function seasonalModel(series, months) {
  const years = Math.floor(series.length / 12);
  const ratios = Array.from({ length: 12 }, () => []);
  const yearMeans = [];
  for (let y = 0; y < years; y++) {
    const block = series.slice(series.length - (years - y) * 12, series.length - (years - y - 1) * 12);
    const bm = mean(block);
    yearMeans.push(bm);
    block.forEach((v, k) => {
      const mi = monthIndex(months[series.length - (years - y) * 12 + k]);
      if (bm > 0) ratios[mi].push(v / bm);
    });
  }
  let S = ratios.map((r) => mean(r) || 1);
  const sm = mean(S);
  S = S.map((x) => x / sm); // 12 個月平均 = 1
  // 每月成長率：第一年與最後一年平均的幾何成長
  const g = years >= 2 && yearMeans[0] > 0 ? (yearMeans[years - 1] / yearMeans[0]) ** (1 / ((years - 1) * 12)) - 1 : 0;
  return { S, g };
}

// 主要計算。data：{ months, stores, tiers, history: Map(`${store}|${tier}` → units[]), events, weather, leadByTier, priceByTier,
//   position: Map(`${store}|${tier}` → {available, in_transit}), leading: {region: ratio} }
// opts：{ horizon, tempDelta, useLeading, backtestMonths }
export function runForecast(data, opts = {}) {
  const { months, stores, tiers, history, events, weather } = data;
  const horizon = opts.horizon ?? 12;
  const tempDelta = Number(opts.tempDelta) || 0;
  const T = months.length;
  const future = Array.from({ length: horizon }, (_, h) => addMonths(months[T - 1], h + 1));
  const category = '冷氣';
  const ev = months.map((m) => eventFactor(events, m, category));
  const evF = future.map((m) => eventFactor(events, m, category));
  const regions = [...new Set(stores.map((s) => s.region))];

  // 氣溫偏差：當月均溫 − 該區同月份歷年平均
  const clim = {};
  for (const r of regions) {
    clim[r] = Array.from({ length: 12 }, (_, mi) => mean(months.filter((m) => monthIndex(m) === mi).map((m) => weather.get(`${m}|${r}`)).filter((x) => x != null)));
  }
  const anomaly = (r, m) => (weather.get(`${m}|${r}`) ?? clim[r][monthIndex(m)]) - clim[r][monthIndex(m)];
  const summer = (m) => monthIndex(m) >= 4 && monthIndex(m) <= 8;

  // 1～2. 各區：去事件後的總量 → 季節指數、成長率
  const regionModel = {};
  for (const r of regions) {
    const ids = stores.filter((s) => s.region === r).map((s) => s.store_id);
    const total = months.map((_, t) => sum(ids.flatMap((id) => tiers.map((tier) => history.get(`${id}|${tier}`)?.[t] ?? 0))) / ev[t]);
    regionModel[r] = { ...seasonalModel(total, months), total };
  }

  // 氣溫敏感度：夏季「實際 ÷ 季節趨勢配適值」的對數，對氣溫偏差做迴歸（全區一起估）
  const xs = [];
  const ys = [];
  for (const r of regions) {
    const { S, g, total } = regionModel[r];
    const fitBase = mean(total.map((v, t) => v / (S[monthIndex(months[t])] * (1 + g) ** t)));
    months.forEach((m, t) => {
      if (!summer(m) || total[t] <= 0) return;
      xs.push(anomaly(r, m));
      ys.push(Math.log(total[t] / (fitBase * S[monthIndex(m)] * (1 + g) ** t)));
    });
  }
  const mx = mean(xs);
  const my = mean(ys);
  const tempElasticity = sum(xs.map((x, i) => (x - mx) * (ys[i] - my))) / Math.max(sum(xs.map((x) => (x - mx) ** 2)), 1e-9);
  const tempF = (r, m, scenario = 0) => Math.exp((summer(m) ? tempElasticity : 0) * (anomaly(r, m) + scenario));
  const tempFuture = (m) => Math.exp((summer(m) ? tempElasticity : 0) * tempDelta);

  // 3～4. 每間門市 × 級距
  const series = [];
  for (const s of stores) {
    const { S, g } = regionModel[s.region];
    const lead = opts.useLeading ? (data.leading?.[s.region] ?? 1) : 1;
    const leadF = (h) => (h < 2 ? Math.min(1.25, Math.max(0.85, 1 + 0.3 * (lead - 1))) : 1);
    for (const tier of tiers) {
      const y = history.get(`${s.store_id}|${tier}`) ?? months.map(() => 0);
      const factor = (t) => S[monthIndex(months[t])] * (1 + g) ** t * ev[t] * tempF(s.region, months[t]);
      const d = y.map((v, t) => v / Math.max(factor(t), 1e-9));
      let level = mean(d.slice(0, 12));
      const fitted = [];
      for (let t = 0; t < T; t++) {
        fitted.push(level * factor(t)); // 用到上個月為止的水準預測這個月（一步預測）
        level = SMOOTHING * d[t] + (1 - SMOOTHING) * level;
      }
      const resid = y.slice(-12).map((v, k) => v - fitted[T - 12 + k]);
      const sigma = Math.max(std(resid), Math.sqrt(Math.max(mean(y.slice(-12)), 0.5)) * 0.5);
      const fc = future.map((m, h) => level * S[monthIndex(m)] * (1 + g) ** (T + h) * evF[h] * tempFuture(m) * leadF(h));
      series.push({ store_id: s.store_id, region: s.region, tier, actual: y, fitted, forecast: fc, sigma, deseason: d });
    }
  }
  return { future, regionModel, tempElasticity, series, ev, evF };
}

// 回測：只用前 T − k 個月建模，預測最後 k 個月，跟實際比較；基準＝去年同月
export function backtest(data, k = 6) {
  const cut = data.months.length - k;
  const trimmed = {
    ...data,
    months: data.months.slice(0, cut),
    history: new Map([...data.history].map(([key, arr]) => [key, arr.slice(0, cut)])),
  };
  const run = runForecast(trimmed, { horizon: k });
  const rows = run.series.map((s) => {
    const actual = data.history.get(`${s.store_id}|${s.tier}`).slice(cut);
    const naive = data.history.get(`${s.store_id}|${s.tier}`).slice(cut - 12, cut - 12 + k);
    return { ...s, actualOut: actual, naive };
  });
  const wape = (pick) => {
    const err = sum(rows.flatMap((r) => r.actualOut.map((a, i) => Math.abs(a - pick(r)[i]))));
    return err / Math.max(sum(rows.flatMap((r) => r.actualOut)), 1);
  };
  const totalBy = (pick) => Array.from({ length: k }, (_, i) => sum(rows.map((r) => pick(r)[i])));
  return {
    months: data.months.slice(cut),
    wape_model: wape((r) => r.forecast),
    wape_naive: wape((r) => r.naive),
    total_actual: totalBy((r) => r.actualOut),
    total_model: totalBy((r) => r.forecast),
    total_naive: totalBy((r) => r.naive),
    wape_total_model: sum(totalBy((r) => r.actualOut).map((a, i) => Math.abs(a - totalBy((r) => r.forecast)[i]))) / Math.max(sum(totalBy((r) => r.actualOut)), 1),
    wape_total_naive: sum(totalBy((r) => r.actualOut).map((a, i) => Math.abs(a - totalBy((r) => r.naive)[i]))) / Math.max(sum(totalBy((r) => r.actualOut)), 1),
  };
}

// ABC（近 12 個月營收占比）× XYZ（去季節化後需求的變異係數）
export function classify(series, priceByTier) {
  const rev = series.map((s) => ({ s, v: sum(s.actual.slice(-12)) * (priceByTier[s.tier] ?? 0) })).sort((a, b) => b.v - a.v);
  const total = sum(rev.map((r) => r.v)) || 1;
  let cum = 0;
  const out = new Map();
  for (const { s, v } of rev) {
    cum += v;
    const abc = cum / total <= 0.8 ? 'A' : cum / total <= 0.95 ? 'B' : 'C';
    const d = s.deseason.slice(-24);
    const cv = std(d) / Math.max(mean(d), 1e-9);
    const xyz = cv < 0.25 ? 'X' : cv < 0.5 ? 'Y' : 'Z';
    out.set(`${s.store_id}|${s.tier}`, { abc, xyz, cv });
  }
  return out;
}

// 備貨政策與建議
export function plan(run, data, cls, { today = new Date() } = {}) {
  const { future } = run;
  const startOf = (ym) => new Date(`${ym}-01T00:00:00+08:00`);
  return run.series.map((s) => {
    const key = `${s.store_id}|${s.tier}`;
    const c = cls.get(key);
    const service = SERVICE_LEVEL[c.abc];
    const z = Z[service];
    const lt = data.leadByTier[s.tier] ?? { days: 10, sd: 3 };
    const pos = data.position.get(key) ?? { available: 0, in_transit: 0 };
    const position = pos.available + pos.in_transit;
    // 安全庫存跟著每個月的需求變動：旺季需求大、誤差也大，需要更多緩衝。
    // 預測誤差用「近 12 個月誤差 ÷ 平均銷量」的比例，乘上當月預測量
    const errRatio = s.sigma / Math.max(mean(s.actual.slice(-12)), 0.5);
    const ssOf = (f) => {
      const d = f / 30;
      const sdDaily = (errRatio * f) / Math.sqrt(30);
      return Math.ceil(z * Math.sqrt(lt.days * sdDaily ** 2 + d ** 2 * lt.sd ** 2));
    };
    const ssByMonth = s.forecast.map(ssOf);
    const ss = ssByMonth[0];
    const rop = Math.ceil((s.forecast[0] / 30) * lt.days + ss);
    const annual = sum(s.forecast.slice(0, 12));
    const price = data.priceByTier[s.tier] ?? 30000;
    const eoq = Math.max(1, Math.round(Math.sqrt((2 * annual * ORDER_COST) / (HOLDING_RATE * price))));

    // 未來 12 個月的月底庫存（不下單的情況）
    let stock = position;
    const projected = s.forecast.map((f) => (stock -= f));
    const needIdx = projected.findIndex((p, h) => p < ssByMonth[h]);
    let orderBy = null;
    let qty = 0;
    let shortfall = 0;
    if (needIdx >= 0) {
      const needMonth = future[needIdx];
      const before = needIdx === 0 ? position : projected[needIdx - 1];
      const cover = sum(s.forecast.slice(needIdx, needIdx + 3)); // 補到能撐過缺貨月起的 3 個月
      const peakSs = Math.max(...ssByMonth.slice(needIdx, needIdx + 3));
      shortfall = Math.ceil(cover + peakSs - Math.max(before, 0));
      qty = Math.max(eoq, shortfall);
      const t = startOf(needMonth);
      t.setDate(t.getDate() - Math.round(lt.days) - REVIEW_DAYS);
      orderBy = t.toISOString().slice(0, 10);
    }
    const monthsSupply = position / Math.max(mean(s.forecast), 0.01);
    let status;
    if (position < rop) status = 'reorder_now';
    else if (needIdx >= 0 && orderBy <= today.toISOString().slice(0, 10)) status = 'reorder_now';
    else if (needIdx >= 0) status = 'plan';
    else if (monthsSupply > 12) status = 'excess';
    else status = 'ok';
    return {
      store_id: s.store_id, region: s.region, tier: s.tier, abc: c.abc, xyz: c.xyz, service,
      available: pos.available, in_transit: pos.in_transit, position,
      forecast: s.forecast.map((x) => Math.round(x * 10) / 10), sigma: Math.round(s.sigma * 10) / 10,
      lead_days: lt.days, lead_sd: lt.sd, safety_stock: ss, peak_safety_stock: Math.max(...ssByMonth), reorder_point: rop, eoq,
      need_idx: needIdx, need_month: needIdx >= 0 ? future[needIdx] : null, order_by: orderBy, suggested_qty: qty, shortfall,
      need_12: Math.ceil(sum(s.forecast) + Math.max(...ssByMonth)),
      months_supply: Math.round(monthsSupply * 10) / 10, status, price,
    };
  });
}

// 同區調撥：未來 12 個月內會不足的門市（越早不足越優先），先從同區「庫存超過自己未來 12 個月需求」的門市調，
// 不夠的部分才向供應商下單。旺季前先調撥，可以減少淡季的庫存壓力與新進貨量
export function transfers(rows) {
  const need = rows.filter((r) => r.need_idx >= 0).sort((a, b) => a.need_idx - b.need_idx).map((r) => ({ r, n: r.shortfall }));
  const give = rows.map((r) => ({ r, x: Math.floor(r.position - r.need_12) })).filter((g) => g.x > 0);
  const out = [];
  for (const nd of need) {
    for (const g of give.filter((g) => g.r.tier === nd.r.tier && g.r.region === nd.r.region && g.r.store_id !== nd.r.store_id).sort((a, b) => b.x - a.x)) {
      if (nd.n <= 0) break;
      const q = Math.min(nd.n, g.x);
      if (q <= 0) continue;
      out.push({ tier: nd.r.tier, region: nd.r.region, from_store_id: g.r.store_id, to_store_id: nd.r.store_id, qty: q, need_month: nd.r.need_month, transfer_by: nd.r.order_by });
      g.x -= q;
      nd.n -= q;
    }
  }
  return out;
}
