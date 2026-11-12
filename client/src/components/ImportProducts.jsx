import { useCallback, useEffect, useState } from 'react'
import { api } from '../api.js'
import { IMPORT_MAX_MB, IMPORT_MAX_ROWS, downloadTemplate, readImportFile } from '../importFile.js'
import { formatDateTime } from '../inventoryLabels.js'

const ACTION = {
  create: { label: '新增', tone: 'ok' },
  update: { label: '更新', tone: 'info' },
  unchanged: { label: '未變更', tone: 'muted' },
  error: { label: '錯誤', tone: 'danger' },
}

function SpecGuide({ templates }) {
  return (
    <details className="import-guide">
      <summary>各分類要填的規格欄位</summary>
      <ul>
        {Object.entries(templates).map(([category, fields]) => (
          <li key={category}>
            <b>{category}</b>：
            {fields.map((f, i) => (
              <span key={f.key}>
                {i > 0 && '、'}
                {f.type === 'dimensions' ? '寬／深／高(cm)' : f.key}
                {f.required && <em className="req">*</em>}
                {f.type === 'select' && <small>（{f.options.slice(0, 4).join('／')}{f.options.length > 4 ? '…' : ''}{f.unit ? ` ${f.unit}` : ''}）</small>}
              </span>
            ))}
          </li>
        ))}
      </ul>
    </details>
  )
}

// 商品匯入：選檔 → 預覽 → 確認 → 結果；下方是匯入紀錄（最近一次可復原）
export default function ImportProducts({ templates, onImported }) {
  const [step, setStep] = useState('pick') // pick | preview | done
  const [file, setFile] = useState(null)
  const [parsed, setParsed] = useState(null)
  const [preview, setPreview] = useState(null)
  const [onlyProblems, setOnlyProblems] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [batches, setBatches] = useState([])

  const loadBatches = useCallback(() => {
    api('/import/batches?type=products').then((d) => setBatches(d.batches)).catch(() => {})
  }, [])
  useEffect(loadBatches, [loadBatches])

  async function choose(e) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setError('')
    setMessage('')
    setBusy(true)
    try {
      const data = await readImportFile(f)
      const d = await api('/import/products/preview', { method: 'POST', body: { rows: data.rows } })
      setFile(f)
      setParsed(data)
      setPreview(d)
      setOnlyProblems(d.summary.error > 0)
      setStep('preview')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function commit() {
    setBusy(true)
    setError('')
    try {
      const d = await api('/import/products/commit', { method: 'POST', body: { rows: parsed.rows, filename: file.name } })
      setMessage(d.message)
      setStep('done')
      loadBatches()
      onImported?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function undo(batch) {
    if (!window.confirm(`確定要復原第 ${batch.id} 次匯入？新增的 ${batch.created_count} 項商品會被刪除，更新的 ${batch.updated_count} 項會改回匯入前的資料。`)) return
    setBusy(true)
    setError('')
    try {
      const d = await api(`/import/batches/${batch.id}/undo`, { method: 'POST' })
      setMessage(d.message)
      loadBatches()
      onImported?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  function reset() {
    setStep('pick')
    setFile(null)
    setParsed(null)
    setPreview(null)
    setError('')
  }

  const s = preview?.summary
  const shownRows = preview ? preview.rows.filter((r) => !onlyProblems || r.action === 'error') : []

  return (
    <div className="import">
      {step === 'pick' && (
        <>
          <ol className="import-steps">
            <li><b>下載範本</b>，照欄位填好（也可以直接用舊系統匯出的檔案，欄位名稱一樣就行）</li>
            <li><b>上傳</b> Excel（.xlsx）或 CSV 檔</li>
            <li>系統會<b>逐列檢查</b>，全部沒問題才能確認匯入</li>
          </ol>
          <div className="import-actions">
            <button type="button" className="btn ghost" onClick={downloadTemplate}>⬇ 下載範本</button>
            <label className={`btn ${busy ? 'disabled' : ''}`}>
              {busy ? '讀取中…' : '⬆ 選擇檔案'}
              <input type="file" accept=".xlsx,.csv" onChange={choose} disabled={busy} hidden />
            </label>
          </div>
          <p className="hint">
            每次最多 {IMPORT_MAX_ROWS} 列、{IMPORT_MAX_MB}MB。用「型號」判斷是不是同一個商品：已存在就更新、不存在就新增；更新時空白的格子代表「不修改」。
          </p>
          <SpecGuide templates={templates} />
        </>
      )}

      {step === 'preview' && preview && (
        <>
          <div className="import-file">
            <span>📄 {file?.name}</span>
            <button type="button" className="btn ghost small" onClick={reset}>重新選檔</button>
          </div>
          <div className="import-summary">
            <span className="badge ok">新增 {s.create}</span>
            <span className="badge info">更新 {s.update}</span>
            <span className="badge muted">未變更 {s.unchanged}</span>
            <span className={`badge ${s.error ? 'danger' : 'muted'}`}>錯誤 {s.error}</span>
            <label className="toggle"><input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} /> 只看有錯誤的列</label>
          </div>
          {s.error > 0 && (
            <p className="form-error">有 {s.error} 列需要修正，<b>整批都不會匯入</b>。請在試算表改好後「重新選檔」。</p>
          )}
          <div className="table-wrap card import-table">
            <table className="data-table">
              <thead><tr><th>列</th><th>型號</th><th>品名</th><th>分類</th><th>結果</th><th>說明</th></tr></thead>
              <tbody>
                {shownRows.map((r) => (
                  <tr key={r.row} className={r.action === 'error' ? 'row-error' : ''}>
                    <td className="mono">{r.row}</td>
                    <td className="mono">{r.model || '—'}</td>
                    <td>{r.name || '—'}</td>
                    <td>{r.category || '—'}</td>
                    <td><span className={`badge ${ACTION[r.action].tone}`}>{ACTION[r.action].label}</span></td>
                    <td className="import-note">
                      {r.action === 'error' ? r.errors.join('；') : r.action === 'update' ? `修改：${r.changes.join('、')}` : ''}
                    </td>
                  </tr>
                ))}
                {!shownRows.length && <tr><td colSpan="6" className="empty">沒有錯誤的列 👍</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="modal-actions">
            <button type="button" className="btn" onClick={commit} disabled={busy || s.error > 0 || !(s.create + s.update)}>
              {busy ? '匯入中…' : `確認匯入（新增 ${s.create}、更新 ${s.update}）`}
            </button>
          </div>
        </>
      )}

      {step === 'done' && (
        <div className="import-done">
          <p className="success-note">✓ {message}</p>
          <button type="button" className="btn ghost" onClick={reset}>再匯入一個檔案</button>
        </div>
      )}

      {step !== 'done' && message && <p className="success-note">✓ {message}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}

      {batches.length > 0 && (
        <section className="import-history">
          <h3>匯入紀錄</h3>
          <ul>
            {batches.map((b) => (
              <li key={b.id} className={b.status === 'undone' ? 'undone' : ''}>
                <span className="mono">#{b.id}</span>
                <span className="muted-num">{formatDateTime(b.created_at)}</span>
                <span className="import-history-file">{b.filename || '（未命名）'}</span>
                <span>新增 {b.created_count}・更新 {b.updated_count}</span>
                {b.status === 'undone'
                  ? <span className="badge muted">已復原</span>
                  : b.can_undo && <button type="button" className="btn ghost small" onClick={() => undo(b)} disabled={busy}>復原</button>}
              </li>
            ))}
          </ul>
          <p className="hint">只能復原最近一次的匯入；如果匯入的商品已經有進貨、訂單或調貨，就不能復原。</p>
        </section>
      )}
    </div>
  )
}
