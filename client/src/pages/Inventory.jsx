import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../api.js'
import AdjustForm from '../components/AdjustForm.jsx'
import TransferForm from '../components/TransferForm.jsx'
import { Modal, Toast } from '../components/common.jsx'
import { useToast } from '../hooks.js'
import { MOVEMENT_LABELS, TRANSFER_STATUS, formatDateTime } from '../inventoryLabels.js'

const STORE_LOW = 2 // 單一門市可售 ≤ 2 視為偏低

const cellTone = (n) => (n <= 0 ? 'danger' : n <= STORE_LOW ? 'warn' : '')

const TABS = [
  { key: 'stock', label: '庫存總表' },
  { key: 'transfers', label: '調貨單' },
  { key: 'movements', label: '異動紀錄' },
]

// 抓資料的小工具：key 改變就重抓，reload() 可以手動重抓
function useLoad(path, deps = []) {
  const [state, setState] = useState({ key: null, data: null, error: '' })
  const [tick, setTick] = useState(0)
  const key = `${path}#${tick}`
  useEffect(() => {
    let cancelled = false
    api(path)
      .then((d) => { if (!cancelled) setState({ key, data: d, error: '' }) })
      .catch((e) => { if (!cancelled) setState((s) => ({ ...s, key, error: e.message })) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ...deps])
  return { ...state, loading: state.key !== key, reload: useCallback(() => setTick((t) => t + 1), []) }
}

// ===== 庫存總表 =====
function StockTab({ stores, categories, onAdjust, onTransfer, refreshKey }) {
  const [store, setStore] = useState('')
  const [category, setCategory] = useState('')
  const [q, setQ] = useState('')
  const [query, setQuery] = useState('')
  const [onlyLow, setOnlyLow] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setQuery(q), 250)
    return () => clearTimeout(t)
  }, [q])

  const params = new URLSearchParams({ q: query, category, store }).toString()
  const { data, error, loading } = useLoad(`/inventory?${params}`, [refreshKey])
  const rows = useMemo(() => data?.rows ?? [], [data])

  // 全部門市：每個商品一列，各門市一欄
  const matrix = useMemo(() => {
    const byProduct = new Map()
    for (const r of rows) {
      if (!byProduct.has(r.product_id)) byProduct.set(r.product_id, { ...r, stores: {}, total: 0, transit: 0 })
      const p = byProduct.get(r.product_id)
      p.stores[r.store_id] = r
      p.total += r.available
      p.transit += r.in_transit
    }
    return [...byProduct.values()]
  }, [rows])

  const lowMatrix = onlyLow ? matrix.filter((p) => Object.values(p.stores).some((s) => s.available <= STORE_LOW)) : matrix
  // 切換門市時舊資料可能還是「全部門市」，先過濾掉別家店，避免同一商品出現多次
  const storeRows = store ? rows.filter((r) => r.store_id === store) : rows
  const lowRows = onlyLow ? storeRows.filter((r) => r.available <= STORE_LOW) : storeRows
  const count = store ? lowRows.length : lowMatrix.length

  return (
    <>
      <div className="toolbar">
        <input type="search" className="search" placeholder="搜尋品名、品牌、型號或編號" value={q} onChange={(e) => setQ(e.target.value)} aria-label="搜尋商品" />
        <select value={store} onChange={(e) => setStore(e.target.value)} aria-label="門市">
          <option value="">全部門市</option>
          {stores.map((s) => <option key={s.store_id} value={s.store_id}>{s.name}</option>)}
        </select>
        <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="分類">
          <option value="">全部分類</option>
          {categories.map((c) => <option key={c.category} value={c.category}>{c.category}</option>)}
        </select>
        <label className="toggle"><input type="checkbox" checked={onlyLow} onChange={(e) => setOnlyLow(e.target.checked)} /> 只看缺貨／偏低</label>
        <span className="result-count">{loading ? '載入中…' : `${count} 項`}</span>
      </div>
      {error && <p className="form-error" role="alert">庫存載入失敗：{error}</p>}

      {!store ? (
        <div className="table-wrap card">
          <table className="data-table stock-matrix">
            <thead>
              <tr>
                <th>編號</th>
                <th>商品</th>
                {stores.map((s) => <th key={s.store_id} className="num">{s.name.replace('店', '')}</th>)}
                <th className="num">合計可售</th>
                <th className="num">在途</th>
              </tr>
            </thead>
            <tbody>
              {lowMatrix.map((p) => (
                <tr key={p.product_id}>
                  <td className="mono">{p.product_id}</td>
                  <td><strong>{p.name}</strong><small>{p.model}</small></td>
                  {stores.map((s) => {
                    const r = p.stores[s.store_id]
                    const n = r?.available ?? 0
                    return (
                      <td key={s.store_id} className="num">
                        <button
                          type="button"
                          className={`cell-btn ${cellTone(n)}`}
                          onClick={() => onAdjust(p.product_id, s.store_id)}
                          title={`${s.name}：實體 ${r?.on_hand ?? 0}、展示 ${r?.display ?? 0}、瑕疵 ${r?.damaged ?? 0}、在途 ${r?.in_transit ?? 0}（點一下調整）`}
                        >
                          {n}{r?.in_transit > 0 && <small className="transit">+{r.in_transit}</small>}
                        </button>
                      </td>
                    )
                  })}
                  <td className="num"><strong>{p.total}</strong></td>
                  <td className="num muted-num">{p.transit || '—'}</td>
                </tr>
              ))}
              {!loading && !lowMatrix.length && <tr><td colSpan={stores.length + 4} className="empty">沒有符合條件的商品</td></tr>}
            </tbody>
          </table>
          <p className="hint table-hint">數字是各門市可售數量；紅色＝缺貨、橘色＝偏低（≤ {STORE_LOW}）、小字 +N＝在途。點數字可以調整庫存。</p>
        </div>
      ) : (
        <div className="table-wrap card">
          <table className="data-table">
            <thead>
              <tr>
                <th>編號</th>
                <th>商品</th>
                <th className="num">實體</th><th className="num">預留</th><th className="num">展示</th>
                <th className="num">瑕疵</th><th className="num">在途</th><th className="num">可售</th><th />
              </tr>
            </thead>
            <tbody>
              {lowRows.map((r) => (
                <tr key={`${r.product_id}-${r.store_id}`}>
                  <td className="mono">{r.product_id}</td>
                  <td><strong>{r.name}</strong><small>{r.model}</small></td>
                  <td className="num">{r.on_hand}</td>
                  <td className="num">{r.reserved}</td>
                  <td className="num">{r.display}</td>
                  <td className="num">{r.damaged}</td>
                  <td className="num">{r.in_transit}</td>
                  <td className="num"><strong className={cellTone(r.available) ? `text-${cellTone(r.available)}` : ''}>{r.available}</strong></td>
                  <td className="row-actions">
                    <button type="button" className="btn ghost small" onClick={() => onAdjust(r.product_id, r.store_id)}>調整</button>
                    <button type="button" className="btn ghost small" title="從總倉或其他門市調貨到這家店" onClick={() => onTransfer(r.product_id, r.store_id)}>調入</button>
                  </td>
                </tr>
              ))}
              {!loading && !lowRows.length && <tr><td colSpan="9" className="empty">沒有符合條件的商品</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

// ===== 調貨單 =====
function TransfersTab({ stores, onNew, refreshKey, onChanged }) {
  const [status, setStatus] = useState('in_transit')
  const [store, setStore] = useState('')
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState('')
  const params = new URLSearchParams({ status, store }).toString()
  const { data, loading, reload } = useLoad(`/transfers?${params}`, [refreshKey])
  const transfers = data?.transfers ?? []

  async function act(t, kind) {
    if (kind === 'cancel' && !window.confirm(`確定取消調貨單 #${t.id}？${t.from_store_id ? '數量會退回調出門市。' : ''}`)) return
    setBusy(t.id)
    setError('')
    try {
      const d = await api(`/transfers/${t.id}/${kind}`, { method: 'POST' })
      onChanged(d.message)
      reload()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <div className="toolbar">
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="狀態">
          <option value="in_transit">在途中</option>
          <option value="received">已到貨</option>
          <option value="cancelled">已取消</option>
          <option value="">全部</option>
        </select>
        <select value={store} onChange={(e) => setStore(e.target.value)} aria-label="門市">
          <option value="">全部門市</option>
          {stores.map((s) => <option key={s.store_id} value={s.store_id}>{s.name}</option>)}
        </select>
        <span className="result-count">{loading ? '載入中…' : `${transfers.length} 張`}</span>
        <button type="button" className="btn" onClick={onNew}>＋ 新增調貨</button>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="table-wrap card">
        <table className="data-table">
          <thead>
            <tr><th>單號</th><th>編號</th><th>商品</th><th>調出 → 調入</th><th className="num">數量</th><th>狀態</th><th>建立時間</th><th /></tr>
          </thead>
          <tbody>
            {transfers.map((t) => {
              const st = TRANSFER_STATUS[t.status]
              return (
                <tr key={t.id}>
                  <td className="mono">#{t.id}</td>
                  <td className="mono">{t.product_id}</td>
                  <td><strong>{t.product_name}</strong><small>{t.model}{t.note ? ` · ${t.note}` : ''}</small></td>
                  <td>{t.from_store_name ?? '總倉'} → {t.to_store_name}</td>
                  <td className="num">{t.qty}</td>
                  <td><span className={`badge ${st.tone}`}>{st.label}</span></td>
                  <td className="muted-num">{formatDateTime(t.created_at)}</td>
                  <td className="row-actions">
                    {t.status === 'in_transit' && (
                      <>
                        <button type="button" className="btn small" disabled={busy === t.id} onClick={() => act(t, 'receive')}>到貨</button>
                        <button type="button" className="btn ghost small" disabled={busy === t.id} onClick={() => act(t, 'cancel')}>取消</button>
                      </>
                    )}
                  </td>
                </tr>
              )
            })}
            {!loading && !transfers.length && <tr><td colSpan="8" className="empty">沒有調貨單</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}

// ===== 異動紀錄 =====
function MovementsTab({ stores, refreshKey }) {
  const [store, setStore] = useState('')
  const { data, loading, error } = useLoad(`/inventory/movements?${new URLSearchParams({ store, limit: 100 })}`, [refreshKey])
  const movements = data?.movements ?? []
  return (
    <>
      <div className="toolbar">
        <select value={store} onChange={(e) => setStore(e.target.value)} aria-label="門市">
          <option value="">全部門市</option>
          {stores.map((s) => <option key={s.store_id} value={s.store_id}>{s.name}</option>)}
        </select>
        <span className="result-count">{loading ? '載入中…' : `最近 ${movements.length} 筆`}</span>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="table-wrap card">
        <table className="data-table">
          <thead>
            <tr><th>時間</th><th>門市</th><th>編號</th><th>商品</th><th>動作</th><th className="num">數量</th><th className="num">實體變化</th><th className="num">異動後可售</th><th>備註</th></tr>
          </thead>
          <tbody>
            {movements.map((m) => (
              <tr key={m.id}>
                <td className="muted-num">{formatDateTime(m.created_at)}</td>
                <td>{m.store_name}</td>
                <td className="mono">{m.product_id}</td>
                <td><strong>{m.product_name}</strong><small>{m.model}</small></td>
                <td>{MOVEMENT_LABELS[m.type] ?? m.type}</td>
                <td className="num">{m.qty}</td>
                <td className={`num ${m.qty_change > 0 ? 'text-ok' : m.qty_change < 0 ? 'text-danger' : ''}`}>{m.qty_change > 0 ? `+${m.qty_change}` : m.qty_change || '—'}</td>
                <td className="num">{m.available_after}</td>
                <td className="muted-num">{m.note}</td>
              </tr>
            ))}
            {!loading && !movements.length && <tr><td colSpan="9" className="empty">還沒有庫存異動。到「庫存總表」點數字就能調整庫存。</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}

// ===== 門市庫存頁 =====
export default function Inventory() {
  const [tab, setTab] = useState('stock')
  const [stores, setStores] = useState([])
  const [categories, setCategories] = useState([])
  const [products, setProducts] = useState([])
  const [refreshKey, setRefreshKey] = useState(0)
  const [adjusting, setAdjusting] = useState(null) // { productId, storeId, inventory, name }
  const [transfer, setTransfer] = useState(null) // { productId?, toStore? }
  const [toast, setToast] = useToast()

  useEffect(() => {
    api('/stores').then((d) => setStores(d.stores)).catch(() => {})
    api('/categories').then((d) => setCategories(d.categories)).catch(() => {})
    api('/products?status=active').then((d) => setProducts(d.products)).catch(() => {})
  }, [])

  const changed = (message) => {
    setToast(message)
    setRefreshKey((k) => k + 1)
  }

  async function openAdjust(productId, storeId) {
    const d = await api(`/products/${productId}`)
    setAdjusting({ productId, storeId, inventory: d.product.inventory, name: d.product.name })
  }

  return (
    <section className="page" aria-labelledby="inventory-heading">
      <div className="page-head">
        <div>
          <p className="eyebrow">MODULE 02</p>
          <h1 id="inventory-heading">門市庫存</h1>
          <p className="muted">查看 5 家門市的可售數量，進貨、展示機、瑕疵、盤點與門市調貨都在這裡處理。</p>
        </div>
        <button className="btn" onClick={() => setTransfer({})}>＋ 新增調貨</button>
      </div>

      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={`tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'stock' && (
        <StockTab
          stores={stores}
          categories={categories}
          refreshKey={refreshKey}
          onAdjust={openAdjust}
          onTransfer={(productId, storeId) => setTransfer({ productId, toStore: storeId })}
        />
      )}
      {tab === 'transfers' && <TransfersTab stores={stores} refreshKey={refreshKey} onNew={() => setTransfer({})} onChanged={changed} />}
      {tab === 'movements' && <MovementsTab stores={stores} refreshKey={refreshKey} />}

      {adjusting && (
        <Modal title={`調整庫存：${adjusting.name}`} onClose={() => setAdjusting(null)}>
          <AdjustForm
            productId={adjusting.productId}
            stores={stores}
            inventory={adjusting.inventory}
            defaultStore={adjusting.storeId}
            onDone={(msg) => { setAdjusting(null); changed(msg) }}
          />
        </Modal>
      )}
      {transfer && (
        <Modal title="新增調貨" onClose={() => setTransfer(null)}>
          <TransferForm
            stores={stores}
            products={products}
            productId={transfer.productId}
            defaultTo={transfer.toStore}
            onDone={(msg) => { setTransfer(null); setTab('transfers'); changed(msg) }}
          />
        </Modal>
      )}
      <Toast message={toast} />
    </section>
  )
}
