// 把全國電子官網分類頁抓下來的商品清單（冰箱、洗衣機、電視、掃地機器人、微波爐），
// 轉成 CCC 的商品格式，合併進 src/db/data/elifemall-products.json（冷氣、清淨機、除濕機那份不動）。
// 用法（在 server 資料夾執行）：
//   node scripts/convert-elifemall-categories.mjs <放 冰箱.json 等檔案的資料夾>
// 每個 JSON 檔是官網分類頁的商品清單：[{ product_code, productName, brandName, price, originalPriceDesc,
//   thirdCategory_desc, fourthCategory_desc }]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { BRANDS, validateSpecs } from '../src/specTemplates.js';

const dir = process.argv[2];
if (!dir) {
  console.error('請指定資料夾');
  process.exit(1);
}
const DATA_FILE = new URL('../src/db/data/elifemall-products.json', import.meta.url);
const CAPTURED_AT = '2026-11-18';

const num = (v) => Number(String(v ?? '').replace(/[^\d.]/g, '')) || 0;
const firstNum = (text, re) => {
  const m = text.match(re);
  return m ? Number(m[1]) : null;
};

// ---- 品牌：官網寫法（PANASONIC、LG 樂金、HERAN）→ CCC 品牌清單的正式名稱 ----
const BRAND_FIXED = {
  PANASONIC: 'Panasonic 國際', MITSUBISHI: '三菱電機', HITACHI: 'HITACHI 日立', TOSHIBA: 'TOSHIBA 東芝',
  SAMPO: 'SAMPO 聲寶', SANLUX: 'SANLUX 台灣三洋', HERAN: 'HERAN 禾聯', SHARP: 'SHARP 夏普', TECO: 'TECO 東元',
  WHIRLPOOL: 'Whirlpool 惠而浦', GE: 'GE 奇異', CHIMEI: 'CHIMEI 奇美', SANSUI: 'SANSUI 山水', 大同: 'TATUNG 大同',
  嘉儀: 'KAPPA 嘉儀', BOSCH: 'BOSCH 博世', MIELE: 'Miele', SONY: 'SONY 索尼', SAMSUNG: 'SAMSUNG 三星',
  PHILIPS: 'Philips 飛利浦', ECOVACS: 'ECOVACS 科沃斯', IROBOT: 'iRobot', DYSON: 'dyson', ROBOROCK: 'Roborock 石頭',
  XIAOMI: 'Xiaomi 小米', 小米: 'Xiaomi 小米', 伊萊克斯: 'Electrolux 伊萊克斯', 象印: 'ZOJIRUSHI 象印', HONEYWELL: 'Honeywell', OTHERS: '其他品牌', DREAME: 'Dreame 追覓', TCL: 'TCL', AIWA: 'AIWA 愛華', LG: 'LG 樂金',
};
function brandOf(category, raw) {
  const r = String(raw ?? '').trim();
  const head = r.split(/\s+/)[0].toUpperCase();
  if (BRAND_FIXED[head]) return BRAND_FIXED[head];
  if (BRAND_FIXED[r]) return BRAND_FIXED[r];
  // 清單裡已有的品牌（「LG 樂金」「SAMSUNG 三星」原樣對得上）
  const hit = (BRANDS[category] ?? []).find((b) => b.toLowerCase() === r.toLowerCase());
  return hit ?? r;
}

// 品名最後一段是型號（官網品名都以型號結尾）
const modelOf = (name) => name.trim().split(/\s+/).pop();
const inverterOf = (text) => (/定頻/.test(text) ? '定頻' : /變頻/.test(text) ? '變頻' : undefined);
const energyOf = (text) => {
  const m = text.match(/([一二三四五12345])\s*級(能效)?/);
  if (!m) return undefined;
  const n = '一二三四五'.includes(m[1]) ? '一二三四五'.indexOf(m[1]) + 1 : Number(m[1]);
  return `${n} 級`;
};

// ---- 各分類的轉換規則：回傳 null 代表不收（配件、乾衣機、冷凍櫃等不屬於這個分類的商品）----
const RULES = {
  冰箱: (p, name) => {
    if (p.thirdCategory_desc === '冷凍櫃' || /冷凍櫃|冷藏櫃|酒櫃/.test(name)) return null;
    const 容量 = firstNum(name, /(\d{2,4})\s*(?:L|公升)/i);
    if (!容量) return null;
    const doors = name.match(/(單門|雙門|三門|四門|五門|六門|對開)/);
    return {
      容量,
      門數: doors ? doors[1] : (p.thirdCategory_desc === '對開' ? '對開' : p.thirdCategory_desc === '單門小冰箱' ? '單門' : undefined),
      能效: energyOf(name),
      變頻: inverterOf(`${name} ${p.thirdCategory_desc}`),
    };
  },
  洗衣機: (p, name) => {
    const cat = p.thirdCategory_desc;
    if (['電子式', '抽屜底座', '洗衣塔'].includes(cat) || /乾衣機|底座|洗衣塔/.test(name)) return null;
    const 容量 = firstNum(name, /(\d{1,2}(?:\.\d)?)\s*(?:公斤|kg)/i);
    if (!容量) return null;
    const 類型 = /滾筒/.test(`${name} ${cat}`) ? '滾筒' : '直立式';
    // 官網品名很少寫烘乾容量，「洗脫烘」只記在特色，不猜數字
    const 特色 = /洗脫烘|烘乾/.test(name) ? '洗脫烘' : undefined;
    return { 容量, 類型, 能效: energyOf(name), 變頻: inverterOf(`${name} ${cat}`), 特色 };
  },
  電視: (p, name) => {
    if (/壁掛架|腳架|遙控器|音響|聲霸|商用/.test(name)) return null;
    const 尺寸 = firstNum(name, /(\d{2,3})\s*(?:吋|型|")/);
    if (!尺寸) return null;
    const text = `${name} ${p.thirdCategory_desc} ${p.fourthCategory_desc}`;
    const 解析度 = /8K/i.test(text) ? '8K' : /4K|UHD/i.test(text) ? '4K' : /FHD|1080/i.test(text) ? 'FHD' : /\bHD\b/i.test(text) ? 'HD' : undefined;
    const 面板 = /OLED/i.test(text) && !/QD-?OLED/i.test(text) ? 'OLED' : /mini\s*LED/i.test(text) ? 'Mini LED' : /QLED|量子點|QNED|QD/i.test(text) ? '量子點' : 'LCD';
    return { 尺寸, 解析度, 面板, 系統: /Google|Android|智慧|智能|連網|聯網|webOS|Tizen|Smart/i.test(text) ? '智慧電視' : '一般電視' };
  },
  吸塵器: (p, name) => {
    if (p.thirdCategory_desc === '耗材' || /耗材|濾網|清潔液|集塵袋|邊刷|拖布|滾刷|配件|擦窗/.test(name)) return null;
    return { 類型: /掃地|掃拖|機器人|自走/.test(`${name} ${p.thirdCategory_desc}`) ? '掃地機器人' : /無線/.test(name) ? '無線手持' : '有線' };
  },
  廚房家電: (p, name) => {
    const 類型 = /蒸烤|水波爐/.test(name) ? '蒸烤爐' : /微波/.test(name) ? '微波爐' : /烤箱|烘烤爐/.test(name) ? '烤箱' : null;
    if (!類型) return null;
    const L = firstNum(name, /(\d{2})\s*(?:L|公升)/i);
    return { 類型, 容量: L ? `${L}L` : undefined };
  },
};

// 檔名 → CCC 分類
const FILES = { 冰箱: '冰箱', 洗衣機: '洗衣機', 電視: '電視', 掃地機器人: '吸塵器', 微波爐: '廚房家電' };

const data = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
const handled = new Set(Object.values(FILES));
const keep = data.products.filter((p) => !handled.has(p.category));
const seenModels = new Set(keep.map((p) => p.model));
const added = [];
const skipped = {};

for (const [file, category] of Object.entries(FILES)) {
  const path = join(dir, `${file}.json`);
  if (!existsSync(path)) {
    console.log(`略過：找不到 ${path}`);
    continue;
  }
  for (const p of JSON.parse(readFileSync(path, 'utf8'))) {
    const name = String(p.productName ?? '').replace(/\s+/g, ' ').trim();
    const price = num(p.price);
    const skip = (why) => { skipped[`${category}：${why}`] = (skipped[`${category}：${why}`] ?? 0) + 1; };
    if (!name || !price) { skip('沒有品名或價格'); continue; }
    if (/福利品|展示|DEMO|^展-|拆封|二手|整新/i.test(name) || p.thirdCategory_desc === '展示機') { skip('福利品／展示機'); continue; }
    const specs = RULES[category](p, name);
    if (!specs) { skip('不屬於這個分類或缺少主要規格'); continue; }
    const model = modelOf(name);
    if (seenModels.has(model)) { skip('型號重複'); continue; }
    let clean;
    try {
      clean = validateSpecs(category, Object.fromEntries(Object.entries(specs).filter(([, v]) => v !== undefined && v !== null)));
    } catch (err) {
      skip(`規格不符：${err.message}`);
      continue;
    }
    seenModels.add(model);
    added.push({
      source_code: String(p.product_code), category, brand: brandOf(category, p.brandName), model, name,
      list_price: Math.max(num(p.originalPriceDesc), price), sale_price: price, specs: clean, meta: {},
    });
  }
}

data.products = [...keep, ...added];
data.captured_at = CAPTURED_AT;
data.note = '商品編號、品名、型號、網路價、原價取自官網；規格依官網品名與分類解析，冷氣適用坪數依官網級距、除濕機適用坪數依日除濕量推算。';
writeFileSync(DATA_FILE, JSON.stringify(data, null, 1) + '\n');

const byCat = data.products.reduce((m, p) => ((m[p.category] = (m[p.category] ?? 0) + 1), m), {});
console.log(`完成：共 ${data.products.length} 款`, byCat);
console.log('未收錄：', skipped);
