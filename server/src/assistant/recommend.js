// 關鍵字模式的推薦：只從資料庫裡「上架中、有庫存」的商品挑，並附上理由
import { query } from '../db/index.js';

const fmt = (n) => Number(n).toLocaleString('zh-TW');

// 人數 → 合適容量範圍
function fridgeRange(people) {
  if (people <= 2) return [150, 400, '1～2 人'];
  if (people <= 4) return [380, 560, '3～4 人'];
  return [500, 1000, '5 人以上'];
}
function washerRange(people) {
  if (people <= 2) return [6, 13, '1～2 人'];
  if (people <= 4) return [12, 17, '3～4 人'];
  return [15, 30, '5 人以上'];
}
// 冷氣「4-5 坪」→ [4, 5]
const pingRange = (s) => (String(s ?? '').match(/(\d+)\s*-\s*(\d+)/) || []).slice(1, 3).map(Number);

// 依分類評估規格：回傳 { ok, score, reasons, misses }。ok=false 代表不合；
// 寬鬆模式會放寬，但把沒做到的條件記在 misses，回答時老實告訴顧客
function specFit(p, need, relaxed) {
  const s = p.specs ?? {};
  const reasons = [];
  const misses = [];
  // 偏好沒達到：嚴格模式直接排除，寬鬆模式記下來
  const unmet = (note) => (relaxed ? misses.push(note) : (ok = false));
  let score = 0;
  let ok = true;
  const prefs = new Set(need.prefs ?? []);

  switch (p.category) {
    case '冰箱':
      if (need.people) {
        const [lo, hi, label] = fridgeRange(need.people);
        if (s.容量 >= lo && s.容量 <= hi) {
          score += 3;
          reasons.push(`${s.容量}L，適合 ${label}家庭`);
        } else if (relaxed && s.容量 >= lo - 80 && s.容量 <= hi + 80) {
          score += 1;
          misses.push(`${s.容量}L，${label}建議 ${lo}～${hi}L，${s.容量 < lo ? '容量小一點' : '容量大一點'}`);
        } else ok = false;
      }
      break;
    case '洗衣機':
      if (need.people) {
        const [lo, hi, label] = washerRange(need.people);
        if (s.容量 >= lo && s.容量 <= hi) {
          score += 3;
          reasons.push(`${s.容量}kg，適合 ${label}`);
        } else if (relaxed && s.容量 >= lo - 3 && s.容量 <= hi + 3) {
          score += 1;
          misses.push(`${s.容量}kg，${label}建議 ${lo}～${hi}kg`);
        } else ok = false;
      }
      if (prefs.has('drum')) s.類型 === '滾筒' ? (score += 2, reasons.push('滾筒式')) : unmet(`是${s.類型}，不是滾筒式`);
      if (prefs.has('top')) s.類型 === '直立式' ? (score += 2, reasons.push('直立式')) : unmet(`是${s.類型}，不是直立式`);
      if (prefs.has('dryer')) s.烘乾容量 ? (score += 2, reasons.push(`有烘乾功能（${s.烘乾容量}kg）`)) : unmet('沒有烘乾功能');
      break;
    case '冷氣': {
      const [lo, hi] = pingRange(s.適用坪數);
      if (need.ping) {
        if (need.ping >= lo && need.ping <= hi) {
          score += 4;
          reasons.push(`適用 ${s.適用坪數}，剛好符合 ${need.ping} 坪`);
        } else if (relaxed && need.ping >= lo - 1 && need.ping <= hi + 1) {
          score += 1;
          misses.push(`適用 ${s.適用坪數}，跟 ${need.ping} 坪差一點`);
        } else ok = false;
      }
      if (prefs.has('heating')) s.冷暖 === '冷暖' ? (score += 2, reasons.push('冷暖兩用，冬天也能用')) : unmet('只有冷氣，沒有暖氣');
      break;
    }
    case '電視':
      if (need.inch) {
        const diff = Math.abs(s.尺寸 - need.inch);
        if (diff <= 3) {
          score += 3 - diff / 4;
          reasons.push(`${s.尺寸} 吋${diff ? `（接近 ${need.inch} 吋）` : ''}`);
        } else if (relaxed && diff <= 12) {
          score += 1;
          misses.push(`${s.尺寸} 吋，比你要的 ${need.inch} 吋${s.尺寸 > need.inch ? '大' : '小'}`);
        } else ok = false;
      }
      if (prefs.has('4k')) ['4K', '8K'].includes(s.解析度) ? (score += 1, reasons.push(`${s.解析度} 解析度`)) : unmet(`解析度是 ${s.解析度}`);
      break;
    case '除濕機':
    case '空氣清淨機':
      if (need.ping) {
        if (s.適用坪數 >= need.ping) {
          score += 3;
          reasons.push(`適用 ${s.適用坪數} 坪，涵蓋 ${need.ping} 坪的空間`);
        } else if (relaxed && s.適用坪數 >= need.ping * 0.7) {
          score += 1;
          misses.push(`適用 ${s.適用坪數} 坪，比 ${need.ping} 坪小一點`);
        } else ok = false;
      }
      break;
    case '吸塵器':
      if (need.vacuumType) s.類型 === need.vacuumType ? (score += 3, reasons.push(s.類型)) : unmet(`是${s.類型}，不是${need.vacuumType}`);
      break;
    case '廚房家電':
      if (need.kitchenType) {
        if (s.類型 === need.kitchenType) {
          score += 3;
          reasons.push(`${s.類型}${s.容量 ? `，容量 ${s.容量}` : ''}`);
        } else ok = false; // 要電鍋就不推氣炸鍋，寬鬆模式也一樣
      }
      break;
    default:
      break;
  }

  if (prefs.has('efficient') && s.能效) {
    if (s.能效 === '1 級') { score += 2; reasons.push('1 級能效，比較省電'); }
    else { score -= 1; misses.push(`能效 ${s.能效}，不是最省電的 1 級`); }
  }
  if (prefs.has('inverter') && /變頻/.test(`${p.name}${s.特色 ?? ''}`)) { score += 1; reasons.push('變頻'); }
  if (s.特色 && reasons.length < 3) reasons.push(s.特色);
  return { ok, score, reasons, misses };
}

async function loadCandidates() {
  const rows = await query(`
    SELECT p.product_id, p.name, p.brand, p.model, p.category, p.specs, pr.sale_price, pr.list_price,
           i.store_id, s.name AS store_name, (i.on_hand - i.reserved - i.display - i.damaged) AS available
    FROM products p
    JOIN product_prices pr ON pr.product_id = p.product_id AND pr.valid_to IS NULL
    JOIN inventory i ON i.product_id = p.product_id
    JOIN stores s ON s.store_id = i.store_id
    WHERE p.is_active
  `);
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.product_id)) {
      map.set(r.product_id, {
        product_id: r.product_id, name: r.name, brand: r.brand, model: r.model, category: r.category,
        specs: r.specs, price: r.sale_price, list_price: r.list_price, stores: [], available_total: 0,
      });
    }
    const p = map.get(r.product_id);
    if (r.available > 0) {
      p.stores.push({ store_id: r.store_id, name: r.store_name, available: r.available });
      p.available_total += r.available;
    }
  }
  return [...map.values()];
}

function rank(candidates, need, storeId, relaxed) {
  const budgetCap = need.budget ? need.budget * (relaxed ? 1.25 : 1) : Infinity;
  const prefs = new Set(need.prefs ?? []);
  const results = [];
  for (const p of candidates) {
    if (need.category && p.category !== need.category) continue;
    if (p.available_total <= 0) continue; // 全台都沒貨就不推
    if (p.price > budgetCap) continue;
    if (need.brand && p.brand !== need.brand && !relaxed) continue;

    const fit = specFit(p, need, relaxed);
    if (!fit.ok) continue;
    let score = fit.score;
    const reasons = [...fit.reasons];
    const misses = [...fit.misses];

    if (need.brand) {
      if (p.brand === need.brand) { score += 3; reasons.unshift(`你指定的品牌 ${p.brand}`); }
      else misses.unshift(`品牌是 ${p.brand}，不是你指定的 ${need.brand}`);
    }
    if (need.budget) {
      if (p.price <= need.budget) reasons.push(`NT$ ${fmt(p.price)}，在預算 ${fmt(need.budget)} 元內`);
      else misses.push(`NT$ ${fmt(p.price)}，超出預算 ${fmt(p.price - need.budget)} 元`);
      // 預算內越接近上限，通常規格越好；但要省錢時改成越便宜越好
      score += prefs.has('cheap') ? 2 * (1 - p.price / need.budget) : (p.price <= need.budget ? p.price / need.budget : -1);
    } else if (prefs.has('cheap')) {
      score += 2 - p.price / 50000;
    }
    if (p.list_price > p.price) reasons.push(`特價中，比原價省 ${fmt(p.list_price - p.price)} 元`);

    const here = storeId ? p.stores.find((s) => s.store_id === storeId) : null;
    if (storeId) score += here ? 2 : -1;
    score -= misses.length * 1.5; // 不符合的地方越少越前面
    results.push({ ...p, score, reasons: [...new Set(reasons)].slice(0, 4), misses, available_here: here?.available ?? 0 });
  }
  results.sort((a, b) => b.score - a.score || a.price - b.price);
  return results;
}

export function describeNeed(need) {
  const parts = [];
  if (need.category) parts.push(need.kitchenType || need.vacuumType || need.category);
  if (need.budget) parts.push(`預算 ${fmt(need.budget)} 元內`);
  if (need.ping) parts.push(`${need.ping} 坪`);
  if (need.inch) parts.push(`${need.inch} 吋`);
  if (need.people) parts.push(need.people === 1 ? '1 人' : need.people >= 5 ? '5 人以上' : `${need.people} 人`);
  if (need.brand) parts.push(need.brand);
  const prefLabel = { efficient: '省電', inverter: '變頻', heating: '冷暖', drum: '滾筒', top: '直立', dryer: '要烘乾', '4k': '4K', cheap: '便宜優先', quiet: '安靜' };
  for (const p of need.prefs ?? []) if (prefLabel[p]) parts.push(prefLabel[p]);
  return parts;
}

export async function recommend(need, storeId, limit = 3) {
  const candidates = await loadCandidates();
  let picks = rank(candidates, need, storeId, false);
  let relaxed = false;
  if (!picks.length) {
    picks = rank(candidates, need, storeId, true);
    relaxed = picks.length > 0;
  }
  return { picks: picks.slice(0, limit), total: picks.length, relaxed };
}
