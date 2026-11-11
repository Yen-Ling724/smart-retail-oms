import { useCallback, useEffect, useState } from 'react'
import { api, formatPrice } from '../api.js'
import OrderForm from '../components/OrderForm.jsx'
import { Modal, Toast } from '../components/common.jsx'
import { useEscape, useToast } from '../hooks.js'
import { formatDateTime } from '../inventoryLabels.js'
import { FULFILLMENT, ORDER_STATUS, ORDER_TABS } from '../orderLabels.js'

function StatusBadge({ status }) {
  const s = ORDER_STATUS[status] ?? { label: status, tone: '' }
  return <span className={`badge ${s.tone}`}>{s.label}</span>
}

// 依狀態可以做的下一步
function actionsFor(order) {
  switch (order.status) {
    case 'pending':
      return [{ key: 'confirm', label: '確認並預留庫存', primary: true }, { key: 'cancel', label: '取消訂單' }]
    case 'reserved':
      return [{ key: 'ship', label: order.fulfillment === 'pickup' ? '顧客已取貨' : '出貨', primary: true }, { key: 'cancel', label: '取消訂單' }]
    case 'shipped':
      return [{ key: 'complete', label: '完成訂單', primary: true }]
    default:
      return []
  }
}

// ===== 訂單詳情側欄 =====
function OrderDetail({ orderNo, notice: initialNotice, onClose, onChanged }) {
  const [order, setOrder] = useState(null)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState(initialNotice?.error ?? '')
  const [notice, setNotice] = useState(initialNotice?.message ?? '')
  const [busy, setBusy] = useState(false)
  useEscape(onClose)

  useEffect(() => {
    api(`/orders/${orderNo}`).then((d) => setOrder(d.order)).catch((e) => setError(e.message))
  }, [orderNo])

  async function run(action) {
    let body = {}
    if (action === 'cancel') {
      const reason = window.prompt('取消原因（選填）：', '')
      if (reason === null) return
      body = { reason }
    }
    setBusy(true)
    setActionError('')
    setNotice('')
    try {
      const d = await api(`/orders/${orderNo}/${action}`, { method: 'POST', body })
      setOrder(d.order)
      setNotice(d.message)
      onChanged()
    } catch (err) {
      setActionError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label="訂單詳情" onClick={(e) => e.stopPropagation()}>
        <button className="icon-btn drawer-close" onClick={onClose} aria-label="關閉">×</button>
        {error && <p className="form-error" role="alert">{error}</p>}
        {!order && !error && <p className="muted">載入中…</p>}
        {order && (
          <>
            <p className="eyebrow">訂單 · {formatDateTime(order.created_at)}</p>
            <h2 className="drawer-title mono-title">{order.order_no}</h2>
            <div className="drawer-tags">
              <StatusBadge status={order.status} />
              <span className="badge">{FULFILLMENT[order.fulfillment]}</span>
              <span className="badge">{order.store_name}</span>
            </div>

            <dl className="spec-list order-info">
              <div><dt>顧客</dt><dd>{order.customer_name}</dd></div>
              <div><dt>手機</dt><dd>{order.customer_phone}</dd></div>
              {order.fulfillment === 'delivery' && <div className="span-2"><dt>收件地址</dt><dd>{order.delivery_address}</dd></div>}
              {order.note && <div className="span-2"><dt>備註</dt><dd>{order.note}</dd></div>}
            </dl>

            {notice && <p className="success-note" role="status">✓ {notice}</p>}
            {actionError && <p className="form-error" role="alert">{actionError}</p>}
            {actionsFor(order).length > 0 && (
              <div className="order-actions">
                {actionsFor(order).map((a) => (
                  <button key={a.key} type="button" className={`btn ${a.primary ? '' : 'ghost'}`} disabled={busy} onClick={() => run(a.key)}>
                    {a.label}
                  </button>
                ))}
              </div>
            )}

            <h3 className="drawer-heading">商品</h3>
            <div className="table-wrap">
              <table className="data-table compact">
                <thead><tr><th>商品</th><th>單價</th><th>數量</th><th>小計</th>{order.status === 'pending' && <th>此店可售</th>}</tr></thead>
                <tbody>
                  {order.items.map((it) => (
                    <tr key={it.product_id}>
                      <td><strong>{it.name}</strong><small>{it.product_id} · {it.model}</small></td>
                      <td>{formatPrice(it.unit_price)}</td>
                      <td>{it.qty}</td>
                      <td>{formatPrice(it.subtotal)}</td>
                      {order.status === 'pending' && (
                        <td className={(it.store_available ?? 0) < it.qty ? 'text-danger' : ''}>{it.store_available ?? 0}</td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="cart-total"><span>合計</span><strong>{formatPrice(order.total)}</strong></div>

            <h3 className="drawer-heading">處理紀錄</h3>
            <ol className="timeline">
              {order.history.map((h, i) => (
                <li key={i}>
                  <span className="muted-num">{formatDateTime(h.created_at)}</span>
                  <StatusBadge status={h.status} />
                  <span>{h.note}</span>
                </li>
              ))}
            </ol>
            <p className="hint">「已預留」會先扣掉可售、保留給這張訂單；出貨或取貨時才扣實體庫存。出貨前取消會把預留還回去。</p>
          </>
        )}
      </aside>
    </div>
  )
}

// ===== 訂單管理頁 =====
export default function Orders() {
  const [status, setStatus] = useState('open')
  const [store, setStore] = useState('')
  const [q, setQ] = useState('')
  const [query, setQuery] = useState('')
  const [stores, setStores] = useState([])
  const [regions, setRegions] = useState([])
  const [result, setResult] = useState({ key: null, orders: [], counts: {}, error: '' })
  const [tick, setTick] = useState(0)
  const [selected, setSelected] = useState(null) // { orderNo, notice }
  const [creating, setCreating] = useState(false)
  const [toast, setToast] = useToast()

  useEffect(() => {
    const t = setTimeout(() => setQuery(q), 250)
    return () => clearTimeout(t)
  }, [q])

  useEffect(() => {
    api('/stores').then((d) => { setStores(d.stores); setRegions(d.regions ?? []) }).catch(() => {})
  }, [])

  const key = new URLSearchParams({ status, store, q: query }).toString()
  const loading = result.key !== key
  useEffect(() => {
    let cancelled = false
    api(`/orders?${key}`)
      .then((d) => { if (!cancelled) setResult({ key, orders: d.orders, counts: d.counts, error: '' }) })
      .catch((e) => { if (!cancelled) setResult((r) => ({ ...r, key, error: e.message })) })
    return () => { cancelled = true }
  }, [key, tick])

  const reload = useCallback(() => setTick((t) => t + 1), [])
  const closeDetail = useCallback(() => setSelected(null), [])
  const counts = result.counts
  const countFor = (k) =>
    k === 'open' ? (counts.pending ?? 0) + (counts.reserved ?? 0) + (counts.shipped ?? 0)
      : k === '' ? Object.values(counts).reduce((a, b) => a + b, 0)
        : counts[k] ?? 0

  function created(order, reserveError) {
    setCreating(false)
    reload()
    setToast(`已建立訂單 ${order.order_no}`)
    setSelected({
      orderNo: order.order_no,
      notice: reserveError
        ? { error: `訂單已建立，但預留失敗：${reserveError}` }
        : { message: order.status === 'reserved' ? '訂單已建立並預留庫存' : '訂單已建立，待確認' },
    })
  }

  return (
    <section className="page" aria-labelledby="orders-heading">
      <div className="page-head">
        <div>
          <p className="eyebrow">MODULE 03</p>
          <h1 id="orders-heading">訂單管理</h1>
          <p className="muted">建立多商品訂單、預留門市庫存，並追蹤出貨與取貨。庫存不足時整張訂單不會預留，避免超賣。</p>
        </div>
        <button className="btn" onClick={() => setCreating(true)}>＋ 建立訂單</button>
      </div>

      <div className="tabs" role="tablist">
        {ORDER_TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={status === t.key} className={`tab ${status === t.key ? 'active' : ''}`} onClick={() => setStatus(t.key)}>
            {t.label}<span className="tab-count">{countFor(t.key)}</span>
          </button>
        ))}
      </div>

      <div className="toolbar">
        <input type="search" className="search" placeholder="搜尋訂單編號、顧客姓名或手機" value={q} onChange={(e) => setQ(e.target.value)} aria-label="搜尋訂單" />
        <select value={store} onChange={(e) => setStore(e.target.value)} aria-label="門市">
          <option value="">全部門市</option>
          {regions.map((r) => (
            <optgroup key={r} label={r}>
              {stores.filter((s) => s.region === r).map((s) => <option key={s.store_id} value={s.store_id}>{s.name}</option>)}
            </optgroup>
          ))}
        </select>
        <span className="result-count">{loading ? '載入中…' : `${result.orders.length} 張`}</span>
      </div>
      {result.error && <p className="form-error" role="alert">訂單載入失敗：{result.error}</p>}

      <div className="table-wrap card">
        <table className="data-table">
          <thead>
            <tr>
              <th>訂單編號</th><th>顧客</th><th>門市</th><th>取貨方式</th><th>商品</th>
              <th className="num">金額</th><th>狀態</th><th>建立時間</th>
            </tr>
          </thead>
          <tbody>
            {result.orders.map((o) => (
              <tr
                key={o.order_no}
                className="clickable"
                tabIndex={0}
                onClick={() => setSelected({ orderNo: o.order_no })}
                onKeyDown={(e) => { if (e.key === 'Enter') setSelected({ orderNo: o.order_no }) }}
              >
                <td className="mono">{o.order_no}</td>
                <td><strong>{o.customer_name}</strong><small>{o.customer_phone}</small></td>
                <td>{o.store_name}</td>
                <td>{FULFILLMENT[o.fulfillment]}</td>
                <td>{o.first_item}{o.item_count > 1 && <small>共 {o.item_count} 件</small>}</td>
                <td className="num">{formatPrice(o.total)}</td>
                <td><StatusBadge status={o.status} /></td>
                <td className="muted-num">{formatDateTime(o.created_at)}</td>
              </tr>
            ))}
            {!loading && !result.orders.length && <tr><td colSpan="8" className="empty">沒有符合條件的訂單</td></tr>}
          </tbody>
        </table>
      </div>

      {selected && (
        <OrderDetail key={selected.orderNo} orderNo={selected.orderNo} notice={selected.notice} onClose={closeDetail} onChanged={reload} />
      )}
      {creating && stores.length > 0 && (
        <Modal title="建立訂單" wide onClose={() => setCreating(false)}>
          <OrderForm stores={stores} regions={regions} onCreated={created} />
        </Modal>
      )}
      <Toast message={toast} />
    </section>
  )
}
