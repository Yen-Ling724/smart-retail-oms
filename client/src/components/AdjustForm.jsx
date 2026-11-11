import { useState } from 'react'
import { api } from '../api.js'
import { ADJUST_ACTIONS } from '../inventoryLabels.js'

// 調整某商品在某門市的庫存。inventory = 這個商品在各門市的庫存列（用來顯示目前數字）
export default function AdjustForm({ productId, stores, inventory, defaultStore = '', defaultAction = 'receive', onDone, compact = false }) {
  const [storeId, setStoreId] = useState(defaultStore || stores[0]?.store_id || '')
  const [action, setAction] = useState(defaultAction)
  const [qty, setQty] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const meta = ADJUST_ACTIONS.find((a) => a.value === action)
  const current = inventory.find((r) => r.store_id === storeId)

  async function submit(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const d = await api('/inventory/adjust', {
        method: 'POST',
        body: { store_id: storeId, product_id: productId, action, qty: Number(qty), note },
      })
      setQty('')
      setNote('')
      onDone?.(d.message)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className={`adjust-form ${compact ? 'compact' : ''}`} onSubmit={submit}>
      <div className="form-grid">
        <label>門市
          <select value={storeId} onChange={(e) => setStoreId(e.target.value)} required>
            {stores.map((s) => <option key={s.store_id} value={s.store_id}>{s.name}</option>)}
          </select>
        </label>
        <label>動作
          <select value={action} onChange={(e) => setAction(e.target.value)} required>
            {ADJUST_ACTIONS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
          </select>
        </label>
        <label>{meta?.qtyLabel ?? '數量'}
          <input type="number" min={action === 'count' ? 0 : 1} max="9999" step="1" value={qty} onChange={(e) => setQty(e.target.value)} required />
        </label>
        <label>備註<input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="選填，例：廠商到貨" /></label>
      </div>
      <p className="hint">
        {meta?.hint}
        {current && `｜目前：實體 ${current.on_hand ?? 0}、展示 ${current.display ?? 0}、瑕疵 ${current.damaged ?? 0}、可售 ${current.available ?? 0}`}
      </p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="modal-actions">
        <button type="submit" className="btn" disabled={saving || !storeId}>{saving ? '處理中…' : `確認${meta?.label ?? ''}`}</button>
      </div>
    </form>
  )
}
