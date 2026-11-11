import { useEffect, useMemo, useState } from 'react'
import { api, formatPrice } from '../api.js'

// 建立訂單（購物車）。左邊挑商品、右邊是購物車與顧客資料
export default function OrderForm({ stores, regions, onCreated }) {
  const [storeId, setStoreId] = useState(stores[0]?.store_id ?? '')
  const [fulfillment, setFulfillment] = useState('pickup')
  const [products, setProducts] = useState([])
  const [stock, setStock] = useState({ store: '', rows: {} })
  const [q, setQ] = useState('')
  const [category, setCategory] = useState('')
  const [cart, setCart] = useState([]) // [{ product_id, name, model, price, qty }]
  const [customer, setCustomer] = useState({ name: '', phone: '' })
  const [address, setAddress] = useState('')
  const [note, setNote] = useState('')
  const [reserveNow, setReserveNow] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api('/products?status=active').then((d) => setProducts(d.products)).catch((e) => setError(e.message))
  }, [])

  // 選定門市的可售數量
  useEffect(() => {
    if (!storeId) return
    let cancelled = false
    api(`/inventory?store=${storeId}`)
      .then((d) => {
        if (!cancelled) setStock({ store: storeId, rows: Object.fromEntries(d.rows.map((r) => [r.product_id, r.available])) })
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [storeId])

  const availableOf = (id) => (stock.store === storeId ? stock.rows[id] ?? 0 : null)
  const categories = useMemo(() => [...new Set(products.map((p) => p.category))], [products])
  const shown = products.filter((p) => {
    if (category && p.category !== category) return false
    const k = q.trim().toLowerCase()
    return !k || `${p.name} ${p.model} ${p.brand} ${p.product_id}`.toLowerCase().includes(k)
  })

  const inCart = (id) => cart.find((c) => c.product_id === id)
  const total = cart.reduce((s, c) => s + c.qty * c.price, 0)
  const shortItems = cart.filter((c) => availableOf(c.product_id) !== null && c.qty > availableOf(c.product_id))

  function add(p) {
    setCart((items) => {
      const found = items.find((c) => c.product_id === p.product_id)
      if (found) return items.map((c) => (c.product_id === p.product_id ? { ...c, qty: Math.min(c.qty + 1, 99) } : c))
      return [...items, { product_id: p.product_id, name: p.name, model: p.model, price: p.sale_price, qty: 1 }]
    })
  }
  const setQty = (id, qty) => setCart((items) => items.map((c) => (c.product_id === id ? { ...c, qty: Math.max(1, Math.min(99, qty || 1)) } : c)))
  const remove = (id) => setCart((items) => items.filter((c) => c.product_id !== id))

  async function submit(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const d = await api('/orders', {
        method: 'POST',
        body: {
          customer,
          store_id: storeId,
          fulfillment,
          delivery_address: fulfillment === 'delivery' ? address : undefined,
          note,
          items: cart.map((c) => ({ product_id: c.product_id, qty: c.qty })),
          reserve_now: reserveNow,
        },
      })
      onCreated(d.order, d.reserve_error)
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  return (
    <form className="order-form" onSubmit={submit}>
      <div className="order-form-top form-grid">
        <label>出貨門市
          <select value={storeId} onChange={(e) => setStoreId(e.target.value)} required>
            {regions.map((r) => (
              <optgroup key={r} label={r}>
                {stores.filter((s) => s.region === r).map((s) => <option key={s.store_id} value={s.store_id}>{s.name}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        <div className="radio-group" role="radiogroup" aria-label="取貨方式">
          <span className="radio-title">取貨方式</span>
          {[['pickup', '門市取貨'], ['delivery', '宅配']].map(([v, label]) => (
            <label key={v} className={`radio-pill ${fulfillment === v ? 'active' : ''}`}>
              <input type="radio" name="fulfillment" value={v} checked={fulfillment === v} onChange={() => setFulfillment(v)} />
              {label}
            </label>
          ))}
        </div>
      </div>

      <div className="order-form-body">
        {/* 商品挑選 */}
        <section className="picker" aria-label="挑選商品">
          <div className="picker-filters">
            <input type="search" placeholder="搜尋品名、品牌、型號" value={q} onChange={(e) => setQ(e.target.value)} aria-label="搜尋商品" />
            <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="分類">
              <option value="">全部分類</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <ul className="picker-list">
            {shown.map((p) => {
              const avail = availableOf(p.product_id)
              const qtyInCart = inCart(p.product_id)?.qty ?? 0
              const out = avail !== null && avail <= 0
              return (
                <li key={p.product_id} className={out ? 'out' : ''}>
                  <div className="picker-info">
                    <strong>{p.name}</strong>
                    <small>{p.product_id} · {p.model}</small>
                  </div>
                  <div className="picker-meta">
                    <span className="picker-price">{formatPrice(p.sale_price)}</span>
                    <span className={`badge ${out ? 'danger' : avail !== null && avail <= 2 ? 'warn' : 'ok'}`}>
                      {avail === null ? '…' : out ? '此店缺貨' : `此店可售 ${avail}`}
                    </span>
                  </div>
                  <button type="button" className="btn small" onClick={() => add(p)} disabled={out || (avail !== null && qtyInCart >= avail)}>
                    {qtyInCart ? `＋1（${qtyInCart}）` : '加入'}
                  </button>
                </li>
              )
            })}
            {!shown.length && <li className="empty">沒有符合的商品</li>}
          </ul>
        </section>

        {/* 購物車 + 顧客 */}
        <section className="cart" aria-label="購物車">
          <h3>購物車 <small>{cart.length} 種商品</small></h3>
          {cart.length ? (
            <ul className="cart-list">
              {cart.map((c) => {
                const avail = availableOf(c.product_id)
                const short = avail !== null && c.qty > avail
                return (
                  <li key={c.product_id} className={short ? 'short' : ''}>
                    <div className="cart-name">
                      <strong>{c.name}</strong>
                      <small>{formatPrice(c.price)} × {c.qty}{short ? `｜此店只剩 ${avail}` : ''}</small>
                    </div>
                    <div className="qty-stepper">
                      <button type="button" onClick={() => setQty(c.product_id, c.qty - 1)} aria-label="減少">−</button>
                      <input type="number" min="1" max="99" value={c.qty} onChange={(e) => setQty(c.product_id, Number(e.target.value))} aria-label={`${c.name} 數量`} />
                      <button type="button" onClick={() => setQty(c.product_id, c.qty + 1)} aria-label="增加">＋</button>
                    </div>
                    <span className="cart-subtotal">{formatPrice(c.qty * c.price)}</span>
                    <button type="button" className="icon-btn" onClick={() => remove(c.product_id)} aria-label={`移除 ${c.name}`}>×</button>
                  </li>
                )
              })}
            </ul>
          ) : <p className="muted cart-empty">從左邊挑選商品加入購物車</p>}
          <div className="cart-total"><span>合計</span><strong>{formatPrice(total)}</strong></div>

          <div className="form-grid">
            <label>顧客姓名<input value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} required maxLength={50} /></label>
            <label>手機<input value={customer.phone} onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} required placeholder="0912345678" inputMode="tel" /></label>
            {fulfillment === 'delivery' && (
              <label className="span-2">收件地址<input value={address} onChange={(e) => setAddress(e.target.value)} required maxLength={200} /></label>
            )}
            <label className="span-2">備註<input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="選填" /></label>
            <label className="checkbox span-2">
              <input type="checkbox" checked={reserveNow} onChange={(e) => setReserveNow(e.target.checked)} /> 建立後立即預留庫存
            </label>
          </div>
          {shortItems.length > 0 && reserveNow && (
            <p className="hint warn-text">有商品超過此店可售數量，預留會失敗，訂單會先停在「待確認」。</p>
          )}
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="modal-actions">
            <button type="submit" className="btn" disabled={saving || !cart.length}>{saving ? '建立中…' : `建立訂單（${formatPrice(total)}）`}</button>
          </div>
        </section>
      </div>
    </form>
  )
}
