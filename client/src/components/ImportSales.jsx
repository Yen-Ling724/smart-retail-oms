import { useState } from 'react'
import { api } from '../api.js'
import { readImportFile } from '../importFile.js'

// 06 需求預測：匯入冷氣銷售資料（選檔 → 檢查與預覽 → 確認匯入）
// 欄位名稱用常見說法都認得，POS／ERP 匯出的檔案通常不用改欄位名稱就能用
const ALIASES = {
  month: ['月份', '年月', '銷售月份', '日期', '銷售日期', '交易日期', '月', 'month', 'date'],
  store: ['門市代碼', '門市編號', '門市', '門市名稱', '店別', '分店', '店名', '店號', 'store'],
  tier: ['坪數級距', '適用坪數', '坪數', '級距', 'tier'],
  model: ['型號', '商品型號', '機型', 'model'],
  units: ['銷售台數', '台數', '銷售數量', '數量', '銷量', 'units', 'qty'],
  category: ['分類', '品類', '商品分類', '類別', 'category'],
}
const lower = (names) => names.map((n) => String(n).toLowerCase())
const findCols = (names, list) => list.map((a) => lower(names).indexOf(a.toLowerCase())).filter((i) => i >= 0).map((i) => names[i])

const MAX_ROWS = 100000
const MAX_MB = 15
const fmt = (n) => Number(n).toLocaleString('zh-TW')

function csvDownload(name, lines) {
  const csv = '﻿' + lines.map((r) => r.join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function downloadSalesTemplate() {
  csvDownload('冷氣銷售匯入範本.csv', [
    ['月份', '門市', '型號', '坪數級距', '銷售台數'],
    ['2026-07', 'TN01', '', '5-6 坪', '12'],
    ['2026-07', '中華西店', 'CU-UJ22BCA2/CS-UJ22BA2', '', '3'],
    ['2026/7/18', '永康門市', 'LSU22DST', '', '1'],
  ])
}

// 每月合計的小長條圖：確認資料有沒有夏季旺季、有沒有月份是空的
function MonthlyBars({ monthly }) {
  const max = Math.max(...monthly.map((m) => m.units), 1)
  return (
    <div className="si-bars" role="img" aria-label="每月銷售合計">
      {monthly.map((m) => (
        <span key={m.month} title={`${m.month}：${fmt(m.units)} 台`} style={{ height: `${Math.max((m.units / max) * 100, m.units ? 3 : 0)}%` }} className={m.units ? '' : 'zero'} />
      ))}
    </div>
  )
}

export default function ImportSales({ mode, onImported, onClose }) {
  const [step, setStep] = useState('pick')
  const [file, setFile] = useState(null)
  const [rows, setRows] = useState(null)
  const [preview, setPreview] = useState(null)
  const [skipErrors, setSkipErrors] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  async function choose(e) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setError('')
    setBusy('讀取檔案中…')
    try {
      let cols = null
      const data = await readImportFile(f, {
        maxRows: MAX_ROWS,
        maxMb: MAX_MB,
        isHeader: (names) => findCols(names, ALIASES.month).length > 0 && findCols(names, ALIASES.units).length > 0,
        headerError: '找不到「月份」和「銷售台數」欄位。請使用範本，或確認第一列是欄位名稱',
      })
      cols = Object.fromEntries(Object.entries(ALIASES).map(([k, list]) => [k, findCols(data.headers, list)]))
      if (!cols.store.length) throw new Error('找不到「門市」欄位（門市代碼或門市名稱）')
      if (!cols.tier.length && !cols.model.length) throw new Error('找不到「型號」或「坪數級距」欄位，至少要有一個')
      const pick = (cells, keys) => {
        for (const k of keys) if (cells[k] !== undefined && String(cells[k]).trim() !== '') return cells[k]
        return ''
      }
      const mapped = data.rows.map(({ row, cells }) => ({
        row,
        month: pick(cells, cols.month),
        store: pick(cells, cols.store),
        tier: pick(cells, cols.tier),
        model: pick(cells, cols.model),
        units: pick(cells, cols.units),
        category: pick(cells, cols.category),
      }))
      setBusy('檢查資料中…')
      const d = await api('/import/sales/preview', { method: 'POST', body: { rows: mapped } })
      setFile(f)
      setRows(mapped)
      setPreview(d)
      setSkipErrors(false)
      setStep('preview')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy('')
    }
  }

  async function commit() {
    setBusy('匯入中…')
    setError('')
    try {
      const d = await api('/import/sales/commit', { method: 'POST', body: { rows, filename: file.name, skip_errors: skipErrors } })
      setMessage(d.message)
      setStep('done')
      onImported?.(d)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy('')
    }
  }

  const s = preview?.summary
  return (
    <div className="import">
      {step === 'pick' && (
        <>
          <ol className="import-steps">
            <li><b>準備資料</b>：每一列一筆銷售，需要「月份、門市、型號或坪數級距、銷售台數」4 個欄位</li>
            <li><b>上傳</b> Excel（.xlsx）或 CSV；每天、每筆交易的資料也可以，系統會加總成每月</li>
            <li>系統會<b>檢查並預覽</b>，確認沒問題才匯入</li>
          </ol>
          <div className="import-actions">
            <button type="button" className="btn ghost" onClick={downloadSalesTemplate}>⬇ 下載範本</button>
            {mode === 'db' && <a className="btn ghost" href="/api/forecast/export.csv" download>⬇ 下載目前的資料（完整範例）</a>}
            <label className={`btn ${busy ? 'disabled' : ''}`}>
              {busy || '⬆ 選擇檔案'}
              <input type="file" accept=".xlsx,.csv" onChange={choose} disabled={!!busy} hidden />
            </label>
          </div>
          <details className="import-guide" open>
            <summary>欄位怎麼填</summary>
            <ul>
              <li><b>月份</b>：2026-07、2026/7、2026/7/18、2026年7月、民國 115/07 都可以</li>
              <li><b>門市</b>：門市代碼（TN01）、官網門市編號或門市名稱（中華西店）</li>
              <li><b>型號</b>或<b>坪數級距</b>：填型號會自動查出適用坪數（分離式填室內機或室外機型號都可以）；查不到的型號請改填坪數級距，例如「5-6 坪」</li>
              <li><b>銷售台數</b>：退貨可以填負數；有「分類」欄位時，只會讀取冷氣</li>
              <li>至少需要<b>連續 24 個月</b>的資料，才能估計季節性</li>
            </ul>
          </details>
          <p className="hint">
            {mode === 'browser'
              ? '這是公開的展示網站：匯入的資料只會存在你這台電腦的瀏覽器，不會存進網站的資料庫，其他人看不到。仍建議不要上傳公司機密資料。'
              : '匯入後會取代目前的冷氣銷售歷史，隨時可以按「還原模擬資料」回到示範狀態。'}
            {' '}最多 {fmt(MAX_ROWS)} 列、{MAX_MB}MB。
          </p>
        </>
      )}

      {step === 'preview' && preview && (
        <>
          <div className="import-file">
            <span>📄 {file?.name}</span>
            <button type="button" className="btn ghost small" onClick={() => { setStep('pick'); setPreview(null) }}>重新選檔</button>
          </div>
          <div className="si-summary">
            <div><span>期間</span><strong>{s.month_from ? `${s.month_from}～${s.month_to}` : '—'}</strong><small>{s.month_count} 個月</small></div>
            <div><span>門市</span><strong>{s.store_count} 間</strong><small>{preview.stores.slice(0, 3).map((x) => x.name).join('、')}{preview.stores.length > 3 ? '…' : ''}</small></div>
            <div><span>銷售合計</span><strong>{fmt(s.total_units)} 台</strong><small>可用 {fmt(s.used_rows)} / {fmt(s.total_rows)} 列</small></div>
            <div className={s.error_rows ? 'bad' : ''}><span>有問題的列</span><strong>{fmt(s.error_rows)}</strong><small>{s.skipped_rows ? `另有 ${fmt(s.skipped_rows)} 列不是冷氣，已略過` : '　'}</small></div>
          </div>
          {preview.monthly.length > 0 && (
            <div className="si-monthly">
              <span className="muted">每月合計（滑過看數字）</span>
              <MonthlyBars monthly={preview.monthly} />
            </div>
          )}
          {(preview.notes.length > 0 || s.missing_months.length > 0) && (
            <ul className="si-notes">
              {s.missing_months.length > 0 && <li>⚠ 有 {s.missing_months.length} 個月沒有資料，以 0 計：{s.missing_months.slice(0, 6).join('、')}{s.missing_months.length > 6 ? '…' : ''}</li>}
              {preview.notes.map((n) => <li key={n}>ℹ {n}</li>)}
            </ul>
          )}
          {!preview.can_import && <p className="form-error">{preview.block_reason}</p>}
          {preview.errors.length > 0 && (
            <div className="table-wrap card import-table">
              <table className="data-table compact">
                <thead><tr><th>列</th><th>問題</th></tr></thead>
                <tbody>
                  {preview.errors.map((r) => (
                    <tr key={r.row} className="row-error"><td className="mono">{r.row}</td><td className="import-note">{r.errors.join('；')}</td></tr>
                  ))}
                </tbody>
              </table>
              {s.error_rows > preview.errors.length && <p className="hint">只列出前 {preview.errors.length} 列</p>}
            </div>
          )}
          <div className="modal-actions">
            {s.error_rows > 0 && preview.can_import && (
              <label className="check-inline"><input type="checkbox" checked={skipErrors} onChange={(e) => setSkipErrors(e.target.checked)} /> 略過 {fmt(s.error_rows)} 列有問題的資料</label>
            )}
            <button type="button" className="btn" onClick={commit} disabled={!!busy || !preview.can_import || (s.error_rows > 0 && !skipErrors)}>
              {busy || `確認匯入（${s.month_count} 個月、${s.store_count} 間門市）`}
            </button>
          </div>
        </>
      )}

      {step === 'done' && (
        <div className="import-done">
          <p className="success-note">✓ {message}，預測已改用這份資料重新計算。</p>
          <button type="button" className="btn" onClick={onClose}>看預測結果</button>
        </div>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  )
}
