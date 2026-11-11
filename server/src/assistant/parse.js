// 從顧客的中文問句抓出需求：分類、預算、坪數、人數、尺寸、品牌、偏好
import { BRANDS } from '../specTemplates.js';

const DIGIT = { 零: 0, 〇: 0, 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

// 「十二」「二十」「三十五」這類 1～99 的中文數字
function smallChineseNumber(s) {
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  if (s.includes('十')) {
    const [tens, ones] = s.split('十');
    return (tens ? DIGIT[tens] ?? NaN : 1) * 10 + (ones ? DIGIT[ones] ?? NaN : 0);
  }
  return s.length === 1 ? DIGIT[s] ?? NaN : NaN;
}

const NUM = '(\\d+(?:\\.\\d+)?|[一二兩三四五六七八九十]{1,3})';

// 預算：2萬、2.5萬、兩萬五、一萬五千、8千、20000 元、預算 15000
export function parseBudget(text) {
  const t = text.replace(/[,，]/g, '');
  let m = t.match(new RegExp(`${NUM}\\s*萬\\s*([一二兩三四五六七八九]|\\d)?\\s*(千)?`));
  if (m) {
    const wan = smallChineseNumber(m[1]);
    let extra = 0;
    if (m[2]) extra = (DIGIT[m[2]] ?? Number(m[2])) * 1000; // 兩萬五 / 一萬五千 → +5000
    if (Number.isFinite(wan)) return Math.round(wan * 10000 + extra);
  }
  m = t.match(new RegExp(`${NUM}\\s*千`));
  if (m && Number.isFinite(smallChineseNumber(m[1]))) return smallChineseNumber(m[1]) * 1000;
  m = t.match(/(?:預算|價格|價錢|最多|不超過|低於)\s*(?:是|約|大約|在)?\s*(\d{3,6})/) || t.match(/(\d{3,6})\s*(?:元|塊|以內|以下|內|左右)/);
  if (m) return Number(m[1]);
  return null;
}

const CATEGORY_WORDS = [
  ['冰箱', ['冰箱', '冷藏', '冷凍庫']],
  ['洗衣機', ['洗衣機', '洗衣', '洗脫烘', '烘衣']],
  ['冷氣', ['冷氣', '空調', '冷暖氣']],
  ['電視', ['電視', 'tv', '螢幕']],
  ['除濕機', ['除濕', '潮濕', '濕氣', '反潮']],
  ['空氣清淨機', ['空氣清淨', '空清', '清淨機', '過敏', 'pm2.5', '空汙', '空污', '花粉']],
  ['吸塵器', ['吸塵', '掃地', '掃拖', '拖地', '機器人']],
  ['廚房家電', ['電鍋', '電子鍋', '煮飯', '氣炸', '微波', '飲水機', '開飲機', '烤箱', '蒸烤', '廚房']],
];

const KITCHEN_TYPES = [
  ['電子鍋', ['電鍋', '電子鍋', '煮飯']],
  ['氣炸鍋', ['氣炸']],
  ['微波爐', ['微波']],
  ['飲水機', ['飲水機', '開飲機']],
  ['烤箱', ['烤箱']],
  ['蒸烤爐', ['蒸烤']],
];

const VACUUM_TYPES = [
  ['掃地機器人', ['掃地機', '機器人', '掃拖', '拖地']],
  ['無線手持', ['無線', '手持']],
  ['有線', ['有線']],
];

// 品牌別名：「HITACHI 日立」→ hitachi、日立；另外補常見叫法
const EXTRA_ALIASES = { 'Panasonic 國際': ['國際牌', '松下'], 'DAIKIN 大金': ['大金'], 'TATUNG 大同': ['大同電鍋'] };
const BRAND_ALIASES = (() => {
  const all = new Set(Object.values(BRANDS).flat().filter((b) => b !== '其他品牌'));
  return [...all].map((brand) => {
    const parts = brand.split(/\s+/).map((p) => p.toLowerCase());
    return { brand, aliases: [...parts, ...(EXTRA_ALIASES[brand] ?? [])] };
  });
})();

function findFirst(text, table) {
  let best = null;
  for (const [value, words] of table) {
    for (const w of words) {
      const i = text.indexOf(w);
      if (i >= 0 && (best === null || i < best.index)) best = { value, index: i };
    }
  }
  return best?.value ?? null;
}

export function parseQuestion(question) {
  const raw = String(question ?? '').trim();
  const text = raw.toLowerCase().replace(/\s+/g, ' ');
  const out = { text: raw };

  out.category = findFirst(text, CATEGORY_WORDS);
  if (out.category === '廚房家電') out.kitchenType = findFirst(text, KITCHEN_TYPES);
  if (out.category === '吸塵器') out.vacuumType = findFirst(text, VACUUM_TYPES);

  // 相對預算：「預算多 5 千」「少一萬」→ 追問時加減上一輪的預算
  const rel = text.replace(/[,，]/g, '').match(new RegExp(`(多|加|提高|增加|拉高|少|降|減|降低)\\s*${NUM}\\s*(萬|千)`));
  if (rel && Number.isFinite(smallChineseNumber(rel[2]))) {
    const amount = smallChineseNumber(rel[2]) * (rel[3] === '萬' ? 10000 : 1000);
    out.budgetDelta = /多|加|提高|增加|拉高/.test(rel[1]) ? amount : -amount;
  } else {
    const budget = parseBudget(text);
    if (budget) out.budget = budget;
  }

  let m = text.match(new RegExp(`${NUM}\\s*坪`));
  if (m && Number.isFinite(smallChineseNumber(m[1]))) out.ping = smallChineseNumber(m[1]);

  m = text.match(/(\d{2,3})\s*(?:吋|寸|inch)/);
  if (m) out.inch = Number(m[1]);

  m = text.match(new RegExp(`${NUM}\\s*(?:個)?(?:人|口)`));
  if (m && Number.isFinite(smallChineseNumber(m[1]))) out.people = smallChineseNumber(m[1]);
  else if (/單身|獨居|一個人|租屋|小套房|套房|學生/.test(text)) out.people = 1;
  else if (/兩人|夫妻|情侶|小倆口|新婚/.test(text)) out.people = 2;
  else if (/小家庭/.test(text)) out.people = 4;
  else if (/大家庭|三代|人口多|家人多/.test(text)) out.people = 6;

  const brand = BRAND_ALIASES.find((b) => b.aliases.some((a) => text.includes(a)));
  if (brand) out.brand = brand.brand;

  const prefs = [];
  if (/省電|節能|一級|1\s*級|電費/.test(text)) prefs.push('efficient');
  if (/變頻/.test(text)) prefs.push('inverter');
  if (/冷暖|暖氣|冬天/.test(text)) prefs.push('heating');
  if (/滾筒/.test(text)) prefs.push('drum');
  if (/直立/.test(text)) prefs.push('top');
  if (/烘乾|洗脫烘|烘衣/.test(text)) prefs.push('dryer');
  if (/4k/.test(text)) prefs.push('4k');
  if (/便宜|划算|cp\s*值|經濟|省錢/.test(text)) prefs.push('cheap');
  if (/安靜|靜音/.test(text)) prefs.push('quiet');
  if (prefs.length) out.prefs = prefs;

  return out;
}

// 追問時沿用上一輪的條件（例如先問冰箱，再問「那 3 萬呢」）
export function mergeContext(parsed, context) {
  if (!context || typeof context !== 'object') {
    const { budgetDelta: _ignored, ...rest } = parsed; // 沒有上一輪可以加減，就忽略相對預算
    return rest;
  }
  const merged = { ...parsed };
  const sameTopic = !parsed.category || parsed.category === context.category;
  if (!sameTopic) return merged;
  for (const key of ['category', 'kitchenType', 'vacuumType', 'budget', 'ping', 'inch', 'people', 'brand']) {
    if (merged[key] == null && context[key] != null) merged[key] = context[key];
  }
  if (merged.budgetDelta && Number(context.budget) > 0) {
    merged.budget = Math.max(1000, Number(context.budget) + merged.budgetDelta);
  }
  delete merged.budgetDelta;
  // 偏好累加：先說「要省電」，再說「便宜一點」→ 兩個都要
  const prefs = new Set([...(Array.isArray(context.prefs) ? context.prefs : []), ...(merged.prefs ?? [])]);
  if (prefs.size) merged.prefs = [...prefs];
  return merged;
}
