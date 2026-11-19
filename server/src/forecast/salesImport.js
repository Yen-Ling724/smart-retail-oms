// 06 需求預測：匯入真實銷售資料
// 接受的格式很寬鬆，盡量讓 POS／ERP 匯出的檔案直接能用：
// - 月份：2026-07、2026/7、2026/7/15、2026年7月、202607、民國 115/07、Excel 日期
//   （每日或每筆交易的資料也可以，會自動加總成每月）
// - 門市：門市代碼（TN01）、官網門市編號（07170）或門市名稱（中華西店／中華西）
// - 坪數級距（5-6 坪、5～6坪、6）或型號（會用商品資料查出適用坪數；分離式的室內機或室外機型號都可以）
// - 數量可以是負數（退貨），每月加總後低於 0 的以 0 計
import { query } from '../db/index.js';
import { AC_TIERS, addMonths } from '../db/demoHistory.js';

export const SALES_IMPORT_MAX_ROWS = 100000;
export const MIN_MONTHS = 24;
const AC_WORDS = /冷氣|空調|冷暖|分離式|窗型/;

const clean = (v) => (v === null || v === undefined ? '' : String(v).trim());
const modelKey = (s) => clean(s).toUpperCase().replace(/\s+/g, '');
const pad2 = (n) => String(n).padStart(2, '0');
const storeKey = (s) => clean(s).toUpperCase().replace(/[\s　]+/g, '');
// 門市名稱的核心：「Digital City-中華西店」「中華西店」「中華西門市」都是「中華西」
const storeCore = (name) => {
  let n = clean(name).replace(/^.*[-－–]\s*/, '').replace(/^digital\s*city\s*/i, '');
  for (let i = 0; i < 2; i++) n = n.replace(/(門市|店|館)$/, '');
  return n || clean(name);
};

export function parseMonth(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  // Excel 的日期序號（1900 系統）
  if (typeof raw === 'number' || /^\d{5}(\.\d+)?$/.test(clean(raw))) {
    const n = Number(raw);
    if (n > 20000 && n < 80000) {
      const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000);
      return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
    }
  }
  const s = clean(raw);
  let m = s.match(/^(\d{4})(\d{2})$/); // 202607
  if (m) return valid(Number(m[1]), Number(m[2]));
  m = s.match(/^(\d{2,4})\s*[-/.年]\s*(\d{1,2})(?:\s*[-/.月]\s*(\d{1,2})?)?/); // 2026-07、2026/7/15、2026年7月、115/07
  if (m) {
    let y = Number(m[1]);
    if (y < 1000) y += 1911; // 民國年
    return valid(y, Number(m[2]));
  }
  return null;
}
function valid(y, mo) {
  return y >= 2000 && y <= 2100 && mo >= 1 && mo <= 12 ? `${y}-${pad2(mo)}` : null;
}

function tierOfPing(n) {
  if (!(n > 0)) return null;
  if (n <= 4) return '3-4 坪';
  if (n <= 5) return '4-5 坪';
  if (n <= 6) return '5-6 坪';
  if (n <= 7) return '6-7 坪';
  if (n <= 8) return '7-8 坪';
  if (n <= 10) return '8-10 坪';
  if (n <= 12) return '11-12 坪';
  return '13 坪以上';
}

export function parseTier(raw) {
  const s = clean(raw).replace(/\s+/g, '');
  if (!s) return null;
  if (/13.*(以上|\+)|^13\+?坪?$/.test(s)) return '13 坪以上';
  const pair = s.match(/(\d+(?:\.\d+)?)[-~～－—至到](\d+(?:\.\d+)?)/);
  if (pair) {
    const exact = `${Number(pair[1])}-${Number(pair[2])} 坪`;
    return AC_TIERS.includes(exact) ? exact : tierOfPing(Number(pair[2]));
  }
  const one = s.match(/^(\d+(?:\.\d+)?)坪?$/);
  return one ? tierOfPing(Number(one[1])) : null;
}

async function lookups() {
  const stores = await query('SELECT store_id, store_code, name FROM stores');
  const storeBy = new Map();
  for (const s of stores) {
    const keys = [s.store_id, s.name, storeCore(s.name)];
    if (s.store_code) keys.push(s.store_code, String(Number(s.store_code))); // Excel 會把 07170 變成 7170
    for (const k of keys) if (k) storeBy.set(storeKey(k), s);
  }
  const products = await query("SELECT model, category, specs->>'適用坪數' AS tier FROM products");
  const modelBy = new Map();
  for (const p of products) {
    const info = { category: p.category, tier: p.tier };
    modelBy.set(modelKey(p.model), info);
    // 分離式冷氣的型號是「室外機/室內機」，只填其中一個也找得到
    for (const part of p.model.split('/')) if (part.trim() && !modelBy.has(modelKey(part))) modelBy.set(modelKey(part), info);
  }
  return { stores, storeBy, modelBy };
}

// rows：[{ row, month, store, model, tier, units, category }]
export async function validateSales(rows) {
  if (!Array.isArray(rows) || !rows.length) throw Object.assign(new Error('沒有資料列'), { status: 400 });
  if (rows.length > SALES_IMPORT_MAX_ROWS) throw Object.assign(new Error(`一次最多 ${SALES_IMPORT_MAX_ROWS.toLocaleString()} 列`), { status: 400 });
  const { stores, storeBy, modelBy } = await lookups();

  const agg = new Map();
  const errors = [];
  const skipped = { not_ac: 0 };
  const notes = new Set();
  let used = 0;
  for (const r of rows) {
    const errs = [];
    const cat = clean(r.category);
    if (cat && !AC_WORDS.test(cat)) { skipped.not_ac++; continue; }

    const month = parseMonth(r.month);
    if (!month) errs.push(r.month === '' || r.month == null ? '月份空白' : `月份看不懂「${clean(r.month)}」（例：2026-07、2026/7/15）`);

    const storeRaw = clean(r.store);
    const store = storeBy.get(storeKey(storeRaw)) ?? storeBy.get(storeKey(storeCore(storeRaw)));
    if (!store) errs.push(storeRaw ? `找不到門市「${storeRaw}」` : '門市空白');

    let tier = null;
    if (clean(r.tier)) {
      tier = parseTier(r.tier);
      if (!tier) errs.push(`坪數級距看不懂「${clean(r.tier)}」（例：5-6 坪）`);
    } else if (clean(r.model)) {
      const p = modelBy.get(modelKey(r.model));
      if (p && p.category !== '冷氣') { skipped.not_ac++; continue; }
      if (p?.tier) { tier = p.tier; notes.add('用型號查出坪數級距'); }
      else errs.push(`找不到型號「${clean(r.model)}」，請改填坪數級距`);
    } else errs.push('型號和坪數級距都空白（至少填一個）');

    const units = Number(clean(r.units).replace(/[,，台]/g, ''));
    if (clean(r.units) === '' || !Number.isFinite(units)) errs.push(`數量看不懂「${clean(r.units)}」`);
    else if (!Number.isInteger(units)) notes.add('有小數的數量已四捨五入');

    if (errs.length) { errors.push({ row: r.row, errors: errs }); continue; }
    used++;
    const key = `${month}|${store.store_id}|${tier}`;
    agg.set(key, (agg.get(key) ?? 0) + Math.round(units));
  }

  // 整理成連續的月份；中間缺的月份以 0 計
  const monthsSeen = [...new Set([...agg.keys()].map((k) => k.split('|')[0]))].sort();
  const months = [];
  if (monthsSeen.length) for (let m = monthsSeen[0]; m <= monthsSeen.at(-1); m = addMonths(m, 1)) months.push(m);
  const missing = months.filter((m) => !monthsSeen.includes(m));
  let negatives = 0;
  const history = [];
  for (const [key, units] of agg) {
    const [month, storeId, tier] = key.split('|');
    if (units < 0) negatives++;
    history.push([month, storeId, tier, Math.max(0, units)]);
  }
  if (negatives) notes.add(`${negatives} 個「月份×門市×級距」加總後是負數（退貨多於銷售），以 0 計`);

  const storeUnits = new Map();
  const monthUnits = new Map(months.map((m) => [m, 0]));
  for (const [m, s, , u] of history) {
    storeUnits.set(s, (storeUnits.get(s) ?? 0) + u);
    monthUnits.set(m, monthUnits.get(m) + u);
  }
  const storeName = Object.fromEntries(stores.map((s) => [s.store_id, s.name]));

  let block = '';
  if (!used) block = '沒有可以用的資料列';
  else if (months.length < MIN_MONTHS) block = `資料只有 ${months.length} 個月，至少需要 ${MIN_MONTHS} 個月（兩個完整年度）才能估計季節性`;

  return {
    summary: {
      total_rows: rows.length,
      used_rows: used,
      error_rows: errors.length,
      skipped_rows: skipped.not_ac,
      month_from: months[0] ?? null,
      month_to: months.at(-1) ?? null,
      month_count: months.length,
      missing_months: missing,
      store_count: storeUnits.size,
      total_units: [...storeUnits.values()].reduce((a, b) => a + b, 0),
    },
    notes: [...notes],
    errors: errors.slice(0, 200),
    stores: [...storeUnits].map(([id, units]) => ({ store_id: id, name: storeName[id], units })).sort((a, b) => b.units - a.units),
    monthly: [...monthUnits].map(([month, units]) => ({ month, units })),
    can_import: !block,
    block_reason: block,
    history,
  };
}

// 前端（瀏覽器模式）送來的已整理資料：再檢查一次格式，避免算出奇怪的結果
export async function checkHistory(history) {
  if (!Array.isArray(history) || !history.length || history.length > 50000) throw Object.assign(new Error('匯入資料格式不正確，請重新匯入'), { status: 400 });
  const ids = new Set((await query('SELECT store_id FROM stores')).map((s) => s.store_id));
  for (const h of history) {
    if (!Array.isArray(h) || !/^\d{4}-\d{2}$/.test(h[0]) || !ids.has(h[1]) || !AC_TIERS.includes(h[2]) || !Number.isInteger(h[3]) || h[3] < 0) {
      throw Object.assign(new Error('匯入資料格式不正確，請重新匯入'), { status: 400 });
    }
  }
  return history;
}
