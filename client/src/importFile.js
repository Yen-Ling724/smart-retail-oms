// 讀取匯入用的試算表（Excel .xlsx 或 CSV），以及產生範本檔
// 讀 Excel 的套件比較大，等使用者真的選了 .xlsx 才載入，平常開網站不會變慢

export const IMPORT_MAX_ROWS = 1000
export const IMPORT_MAX_MB = 2

// 範本欄位：* 是必填（新增商品時）；規格欄位只要填該分類有的就好
export const TEMPLATE_COLUMNS = [
  '型號*', '品名*', '分類*', '品牌*', '原價*', '售價*', '保固', '上架',
  '容量', '門數', '能效', '變頻', '類型', '烘乾容量', '適用坪數', '冷暖',
  '尺寸', '寬(cm)', '深(cm)', '高(cm)', '解析度', '面板', '系統',
  '除濕量', '濾網', '續航', '功率', '特色',
]

const EXAMPLES = [
  { '型號*': 'DM-NEW-RF01', '品名*': 'Panasonic 450L 變頻雙門冰箱', '分類*': '冰箱', '品牌*': 'Panasonic 國際', '原價*': 29900, '售價*': 27900, 保固: '3 年', 上架: '是', 容量: 450, 門數: '雙門', 能效: '1 級', 變頻: '變頻', '寬(cm)': 60, '深(cm)': 65, '高(cm)': 170, 特色: '急速冷凍' },
  { '型號*': 'DM-NEW-TV01', '品名*': 'SONY 55 吋 4K 智慧電視', '分類*': '電視', '品牌*': 'SONY 索尼', '原價*': 22900, '售價*': 19900, 保固: '2 年', 上架: '是', 尺寸: 55, 解析度: '4K', 面板: 'LCD', 系統: '智慧電視' },
]

// 欄位名稱整理：「型號*」「原價（元）」「寬(cm)」→「型號」「原價」「寬」
export const normalizeHeader = (h) =>
  String(h ?? '').replace(/[*＊]/g, '').replace(/[(（][^)）]*[)）]/g, '').replace(/\s+/g, '').trim()

const csvCell = (v) => {
  const s = v === undefined || v === null ? '' : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// 下載範本：CSV 前面加 BOM，Excel 打開中文才不會變亂碼
export function downloadTemplate() {
  const lines = [TEMPLATE_COLUMNS, ...EXAMPLES.map((e) => TEMPLATE_COLUMNS.map((c) => e[c] ?? ''))]
  const csv = '﻿' + lines.map((r) => r.map(csvCell).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = '商品匯入範本.csv'
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// 簡單的 CSV 解析：支援雙引號、引號內的逗號與換行
function parseCsv(text) {
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++ }
      else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell); rows.push(row); row = []; cell = ''
    } else cell += c
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row) }
  return rows
}

// CSV 可能是 UTF-8（Google 試算表、新版 Excel）或 Big5（舊版 Excel 存的）
function decodeCsv(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^﻿/, '')
  } catch {
    return new TextDecoder('big5').decode(buffer)
  }
}

// 讀檔 → { rows: [{ row: 試算表列號, cells: { 欄位名稱: 值 } }] }
export async function readImportFile(file) {
  if (file.size > IMPORT_MAX_MB * 1024 * 1024) throw new Error(`檔案超過 ${IMPORT_MAX_MB}MB，請分批匯入`)
  const name = file.name.toLowerCase()
  let grid
  if (name.endsWith('.xlsx')) {
    const { readSheet } = await import('read-excel-file/browser')
    grid = await readSheet(file)
  } else if (name.endsWith('.csv')) {
    grid = parseCsv(decodeCsv(await file.arrayBuffer()))
  } else if (name.endsWith('.xls')) {
    throw new Error('不支援舊版 .xls，請在 Excel 另存成 .xlsx 或 .csv')
  } else {
    throw new Error('只支援 Excel（.xlsx）或 CSV（.csv）檔案')
  }

  const headerIndex = grid.findIndex((r) => r.some((c) => normalizeHeader(c) === '型號'))
  if (headerIndex < 0) throw new Error('找不到「型號」欄位。請使用範本，第一列要是欄位名稱')
  const headers = grid[headerIndex].map(normalizeHeader)

  const rows = []
  for (let i = headerIndex + 1; i < grid.length; i++) {
    const values = grid[i] ?? []
    if (values.every((v) => v === null || v === undefined || String(v).trim() === '')) continue // 空白列略過
    const cells = {}
    headers.forEach((h, j) => {
      if (h && values[j] !== null && values[j] !== undefined) cells[h] = values[j] instanceof Date ? values[j].toISOString().slice(0, 10) : values[j]
    })
    rows.push({ row: i + 1, cells })
  }
  if (!rows.length) throw new Error('檔案裡沒有資料列')
  if (rows.length > IMPORT_MAX_ROWS) throw new Error(`一次最多匯入 ${IMPORT_MAX_ROWS} 列，這個檔案有 ${rows.length} 列，請分批匯入`)
  return { rows, headers: headers.filter(Boolean) }
}
