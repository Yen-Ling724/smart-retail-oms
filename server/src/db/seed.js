// 虛構示範資料：品牌、型號、門市地址、價格、庫存全部是編的，與任何真實企業無關。
import { readFileSync } from 'node:fs';
import { validateSpecs } from '../specTemplates.js';
import { getDb } from './index.js';

const SCHEMA = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

export const STORES = [
  ['TN01', '台南中西店', '台南市', '台南市中西區示範路 101 號（虛構）'],
  ['TN02', '台南永康店', '台南市', '台南市永康區示範路 202 號（虛構）'],
  ['KH01', '高雄左營店', '高雄市', '高雄市左營區示範路 303 號（虛構）'],
  ['TC01', '台中西屯店', '台中市', '台中市西屯區示範路 404 號（虛構）'],
  ['TP01', '台北內湖店', '台北市', '台北市內湖區示範路 505 號（虛構）'],
];

// [分類, 品牌, 型號, 品名, 保固, 原價, 售價, 規格]
const PRODUCTS = [
  ['冰箱', '晴川', 'QC-R480', '晴川 480L 變頻雙門冰箱', '3 年', 32900, 28900, { 容量: 480, 門數: '雙門', 能效: '1 級', 尺寸: '68×70×178 cm' }],
  ['冰箱', '晴川', 'QC-R560', '晴川 560L 變頻四門冰箱', '3 年', 45900, 41900, { 容量: 560, 門數: '四門', 能效: '1 級', 特色: '急速冷凍室' }],
  ['冰箱', '森和', 'SH-F320', '森和 320L 小家庭雙門冰箱', '2 年', 18900, 16900, { 容量: 320, 門數: '雙門', 能效: '2 級' }],
  ['冰箱', '冬嶼', 'DY-F650', '冬嶼 650L 對開門大冰箱', '3 年', 58900, 54900, { 容量: 650, 門數: '對開', 能效: '1 級', 特色: '製冰機' }],
  ['洗衣機', '森和', 'SH-W13', '森和 13kg 直立式洗衣機', '2 年', 15900, 13900, { 容量: 13, 類型: '直立式', 能效: '1 級' }],
  ['洗衣機', '森和', 'SH-W17', '森和 17kg 變頻直立洗衣機', '3 年', 21900, 19900, { 容量: 17, 類型: '直立式', 能效: '1 級', 特色: '變頻、溫水洗' }],
  ['洗衣機', '光禾', 'GH-D12', '光禾 12kg 滾筒洗脫烘', '3 年', 39900, 35900, { 容量: 12, 類型: '滾筒', 能效: '2 級', 烘乾容量: 7 }],
  ['洗衣機', '光禾', 'GH-D10', '光禾 10kg 滾筒洗衣機（舊款）', '2 年', 29900, 22900, { 容量: 10, 類型: '滾筒', 能效: '3 級' }],
  ['冷氣', '冬嶼', 'DY-AC28', '冬嶼 4-5 坪 變頻冷暖分離式冷氣', '5 年', 32900, 29900, { 適用坪數: '4-5 坪', 類型: '分離式', 冷暖: '冷暖', 能效: '1 級' }],
  ['冷氣', '冬嶼', 'DY-AC41', '冬嶼 6-7 坪 變頻冷暖分離式冷氣', '5 年', 42900, 38900, { 適用坪數: '6-7 坪', 類型: '分離式', 冷暖: '冷暖', 能效: '1 級' }],
  ['冷氣', '海拓', 'HT-AC22', '海拓 3-4 坪 變頻冷專分離式冷氣', '3 年', 23900, 21900, { 適用坪數: '3-4 坪', 類型: '分離式', 冷暖: '冷專', 能效: '2 級' }],
  ['冷氣', '海拓', 'HT-WIN18', '海拓 2-3 坪 窗型冷氣', '3 年', 15900, 14500, { 適用坪數: '2-3 坪', 類型: '窗型', 冷暖: '冷專', 能效: '3 級' }],
  ['電視', '光禾', 'GH-TV55', '光禾 55 吋 4K 智慧電視', '3 年', 22900, 18900, { 尺寸: 55, 解析度: '4K', 面板: 'LCD', 系統: '智慧電視' }],
  ['電視', '光禾', 'GH-TV65', '光禾 65 吋 4K 智慧電視', '3 年', 32900, 27900, { 尺寸: 65, 解析度: '4K', 面板: 'LCD', 系統: '智慧電視' }],
  ['電視', '禾風', 'HF-TV43', '禾風 43 吋 FHD 液晶電視', '2 年', 10900, 9490, { 尺寸: 43, 解析度: 'FHD', 面板: 'LCD', 系統: '一般電視' }],
  ['電視', '禾風', 'HF-TV75', '禾風 75 吋 4K 量子點電視', '3 年', 49900, 44900, { 尺寸: 75, 解析度: '4K', 面板: '量子點', 系統: '智慧電視' }],
  ['除濕機', '晴川', 'QC-DH12', '晴川 12L 除濕機', '2 年', 8990, 7990, { 除濕量: 12, 適用坪數: 15, 能效: '1 級' }],
  ['除濕機', '晴川', 'QC-DH18', '晴川 18L 變頻除濕機', '3 年', 13900, 12500, { 除濕量: 18, 適用坪數: 23, 能效: '1 級', 特色: '變頻' }],
  ['除濕機', '海拓', 'HT-DH08', '海拓 8L 輕巧除濕機', '1 年', 5490, 4990, { 除濕量: 8, 適用坪數: 10, 能效: '2 級' }],
  ['空氣清淨機', '禾風', 'HF-AP20', '禾風 20 坪 空氣清淨機', '2 年', 12900, 10900, { 適用坪數: 20, 濾網: 'HEPA H13' }],
  ['空氣清淨機', '禾風', 'HF-AP12', '禾風 12 坪 空氣清淨機', '2 年', 7900, 6900, { 適用坪數: 12, 濾網: 'HEPA H12' }],
  ['空氣清淨機', '晴川', 'QC-AP30', '晴川 30 坪 智慧空氣清淨機', '3 年', 19900, 17900, { 適用坪數: 30, 濾網: 'HEPA H13', 特色: 'App 控制' }],
  ['吸塵器', '海拓', 'HT-VC10', '海拓 無線手持吸塵器', '2 年', 9990, 8490, { 類型: '無線手持', 續航: 50 }],
  ['吸塵器', '海拓', 'HT-RB20', '海拓 掃拖機器人', '2 年', 15900, 12900, { 類型: '掃地機器人', 續航: 150, 特色: '掃拖、自動集塵' }],
  ['吸塵器', '森和', 'SH-VC05', '森和 有線吸塵器', '1 年', 3990, 3490, { 類型: '有線', 特色: '旋風式集塵' }],
  ['廚房家電', '光禾', 'GH-RC10', '光禾 10 人份 IH 電子鍋', '2 年', 8900, 7490, { 類型: '電子鍋', 容量: '10 人份', 功率: 1200, 特色: 'IH 加熱' }],
  ['廚房家電', '光禾', 'GH-AF06', '光禾 6L 氣炸鍋', '1 年', 3990, 2990, { 類型: '氣炸鍋', 容量: '6L', 功率: 1500, 特色: '氣炸、烘烤' }],
  ['廚房家電', '冬嶼', 'DY-MW25', '冬嶼 25L 微波爐', '1 年', 4990, 4290, { 類型: '微波爐', 容量: '25L', 功率: 900 }],
  ['廚房家電', '禾風', 'HF-WP06', '禾風 6L 濾淨飲水機', '2 年', 6990, 5990, { 類型: '飲水機', 容量: '6L', 特色: '冷熱、RO 過濾' }],
  ['廚房家電', '森和', 'SH-OV32', '森和 32L 蒸烤爐', '2 年', 15900, 13900, { 類型: '蒸烤爐', 容量: '32L', 功率: 1800, 特色: '蒸、烤、發酵' }],
];

// 舊款由新款取代
const REPLACED_BY = { 'GH-D10': 'GH-D12' };

// 固定的「亂數」，讓每次重置都得到一樣的示範庫存
function pseudoRandom(seed) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0) / 4294967296;
}

const BIG_ITEMS = new Set(['冰箱', '洗衣機', '冷氣', '電視']);
// 熱銷缺貨中的商品，讓「低庫存」提醒有東西可以示範
const SCARCE = new Set(['DY-F650', 'HF-TV75', 'QC-AP30', 'HT-RB20']);

function stockFor(storeId, product) {
  const [category, , model] = product;
  const r = pseudoRandom(storeId + model);
  const big = BIG_ITEMS.has(category);
  let onHand = Math.floor(r * (big ? 9 : 16));
  if (r < 0.12) onHand = 0; // 有些門市缺貨
  if (SCARCE.has(model)) onHand = Math.floor(r * 2.5);
  const display = big && onHand > 0 && r > 0.4 ? 1 : 0;
  const damaged = onHand > 3 && r > 0.85 ? 1 : 0;
  const reserved = onHand - display - damaged > 2 && r > 0.6 ? 1 : 0;
  const inTransit = onHand <= 1 ? Math.floor(pseudoRandom(model + storeId) * 4) : 0;
  return { onHand, reserved, display, damaged, inTransit };
}

export const productId = (i) => `P${String(i + 1).padStart(4, '0')}`;

export async function seed({ reset = false } = {}) {
  const db = await getDb();
  if (reset) {
    await db.exec('DROP TABLE IF EXISTS inventory, product_prices, products, stores CASCADE;');
  }
  await db.exec(SCHEMA);

  const [{ count }] = await db.query('SELECT count(*)::int AS count FROM stores');
  if (count > 0) return false;

  await db.transaction(async (tx) => {
    for (const s of STORES) {
      await tx.query('INSERT INTO stores (store_id, name, city, address) VALUES ($1, $2, $3, $4)', s);
    }
    const idByModel = Object.fromEntries(PRODUCTS.map((p, i) => [p[2], productId(i)]));
    for (const [i, p] of PRODUCTS.entries()) {
      const [category, brand, model, name, warranty, list, sale, specs] = p;
      const id = productId(i);
      const cleanSpecs = validateSpecs(category, specs); // 示範資料也必須符合規格範本
      await tx.query(
        `INSERT INTO products (product_id, category, brand, model, name, specs, warranty, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, category, brand, model, name, JSON.stringify(cleanSpecs), warranty, !REPLACED_BY[model]],
      );
      // 一半的商品多一筆舊價格，示範價格歷史
      if (i % 2 === 0) {
        await tx.query(
          `INSERT INTO product_prices (product_id, list_price, sale_price, valid_from, valid_to)
           VALUES ($1, $2, $2, now() - interval '90 days', now() - interval '30 days')`,
          [id, list],
        );
      }
      await tx.query(
        `INSERT INTO product_prices (product_id, list_price, sale_price, valid_from)
         VALUES ($1, $2, $3, now() - interval '30 days')`,
        [id, list, sale],
      );
      for (const [storeId] of STORES) {
        const st = stockFor(storeId, p);
        await tx.query(
          `INSERT INTO inventory (store_id, product_id, on_hand, reserved, display, damaged, in_transit)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [storeId, id, st.onHand, st.reserved, st.display, st.damaged, st.inTransit],
        );
      }
    }
    for (const [oldModel, newModel] of Object.entries(REPLACED_BY)) {
      await tx.query('UPDATE products SET replaced_by = $1 WHERE product_id = $2', [idByModel[newModel], idByModel[oldModel]]);
    }
  });
  return true;
}
