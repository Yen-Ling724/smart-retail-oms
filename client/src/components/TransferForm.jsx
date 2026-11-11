import { useEffect, useState } from 'react'
import { api } from '../api.js'

// 建立調貨單。productId 可以先指定（從某商品點進來），否則讓使用者選
export default function TransferForm({ stores, products, productId: fixedProduct = '', defaultTo = '', onDone }) {
  const [productId, setProductId] = useState(fixedProduct)
  const [fromId, setFromId] = useState('')
  const [toId, setToId] = useState(defaultTo)
  const [qty, setQty] = useState('')
  const [note, setNote] = useState('')
  const [stock, setStock] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // 選好商品後，抓各門市可售數量，方便挑調出門市
  useEffect(() => {
    if (!productId) return
    let cancelled = false
    api(`/products/${productId}`)
      .then((d) => { if (!cancelled) setStock(d.product.inventory) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [productId])

  const availableAt = (id) => stock.find((r) => r.store_id === id)?.available ?? 0

  async function submit(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const d = await api('/transfers', {
        method: 'POST',
        body: { product_id: productId, from_store_id: fromId, to_store_id: toId, qty: Number(qty), note },
      })
      onDone?.(d.message)
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit}>
      <div className="form-grid">
        <label className="span-2">商品
          <select value={productId} onChange={(e) => { setProductId(e.target.value); setStock([]) }} required disabled={!!fixedProduct}>
            <option value="">請選擇</option>
            {products.map((p) => <option key={p.product_id} value={p.product_id}>{p.product_id}　{p.name}（{p.model}）</option>)}
          </select>
        </label>
        <label>調出
          <select value={fromId} onChange={(e) => setFromId(e.target.value)}>
            <option value="">總倉補貨</option>
            {stores.filter((s) => s.store_id !== toId).map((s) => (
              <option key={s.store_id} value={s.store_id}>{s.name}{productId ? `（可售 ${availableAt(s.store_id)}）` : ''}</option>
            ))}
          </select>
        </label>
        <label>調入
          <select value={toId} onChange={(e) => setToId(e.target.value)} required>
            <option value="">請選擇</option>
            {stores.filter((s) => s.store_id !== fromId).map((s) => <option key={s.store_id} value={s.store_id}>{s.name}</option>)}
          </select>
        </label>
        <label>數量<input type="number" min="1" max="9999" step="1" value={qty} onChange={(e) => setQty(e.target.value)} required /></label>
        <label>備註<input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="選填，例：客人指定門市取貨" /></label>
      </div>
      <p className="hint">
        {fromId ? '調出門市會立即扣除實體庫存；' : '總倉補貨不扣門市庫存；'}調入門市先記為「在途」，到貨確認後才會變成可售。
      </p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="modal-actions">
        <button type="submit" className="btn" disabled={saving}>{saving ? '建立中…' : '建立調貨單'}</button>
      </div>
    </form>
  )
}
