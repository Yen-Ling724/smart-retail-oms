// 每個分類的固定規格欄位（參考家電通路的篩選條件：坪數、能效、變頻、尺寸…）。
// type：
//   number      數字，單位由 unit 決定（例如 容量: 480）
//   select      下拉選單，只能選 options 裡的值；numeric: true 時選項是數字，存成數字（例如 電視尺寸 55）
//   dimensions  寬 × 深 × 高 三個數字，存成 { 寬, 深, 高 }，單位 cm
//   text        自由文字；suggestions 會變成輸入時的建議清單
// 數字一律存純數字，顯示時才加單位，方便之後篩選與 AI 查詢。

const ENERGY = ['1 級', '2 級', '3 級', '4 級', '5 級'];
const INVERTER = { key: '變頻', type: 'select', options: ['變頻', '定頻'] };
const FEATURE = { key: '特色', type: 'text', placeholder: '例：急速冷凍、App 控制（選填）' };

export const SPEC_TEMPLATES = {
  冰箱: [
    { key: '容量', type: 'number', unit: 'L', required: true, min: 50, max: 1000 },
    { key: '門數', type: 'select', options: ['單門', '雙門', '三門', '四門', '五門', '對開'], required: true },
    { key: '能效', type: 'select', options: ENERGY, required: true },
    INVERTER,
    { key: '尺寸', type: 'dimensions', unit: 'cm', min: 10, max: 300 },
    FEATURE,
  ],
  洗衣機: [
    { key: '容量', type: 'number', unit: 'kg', required: true, min: 3, max: 30 },
    { key: '類型', type: 'select', options: ['直立式', '滾筒'], required: true },
    { key: '能效', type: 'select', options: ENERGY },
    INVERTER,
    { key: '烘乾容量', type: 'number', unit: 'kg', min: 1, max: 20 },
    { key: '尺寸', type: 'dimensions', unit: 'cm', min: 10, max: 200 },
    FEATURE,
  ],
  冷氣: [
    { key: '適用坪數', type: 'select', options: ['2-3 坪', '3-4 坪', '4-5 坪', '5-6 坪', '6-7 坪', '7-9 坪', '9-11 坪', '11-14 坪', '14-17 坪'], required: true },
    { key: '類型', type: 'select', options: ['分離式', '窗型', '移動式'], required: true },
    { key: '冷暖', type: 'select', options: ['冷專', '冷暖'], required: true },
    { key: '能效', type: 'select', options: ENERGY, required: true },
    INVERTER,
    FEATURE,
  ],
  電視: [
    { key: '尺寸', type: 'select', numeric: true, unit: '吋', options: [32, 40, 43, 50, 55, 58, 65, 70, 75, 85, 98], required: true },
    { key: '解析度', type: 'select', options: ['HD', 'FHD', '4K', '8K'], required: true },
    { key: '面板', type: 'select', options: ['LCD', '量子點', 'Mini LED', 'OLED'] },
    { key: '系統', type: 'select', options: ['智慧電視', '一般電視'] },
    FEATURE,
  ],
  除濕機: [
    { key: '除濕量', type: 'select', numeric: true, unit: 'L/日', options: [6, 8, 10, 12, 14, 16, 18, 20, 22, 26, 30], required: true },
    { key: '適用坪數', type: 'select', numeric: true, unit: '坪', options: [5, 8, 10, 12, 15, 18, 20, 23, 26, 30, 35], required: true },
    { key: '能效', type: 'select', options: ENERGY },
    INVERTER,
    FEATURE,
  ],
  空氣清淨機: [
    { key: '適用坪數', type: 'select', numeric: true, unit: '坪', options: [5, 8, 10, 12, 15, 18, 20, 25, 30, 40, 50], required: true },
    { key: '濾網', type: 'select', options: ['HEPA H11', 'HEPA H12', 'HEPA H13', 'HEPA H14'], required: true },
    FEATURE,
  ],
  吸塵器: [
    { key: '類型', type: 'select', options: ['無線手持', '有線', '掃地機器人'], required: true },
    { key: '續航', type: 'select', numeric: true, unit: '分鐘', options: [20, 30, 40, 50, 60, 90, 120, 150, 180] },
    FEATURE,
  ],
  廚房家電: [
    { key: '類型', type: 'select', options: ['電子鍋', '氣炸鍋', '微波爐', '烤箱', '蒸烤爐', '飲水機', '其他'], required: true },
    {
      key: '容量', type: 'text', required: true, placeholder: '例：10 人份、6L',
      suggestions: ['3 人份', '6 人份', '10 人份', '3L', '4L', '5L', '6L', '20L', '25L', '30L', '32L'],
    },
    { key: '功率', type: 'number', unit: 'W', min: 1, max: 5000 },
    FEATURE,
  ],
};

// 保固下拉選單
export const WARRANTY_OPTIONS = ['1 年', '2 年', '3 年', '5 年', '10 年'];

// 「3年」「3 年」「3」都整理成「3 年」；空白代表沒填
export function normalizeWarranty(value) {
  const v = String(value ?? '').trim();
  if (!v) return null;
  const m = v.match(/^(\d{1,2})\s*年?$/);
  const normalized = m ? `${Number(m[1])} 年` : v;
  if (!WARRANTY_OPTIONS.includes(normalized)) throw new Error(`保固只能選：${WARRANTY_OPTIONS.join('、')}`);
  return normalized;
}

// 尺寸：接受 { 寬, 深, 高 } 或舊格式文字「68×70×178 cm」
function parseDimensions(raw, field) {
  let parts;
  if (typeof raw === 'object' && raw !== null) parts = [raw.寬, raw.深, raw.高];
  else parts = (String(raw).match(/\d+(?:\.\d+)?/g) ?? []);
  const filled = parts.filter((p) => p !== undefined && p !== null && String(p).trim() !== '');
  if (!filled.length) return null; // 三格都空 = 沒填
  if (parts.length !== 3 || filled.length !== 3) throw new Error(`規格「${field.key}」請把寬、深、高三格都填上數字`);
  const nums = parts.map(Number);
  if (nums.some((n) => !Number.isFinite(n) || n < field.min || n > field.max)) {
    throw new Error(`規格「${field.key}」的每一格都必須是 ${field.min}～${field.max} 的數字（cm）`);
  }
  return { 寬: nums[0], 深: nums[1], 高: nums[2] };
}

export const CATEGORIES = Object.keys(SPEC_TEMPLATES);

// 各分類可選的品牌（參考台灣家電通路常見品牌）。
// 品牌名稱僅用於情境示範；示範資料的型號、價格、庫存都是虛構的。
const OTHER = '其他品牌';
export const BRANDS = {
  冰箱: ['Panasonic 國際', 'HITACHI 日立', '三菱電機', 'TOSHIBA 東芝', 'LG 樂金', 'SAMSUNG 三星', 'SAMPO 聲寶', 'TECO 東元', OTHER],
  洗衣機: ['Panasonic 國際', 'HITACHI 日立', 'LG 樂金', 'SAMSUNG 三星', 'TOSHIBA 東芝', 'Whirlpool 惠而浦', 'SAMPO 聲寶', 'TECO 東元', OTHER],
  冷氣: ['HITACHI 日立', 'Panasonic 國際', '三菱電機', '三菱重工', '日本將軍', 'DAIKIN 大金', 'LG 樂金', 'SAMPO 聲寶', 'TECO 東元', 'HERAN 禾聯', OTHER],
  電視: ['SONY 索尼', 'Panasonic 國際', 'LG 樂金', 'SAMSUNG 三星', 'Philips 飛利浦', 'SAMPO 聲寶', 'HERAN 禾聯', 'TCL', OTHER],
  除濕機: ['Panasonic 國際', 'HITACHI 日立', '三菱電機', 'LG 樂金', 'SAMPO 聲寶', 'TECO 東元', OTHER],
  空氣清淨機: ['Panasonic 國際', 'SHARP 夏普', 'HITACHI 日立', 'dyson', 'Blueair', '3M', 'LG 樂金', OTHER],
  吸塵器: ['dyson', 'Panasonic 國際', 'HITACHI 日立', 'LG 樂金', 'iRobot', 'Electrolux 伊萊克斯', OTHER],
  廚房家電: ['TATUNG 大同', 'Panasonic 國際', 'ZOJIRUSHI 象印', 'TIGER 虎牌', 'Philips 飛利浦', 'SHARP 夏普', OTHER],
};

export function validateBrand(category, brand) {
  const list = BRANDS[category];
  if (!list) throw new Error(`分類必須是：${CATEGORIES.join('、')}`);
  if (!list.includes(brand)) throw new Error(`「${category}」的品牌只能選：${list.join('、')}`);
  return brand;
}

// 依分類檢查並整理規格；有問題就丟出錯誤訊息（中文，直接給使用者看）
export function validateSpecs(category, specs = {}) {
  const template = SPEC_TEMPLATES[category];
  if (!template) throw new Error(`分類必須是：${CATEGORIES.join('、')}`);
  if (typeof specs !== 'object' || specs === null || Array.isArray(specs)) throw new Error('規格格式不正確');

  const clean = {};
  const missing = []; // 沒填的必填規格，最後合併成一句
  const errors = []; // 其他錯誤：一次全部列出，不要只講第一個
  for (const field of template) {
    const raw = specs[field.key];
    if (field.type === 'dimensions') {
      let dims = null;
      try { dims = raw === undefined || raw === null ? null : parseDimensions(raw, field); } catch (err) { errors.push(err.message); continue; }
      if (dims) clean[field.key] = dims;
      else if (field.required) missing.push(field.key);
      continue;
    }
    const empty = raw === undefined || raw === null || String(raw).trim() === '';
    if (empty) {
      if (field.required) missing.push(field.key);
      continue;
    }
    if (field.type === 'select' && field.numeric) {
      const n = Number(raw);
      if (!field.options.includes(n)) { errors.push(`規格「${field.key}」只能選：${field.options.join('、')} ${field.unit ?? ''}`.trim()); continue; }
      clean[field.key] = n;
    } else if (field.type === 'number') {
      const n = Number(raw);
      if (!Number.isFinite(n)) { errors.push(`規格「${field.key}」必須是數字`); continue; }
      if ((field.min !== undefined && n < field.min) || (field.max !== undefined && n > field.max)) {
        errors.push(`規格「${field.key}」必須介於 ${field.min}～${field.max} ${field.unit ?? ''}`.trim());
        continue;
      }
      clean[field.key] = n;
    } else if (field.type === 'select') {
      const v = String(raw).trim();
      if (!field.options.includes(v)) { errors.push(`規格「${field.key}」只能選：${field.options.join('、')}`); continue; }
      clean[field.key] = v;
    } else {
      const v = String(raw).trim();
      if (v.length > 100) { errors.push(`規格「${field.key}」最多 100 字`); continue; }
      clean[field.key] = v;
    }
  }
  if (missing.length) errors.unshift(`請填寫規格「${missing.join('」「')}」`);
  if (errors.length) throw Object.assign(new Error(errors.join('；')), { errors });
  return clean; // 不在範本裡的欄位會被丟掉
}
