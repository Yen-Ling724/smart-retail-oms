// 每個分類的固定規格欄位。
// type：number（數字，單位由 unit 決定）、select（只能選 options 裡的值）、text（自由文字）
// 數字欄位在資料庫存純數字（例如 容量: 480），顯示時才加上單位，方便之後篩選與 AI 查詢。

const ENERGY = ['1 級', '2 級', '3 級', '4 級', '5 級'];
const FEATURE = { key: '特色', type: 'text', placeholder: '例：變頻、App 控制（選填）' };

export const SPEC_TEMPLATES = {
  冰箱: [
    { key: '容量', type: 'number', unit: 'L', required: true, min: 50, max: 1000 },
    { key: '門數', type: 'select', options: ['單門', '雙門', '三門', '四門', '五門', '對開'], required: true },
    { key: '能效', type: 'select', options: ENERGY, required: true },
    { key: '尺寸', type: 'text', placeholder: '寬×深×高 cm（選填）' },
    FEATURE,
  ],
  洗衣機: [
    { key: '容量', type: 'number', unit: 'kg', required: true, min: 3, max: 30 },
    { key: '類型', type: 'select', options: ['直立式', '滾筒'], required: true },
    { key: '能效', type: 'select', options: ENERGY },
    { key: '烘乾容量', type: 'number', unit: 'kg', min: 1, max: 20 },
    FEATURE,
  ],
  冷氣: [
    { key: '適用坪數', type: 'select', options: ['2-3 坪', '3-4 坪', '4-5 坪', '5-6 坪', '6-7 坪', '7-9 坪', '9-11 坪', '11-14 坪'], required: true },
    { key: '類型', type: 'select', options: ['分離式', '窗型', '移動式'], required: true },
    { key: '冷暖', type: 'select', options: ['冷專', '冷暖'], required: true },
    { key: '能效', type: 'select', options: ENERGY, required: true },
    FEATURE,
  ],
  電視: [
    { key: '尺寸', type: 'number', unit: '吋', required: true, min: 20, max: 120 },
    { key: '解析度', type: 'select', options: ['HD', 'FHD', '4K', '8K'], required: true },
    { key: '面板', type: 'select', options: ['LCD', '量子點', 'Mini LED', 'OLED'] },
    { key: '系統', type: 'select', options: ['智慧電視', '一般電視'] },
    FEATURE,
  ],
  除濕機: [
    { key: '除濕量', type: 'number', unit: 'L/日', required: true, min: 1, max: 60 },
    { key: '適用坪數', type: 'number', unit: '坪', required: true, min: 1, max: 60 },
    { key: '能效', type: 'select', options: ENERGY },
    FEATURE,
  ],
  空氣清淨機: [
    { key: '適用坪數', type: 'number', unit: '坪', required: true, min: 1, max: 60 },
    { key: '濾網', type: 'select', options: ['HEPA H11', 'HEPA H12', 'HEPA H13', 'HEPA H14'], required: true },
    FEATURE,
  ],
  吸塵器: [
    { key: '類型', type: 'select', options: ['無線手持', '有線', '掃地機器人'], required: true },
    { key: '續航', type: 'number', unit: '分鐘', min: 1, max: 300 },
    FEATURE,
  ],
  廚房家電: [
    { key: '類型', type: 'select', options: ['電子鍋', '氣炸鍋', '微波爐', '烤箱', '蒸烤爐', '飲水機', '其他'], required: true },
    { key: '容量', type: 'text', required: true, placeholder: '例：10 人份、6L' },
    { key: '功率', type: 'number', unit: 'W', min: 1, max: 5000 },
    FEATURE,
  ],
};

export const CATEGORIES = Object.keys(SPEC_TEMPLATES);

// 依分類檢查並整理規格；有問題就丟出錯誤訊息（中文，直接給使用者看）
export function validateSpecs(category, specs = {}) {
  const template = SPEC_TEMPLATES[category];
  if (!template) throw new Error(`分類必須是：${CATEGORIES.join('、')}`);
  if (typeof specs !== 'object' || specs === null || Array.isArray(specs)) throw new Error('規格格式不正確');

  const clean = {};
  for (const field of template) {
    const raw = specs[field.key];
    const empty = raw === undefined || raw === null || String(raw).trim() === '';
    if (empty) {
      if (field.required) throw new Error(`請填寫規格「${field.key}」`);
      continue;
    }
    if (field.type === 'number') {
      const n = Number(raw);
      if (!Number.isFinite(n)) throw new Error(`規格「${field.key}」必須是數字`);
      if ((field.min !== undefined && n < field.min) || (field.max !== undefined && n > field.max)) {
        throw new Error(`規格「${field.key}」必須介於 ${field.min}～${field.max} ${field.unit ?? ''}`.trim());
      }
      clean[field.key] = n;
    } else if (field.type === 'select') {
      const v = String(raw).trim();
      if (!field.options.includes(v)) throw new Error(`規格「${field.key}」只能選：${field.options.join('、')}`);
      clean[field.key] = v;
    } else {
      const v = String(raw).trim();
      if (v.length > 100) throw new Error(`規格「${field.key}」最多 100 字`);
      clean[field.key] = v;
    }
  }
  return clean; // 不在範本裡的欄位會被丟掉
}
