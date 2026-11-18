// 把「坪數 3D 選購助手」(room-fit-3d.html) 裡的全國電子官網商品，轉成 CCC 的商品資料檔。
// 用法（在 server 資料夾執行）：
//   node scripts/extract-room-fit.mjs ../../坪數3D選購_CCC交接/room-fit-3d.html
// 產生：src/db/data/elifemall-products.json（之後由 seed.js / 升級程式讀取）
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { acPingFromKw, validateBrand, validateSpecs } from '../src/specTemplates.js';

const SOURCE_DATE = '2026-11-18'; // 官網擷取日期

const file = process.argv[2];
if (!file) {
  console.error('請指定 room-fit-3d.html 的路徑');
  process.exit(1);
}
const html = readFileSync(file, 'utf8');

// 取出 const NAME = [ ... ]; 這一段陣列（檔案是自己的，內容只有字串和數字）
function grab(name) {
  const head = `const ${name} = `;
  const start = html.indexOf(head + '[');
  if (start < 0) throw new Error(`找不到 ${name}`);
  const end = html.indexOf('\n];', start);
  return Function(`"use strict"; return ${html.slice(start + head.length, end + 2)}`)();
}

// 官網品牌 → CCC 品牌清單裡的正式名稱
const BRAND_MAP = {
  LG: 'LG 樂金', Panasonic: 'Panasonic 國際', SHARP: 'SHARP 夏普', 日立: 'HITACHI 日立',
  東元: 'TECO 東元', 禾聯: 'HERAN 禾聯', 聲寶: 'SAMPO 聲寶', 瑞智: 'RECHI 瑞智', 台灣三洋: 'SANLUX 台灣三洋',
  三菱重工: '三菱重工', 三菱電機: '三菱電機', Dyson: 'dyson', 小米: 'Xiaomi 小米', 伊萊克斯: 'Electrolux 伊萊克斯',
  飛利浦: 'Philips 飛利浦', Honeywell: 'Honeywell', DIKE: 'DIKE', ARTISAN: 'ARTISAN', ARKDAN: 'ARKDAN',
  'JJPRO 家佳寶': 'JJPRO 家佳寶', 'NWT 威技': 'NWT 威技',
};
const brandOf = (category, raw) => {
  const b = BRAND_MAP[raw];
  if (!b) throw new Error(`品牌「${raw}」還沒對應到 CCC 品牌清單，請加進 BRAND_MAP`);
  return validateBrand(category, b);
};

// 冷氣：品名最後一段是型號，型號裡的數字是冷房能力（LSU22DST → 2.2kW、CU-K100 → 10.0kW）
function parseKw(model) {
  const m = model.match(/(\d{2,3})/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return m[1].length === 3 ? (n >= 300 ? n / 100 : n / 10) : n / 10;
}

const products = [];
const add = (p) => products.push({ ...p, specs: validateSpecs(p.category, p.specs) });

for (const [code, brand, name, price, orig] of grab('AC_RAW')) {
  const model = name.trim().split(/\s+/).pop();
  const kw = parseKw(model);
  if (!kw) continue;
  add({
    source_code: code, category: '冷氣', brand: brandOf('冷氣', brand), model, name: name.trim(),
    list_price: Math.max(orig || price, price), sale_price: price,
    specs: {
      適用坪數: acPingFromKw(kw),
      冷房能力: kw,
      類型: /窗/.test(name) ? '窗型' : '分離式',
      冷暖: /冷暖/.test(name) ? '冷暖' : /冷專/.test(name) ? '冷專' : undefined,
      變頻: /定頻/.test(name) ? '定頻' : '變頻',
    },
    meta: { kw },
  });
}

for (const [code, brand, title, model, price, orig, cover, coverLabel, shape, color, accent] of grab('AP_RAW')) {
  add({
    source_code: code, category: '空氣清淨機', brand: brandOf('空氣清淨機', brand), model, name: `${brand} ${title}`,
    list_price: Math.max(orig || price, price), sale_price: price,
    specs: { 適用坪數: cover },
    meta: { coverLabel, shape, color, accent }, // 3D 模型用的外型與配色
  });
}

for (const [code, brand, title, model, price, orig, liters, color] of grab('DH_RAW')) {
  add({
    source_code: code, category: '除濕機', brand: brandOf('除濕機', brand), model, name: `${brand} ${title}`,
    list_price: Math.max(orig || price, price), sale_price: price,
    // 適用坪數 ≈ 日除濕量 × 1.25（估算，至少 2 坪），與 3D 頁相同
    specs: { 除濕量: liters, 適用坪數: Math.max(2, Math.round(liters * 1.25)) },
    meta: { color },
  });
}

const models = products.map((p) => p.model);
const dup = models.filter((m, i) => models.indexOf(m) !== i);
if (dup.length) throw new Error(`型號重複：${dup.join('、')}`);

const out = new URL('../src/db/data/elifemall-products.json', import.meta.url);
mkdirSync(new URL('.', out), { recursive: true });
writeFileSync(out, JSON.stringify({
  source: '全國電子官網公開商品列表（elifemall.com.tw）',
  captured_at: SOURCE_DATE,
  note: '商品編號、品名、型號、網路價、原價取自官網；規格中的適用坪數依官網級距或日除濕量推算。',
  products,
}, null, 1) + '\n');

const byCat = products.reduce((m, p) => ((m[p.category] = (m[p.category] ?? 0) + 1), m), {});
console.log(`完成：${products.length} 款`, byCat);
