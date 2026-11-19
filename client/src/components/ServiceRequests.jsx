import { useCallback, useEffect, useState } from 'react'
import { api, formatPrice } from '../api.js'
import { useEscape } from '../hooks.js'
import { formatDateTime } from '../inventoryLabels.js'

// 3D 坪數選購頁送進來的「請門市報價／預約場勘／到店諮詢」
export const REQUEST_TYPE = { quote: '請門市報價', survey: '到府場勘', visit: '到店諮詢' }
export const REQUEST_STATUS = {
  new: { label: '新進', tone: 'warn' },
  contacted: { label: '已聯絡', tone: 'info' },
  scheduled: { label: '已排定', tone: 'info' },
  done: { label: '已完成', tone: 'ok' },
  cancelled: { label: '已取消', tone: 'muted' },
}
const NEXT = {
  new: ['contacted', 'scheduled', 'cancelled'],
  contacted: ['scheduled', 'done', 'cancelled'],
  scheduled: ['done', 'cancelled'],
  done: [],
  cancelled: [],
}
const NEXT_LABEL = { contacted: '標記已聯絡', scheduled: '已排定時間', done: '標記完成', cancelled: '取消' }
const TABS = [
  { key: 'open', label: '待處理' },
  { key: 'new', label: '新進' },
  { key: 'contacted', label: '已聯絡' },
  { key: 'scheduled', label: '已排定' },
  { key: 'done', label: '已完成' },
  { key: 'cancelled', label: '已取消' },
  { key: '', label: '全部' },
]
const ROOM = { bedroom: '臥室', living: '客廳', study: '書房' }

function StatusBadge({ status }) {
  const s = REQUEST_STATUS[status] ?? { label: status, tone: '' }
  return <span className={`badge ${s.tone}`}>{s.label}</span>
}

function roomText(room) {
  if (!room) return ''
  const parts = []
  if (room.ping) parts.push(`${room.ping} 坪${ROOM[room.room] ?? ''}`)
  if (room.west) parts.push('西曬')
  if (room.top) parts.push('頂樓')
  if (room.people) parts.push(`${room.people} 人`)
  if (room.eff_ping && room.eff_ping !== room.ping) parts.push(`修正需求 ${room.eff_ping} 坪`)
  return parts.join('、')
}

function RequestDetail({ request, onClose, onChanged, onOpenOrder }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState(request.staff_note ?? '')
  useEscape(onClose)

  async function run(fn) {
    setBusy(true)
    setError('')
    try {
      await fn()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }
  const setStatus = (status) => run(async () => {
    await api(`/service-requests/${request.request_no}`, { method: 'PATCH', body: { status, staff_note: note } })
    onChanged(`${request.request_no} 已改為「${REQUEST_STATUS[status].label}」`)
  })
  const saveNote = () => run(async () => {
    await api(`/service-requests/${request.request_no}`, { method: 'PATCH', body: { staff_note: note } })
    onChanged('已儲存門市備註')
  })
  const convert = () => run(async () => {
    const d = await api(`/service-requests/${request.request_no}/convert`, { method: 'POST' })
    onChanged(`已轉成訂單 ${d.order_no}`)
    onOpenOrder(d.order_no)
  })

  const r = request
  const canConvert = !r.order_no && r.status !== 'cancelled'
  return (
    <div className="overlay" onClick={onClose}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label="報價／預約詳情" onClick={(e) => e.stopPropagation()}>
        <button className="icon-btn drawer-close" onClick={onClose} aria-label="關閉">×</button>
        <p className="eyebrow">{REQUEST_TYPE[r.type]} · {formatDateTime(r.created_at)}</p>
        <h2 className="drawer-title mono-title">{r.request_no}</h2>
        <div className="drawer-tags">
          <StatusBadge status={r.status} />
          <span className="badge">{r.store_name}</span>
          <span className="badge">{r.source === 'staff' ? '店員代填' : '顧客自填'}</span>
          {r.order_no && <span className="badge ok">已轉訂單 {r.order_no}</span>}
        </div>

        <dl className="spec-list order-info">
          <div><dt>顧客</dt><dd>{r.customer_name}</dd></div>
          <div><dt>手機</dt><dd>{r.phone}</dd></div>
          <div><dt>縣市</dt><dd>{r.county || '—'}</dd></div>
          {r.floor && <div><dt>安裝樓層</dt><dd>{r.floor} 樓</dd></div>}
          {(r.preferred_date || r.slot) && <div><dt>{r.type === 'quote' ? '聯絡時段' : '希望日期'}</dt><dd>{r.preferred_date ? new Date(r.preferred_date).toLocaleDateString('zh-TW') : ''} {r.slot}</dd></div>}
          <div className="span-2"><dt>商品</dt><dd>{r.product_name}<small className="muted"> · {r.model}</small></dd></div>
          <div><dt>詢問時售價</dt><dd>{formatPrice(r.quoted_price)}</dd></div>
          <div><dt>{r.store_name}可售</dt><dd className={r.store_available > 0 ? '' : 'text-danger'}>{r.store_available ?? 0} 台</dd></div>
          {roomText(r.room) && <div className="span-2"><dt>房間條件</dt><dd>{roomText(r.room)}</dd></div>}
          {r.memo && <div className="span-2"><dt>顧客備註</dt><dd>{r.memo}</dd></div>}
        </dl>

        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="order-actions">
          {canConvert && <button type="button" className="btn" disabled={busy} onClick={convert}>轉成訂單</button>}
          {NEXT[r.status].map((s) => (
            <button key={s} type="button" className="btn ghost" disabled={busy} onClick={() => setStatus(s)}>{NEXT_LABEL[s]}</button>
          ))}
          {r.order_no && <button type="button" className="btn ghost" onClick={() => onOpenOrder(r.order_no)}>查看訂單</button>}
        </div>

        <h3 className="drawer-heading">門市備註</h3>
        <textarea className="note-input" rows="3" maxLength="200" value={note} onChange={(e) => setNote(e.target.value)} placeholder="例：已約 11/22 上午場勘，需加長管線" />
        <div className="order-actions"><button type="button" className="btn ghost" disabled={busy || note === (r.staff_note ?? '')} onClick={saveNote}>儲存備註</button></div>
        <p className="hint">「轉成訂單」會用這張單的顧客、商品、門市建立一張待確認訂單（數量 1、門市自取），接著可在訂單頁確認並預留庫存。</p>
      </aside>
    </div>
  )
}

export default function ServiceRequests({ stores, regions, onOpenOrder, onToast, onCounts }) {
  const [status, setStatus] = useState('open')
  const [store, setStore] = useState('')
  const [result, setResult] = useState({ key: null, requests: [], counts: {}, error: '' })
  const [tick, setTick] = useState(0)
  const [selected, setSelected] = useState(null)

  const key = new URLSearchParams({ status: status === 'open' ? '' : status, store_id: store }).toString()
  const loading = result.key !== `${key}#${tick}`
  useEffect(() => {
    let cancelled = false
    api(`/service-requests?${key}`)
      .then((d) => {
        if (cancelled) return
        setResult({ key: `${key}#${tick}`, requests: d.requests, counts: d.counts, error: '' })
        onCounts?.(d.counts)
      })
      .catch((e) => { if (!cancelled) setResult((r) => ({ ...r, key: `${key}#${tick}`, error: e.message })) })
    return () => { cancelled = true }
  }, [key, tick, onCounts])

  const counts = result.counts
  const countFor = (k) =>
    k === 'open' ? (counts.new ?? 0) + (counts.contacted ?? 0) + (counts.scheduled ?? 0)
      : k === '' ? Object.values(counts).reduce((a, b) => a + b, 0)
        : counts[k] ?? 0
  const rows = status === 'open' ? result.requests.filter((r) => ['new', 'contacted', 'scheduled'].includes(r.status)) : result.requests
  const current = selected && result.requests.find((r) => r.request_no === selected)

  const changed = useCallback((message) => { onToast(message); setTick((t) => t + 1) }, [onToast])

  return (
    <>
      <p className="muted section-intro">
        顧客或店員在 <a href="/room-fit.html?view=staff" target="_blank" rel="noopener">3D 坪數選購 ↗</a> 送出的報價與預約。
        門市聯絡顧客後更新狀態，確定購買可直接轉成訂單。
      </p>
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={status === t.key} className={`tab ${status === t.key ? 'active' : ''}`} onClick={() => setStatus(t.key)}>
            {t.label}<span className="tab-count">{countFor(t.key)}</span>
          </button>
        ))}
      </div>
      <div className="toolbar">
        <select value={store} onChange={(e) => setStore(e.target.value)} aria-label="門市">
          <option value="">全部門市</option>
          {regions.map((r) => (
            <optgroup key={r} label={r}>
              {stores.filter((s) => s.region === r).map((s) => <option key={s.store_id} value={s.store_id}>{s.name}</option>)}
            </optgroup>
          ))}
        </select>
        <span className="result-count">{loading ? '載入中…' : `${rows.length} 張`}</span>
      </div>
      {result.error && <p className="form-error" role="alert">載入失敗：{result.error}</p>}

      <div className="table-wrap card">
        <table className="data-table req-table">
          <thead>
            <tr><th>單號</th><th>類型</th><th>顧客</th><th>門市</th><th>商品</th><th>房間條件</th><th>希望日期</th><th>狀態</th><th>建立時間</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.request_no} className="clickable" tabIndex={0} onClick={() => setSelected(r.request_no)} onKeyDown={(e) => { if (e.key === 'Enter') setSelected(r.request_no) }}>
                <td className="mono">{r.request_no}</td>
                <td>{REQUEST_TYPE[r.type]}<small>{r.source === 'staff' ? '店員代填' : '顧客自填'}</small></td>
                <td><strong>{r.customer_name}</strong><small>{r.phone}</small></td>
                <td>{r.store_name}<small className={r.store_available > 0 ? '' : 'text-danger'}>此店可售 {r.store_available ?? 0}</small></td>
                <td>{r.product_name}<small>{r.model}</small></td>
                <td>{roomText(r.room) || '—'}</td>
                <td className="muted-num">{r.preferred_date ? new Date(r.preferred_date).toLocaleDateString('zh-TW') : '—'}</td>
                <td><StatusBadge status={r.status} />{r.order_no && <small>→ {r.order_no}</small>}</td>
                <td className="muted-num">{formatDateTime(r.created_at)}</td>
              </tr>
            ))}
            {!loading && !rows.length && <tr><td colSpan="9" className="empty">沒有符合條件的報價或預約</td></tr>}
          </tbody>
        </table>
      </div>

      {current && (
        <RequestDetail key={current.request_no + current.status} request={current} onClose={() => setSelected(null)} onChanged={changed} onOpenOrder={(no) => { setSelected(null); onOpenOrder(no) }} />
      )}
    </>
  )
}
