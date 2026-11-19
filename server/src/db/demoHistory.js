// 06 需求預測與補貨的示範資料（全部為模擬，畫面上都會標示）：
// - 冷氣 36 個月的月銷售（20 間門市 × 8 個坪數級距）
// - 各區月均溫、補助與促銷事件、各品牌交期
// 模擬規則刻意寫得像真實情況：夏季旺季、南部需求較高、大型門市賣得多、
// 補助與促銷期間需求增加、比往年熱的夏天冷氣賣更多，每月再加上隨機波動。

export const HISTORY_START = '2023-11';
export const HISTORY_MONTHS = 36; // 2023-11 ～ 2026-10

export const AC_TIERS = ['3-4 坪', '4-5 坪', '5-6 坪', '6-7 坪', '7-8 坪', '8-10 坪', '11-12 坪', '13 坪以上'];
const TIER_SHARE = { '3-4 坪': 0.16, '4-5 坪': 0.2, '5-6 坪': 0.18, '6-7 坪': 0.14, '7-8 坪': 0.1, '8-10 坪': 0.1, '11-12 坪': 0.06, '13 坪以上': 0.06 };
const STORE_BASE = { 一般門市: 40, 大型門市: 58, 體驗館: 66, 百貨門市: 35 }; // 每月平均冷氣台數（全年平均）
const REGION_FACTOR = { 北區: 0.95, 中區: 1.0, 南區: 1.12, 東區: 0.8 };
// 冷氣季節性（1～12 月）
const SEASON = [0.35, 0.33, 0.5, 0.85, 1.35, 1.85, 2.1, 1.75, 1.15, 0.62, 0.45, 0.4];
const YEARLY_GROWTH = 0.04;
// 各區月均溫氣候值（°C，1～12 月）
export const CLIMATE = {
  北區: [16.5, 16.8, 18.7, 22.1, 25.6, 28.3, 30.2, 29.8, 27.9, 24.9, 21.8, 18.0],
  中區: [16.8, 17.6, 20.1, 23.6, 26.4, 28.0, 28.9, 28.6, 27.8, 25.6, 22.3, 18.5],
  南區: [19.6, 20.7, 23.0, 25.9, 28.0, 28.9, 29.4, 29.0, 28.6, 27.1, 24.4, 21.0],
  東區: [18.7, 19.2, 20.8, 23.3, 25.6, 27.6, 28.8, 28.6, 27.3, 25.2, 22.6, 19.9],
};
const TEMP_EFFECT_SUMMER = 0.08; // 5～9 月每熱 1°C，冷氣需求約 +8%（模擬設定；預測模型會自己從資料估計）

// 補助、促銷事件（示範設定，名稱為示意）
export const DEMO_EVENTS = [
  ['節能家電補助（2024 年度，示範）', 'subsidy', '冷氣', '2024-04', '2024-12', 1.15, '汰舊換新補助期間，冷氣需求增加'],
  ['節能家電補助（2026 年度，示範）', 'subsidy', '冷氣', '2026-03', '2026-12', 1.18, '補助延續到 2026 年底'],
  ['冷氣早鳥預購（示範）', 'promotion', '冷氣', '2025-03', '2025-03', 1.15, null],
  ['冷氣早鳥預購（示範）', 'promotion', '冷氣', '2026-03', '2026-03', 1.15, null],
  ['冷氣早鳥預購（示範）', 'promotion', '冷氣', '2027-03', '2027-03', 1.15, '已排定'],
  ['618 年中慶（示範）', 'promotion', null, '2024-06', '2024-06', 1.1, null],
  ['618 年中慶（示範）', 'promotion', null, '2025-06', '2025-06', 1.1, null],
  ['618 年中慶（示範）', 'promotion', null, '2026-06', '2026-06', 1.1, null],
  ['618 年中慶（示範）', 'promotion', null, '2027-06', '2027-06', 1.1, '已排定'],
  ['周年慶（示範）', 'promotion', null, '2024-10', '2024-10', 1.12, null],
  ['周年慶（示範）', 'promotion', null, '2025-10', '2025-10', 1.12, null],
  ['周年慶（示範）', 'promotion', null, '2026-10', '2026-10', 1.12, null],
  ['周年慶（示範）', 'promotion', null, '2027-10', '2027-10', 1.12, '已排定'],
];

// 品牌交期（天）：日系進口較長、國產較短（示範設定）
export const DEMO_LEAD_TIMES = [
  ['Panasonic 國際', 10, 3, null], ['HITACHI 日立', 14, 5, null], ['三菱電機', 21, 7, '日本進口'], ['三菱重工', 21, 6, '日本進口'],
  ['LG 樂金', 12, 4, null], ['TECO 東元', 7, 2, '國產'], ['HERAN 禾聯', 7, 3, '國產'], ['SHARP 夏普', 14, 5, null],
  ['SAMPO 聲寶', 7, 2, '國產'], ['RECHI 瑞智', 10, 4, '國產'], ['SANLUX 台灣三洋', 9, 3, '國產'], ['DAIKIN 大金', 18, 6, '日本進口'],
];

export function addMonths(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}
export const monthIndex = (ym) => Number(ym.slice(5, 7)) - 1; // 0 = 1 月

// 固定的亂數（每次重建都一樣）
function rand(key) {
  let h = 2166136261;
  for (const ch of key) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function normal(key) {
  const u = Math.max(rand(`${key}a`), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand(`${key}b`));
}

function eventFactor(month, category) {
  return DEMO_EVENTS.reduce((f, [, , cat, start, end, uplift]) =>
    ((!cat || cat === category) && month >= start && month <= end ? f * uplift : f), 1);
}

export async function createDemoHistory(tx) {
  const stores = await tx.query('SELECT store_id, region, store_type FROM stores ORDER BY store_id');
  const regions = Object.keys(CLIMATE);

  // 各區月均溫：氣候值 + 當年的冷熱（全台大致同步）+ 各區小差異
  const temps = {};
  for (let i = 0; i < HISTORY_MONTHS; i++) {
    const month = addMonths(HISTORY_START, i);
    const shared = normal(`anom${month}`) * 0.8;
    for (const r of regions) {
      const t = CLIMATE[r][monthIndex(month)] + shared + normal(`anom${month}${r}`) * 0.3;
      temps[`${month}|${r}`] = Math.round(t * 10) / 10;
      await tx.query('INSERT INTO weather_monthly (month, region, avg_temp) VALUES ($1, $2, $3)', [month, r, temps[`${month}|${r}`]]);
    }
  }

  for (const [name, type, category, start, end, uplift, note] of DEMO_EVENTS) {
    await tx.query(
      'INSERT INTO demand_events (name, type, category, start_month, end_month, uplift, note) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [name, type, category, start, end, uplift, note],
    );
  }
  for (const [brand, days, sd, note] of DEMO_LEAD_TIMES) {
    await tx.query('INSERT INTO brand_lead_times (brand, lead_days, lead_sd_days, note) VALUES ($1, $2, $3, $4)', [brand, days, sd, note]);
  }

  // 月銷售：每間門市一次寫入 36 個月 × 8 級距
  for (const s of stores) {
    const base = (STORE_BASE[s.store_type] ?? 45) * (REGION_FACTOR[s.region] ?? 1) * (0.85 + rand(`store${s.store_id}`) * 0.3);
    const months = [];
    const tiers = [];
    const units = [];
    for (let i = 0; i < HISTORY_MONTHS; i++) {
      const month = addMonths(HISTORY_START, i);
      const mi = monthIndex(month);
      const anomaly = temps[`${month}|${s.region}`] - CLIMATE[s.region][mi];
      const tempF = Math.exp((mi >= 4 && mi <= 8 ? TEMP_EFFECT_SUMMER : 0.03) * anomaly);
      const trend = (1 + YEARLY_GROWTH) ** (i / 12);
      for (const tier of AC_TIERS) {
        const mean = base * TIER_SHARE[tier] * SEASON[mi] * trend * tempF * eventFactor(month, '冷氣');
        // 近似卜瓦松的隨機波動
        const u = Math.max(0, Math.round(mean + Math.sqrt(mean) * normal(`${s.store_id}${month}${tier}`)));
        months.push(month);
        tiers.push(tier);
        units.push(u);
      }
    }
    await tx.query(
      `INSERT INTO sales_history (month, store_id, category, tier, units)
       SELECT m, $1, '冷氣', t, u FROM unnest($2::text[], $3::text[], $4::int[]) AS x(m, t, u)`,
      [s.store_id, months, tiers, units],
    );
  }
}
