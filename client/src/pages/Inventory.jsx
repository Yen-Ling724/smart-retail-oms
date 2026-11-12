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
// 一格（某商品在某區域）的彙總：可售加總、在途加總、缺貨／偏低的門市數
function summarize(storeRows) {
  const sum = { available: 0, transit: 0, out: 0, low: 0, stores: storeRows.length }
  for (const r of storeRows) {
    const n = r?.available ?? 0
    sum.available += n
    sum.transit += r?.in_transit ?? 0
    if (n <= 0) sum.out += 1
    else if (n <= STORE_LOW) sum.low += 1
  }
  return sum
}

const regionTone = (s) => (s.available <= 0 ? 'danger' : s.out || s.low ? 'warn' : '')

function StockTab({ stores, regions, categories, onAdjust, onTransfer, refreshKey }) {
  const [view, setView] = useState('store') // store=依門市, region=依區域
  const [region, setRegion] = useState('')
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

  // 依區域篩選後要顯示的欄
  const visibleStores = region ? stores.filter((s) => s.region === region) : stores
  const visibleRegions = region ? [region] : regions
  const storesByRegion = useMemo(() => {
    const map = {}
    for (const s of stores) (map[s.region] ??= []).push(s)
    return map
  }, [stores])

  // 每個商品一列，存它在各門市的庫存
  const matrix = useMemo(() => {
    const byProduct = new Map()
    for (const r of rows) {
      if (!byProduct.has(r.product_id)) byProduct.set(r.product_id, { ...r, stores: {} })
      byProduct.get(r.product_id).stores[r.store_id] = r
    }
    return [...byProduct.values()]
  }, [rows])

  const visibleIds = new Set(visibleStores.map((s) => s.store_id))
  const lowMatrix = onlyLow
    ? matrix.filter((p) => visibleStores.some((s) => (p.stores[s.store_id]?.available ?? 0) <= STORE_LOW))
    : matrix
  // 切換門市時舊資料可能還是「全部門市」，先過濾掉別家店，避免同一商品出現多次
  const storeRows = store ? rows.filter((r) => r.store_id === store) : rows
  const lowRows = onlyLow ? storeRows.filter((r) => r.available <= STORE_LOW) : storeRows
  const count = store ? lowRows.length : lowMatrix.length

  // 從區域檢視點進某區 → 切到依門市，只看那個區域的門市
  function drillInto(r) {
    setRegion(r)
    setView('store')
  }

  function changeView(next) {
    setView(next)
    setStore('')
  }

  const total = (p) => visibleStores.reduce((a, s) => a + (p.stores[s.store_id]?.available ?? 0), 0)
  const transit = (p) => visibleStores.reduce((a, s) => a + (p.stores[s.store_id]?.in_transit ?? 0), 0)

  return (
    <>
      <div className="toolbar">
        <div className="segmented" role="group" aria-label="檢視方式">
          <button type="button" className={view === 'store' ? 'active' : ''} aria-pressed={view === 'store'} onClick={() => changeView('store')}>依門市</button>
          <button type="button" className={view === 'region' ? 'active' : ''} aria-pressed={view === 'region'} onClick={() => changeView('region')}>依區域</button>
        </div>
        <input type="search" className="search" placeholder="搜尋品名、品牌、型號或編號" value={q} onChange={(e) => setQ(e.target.value)} aria-label="搜尋商品" />
        <select value={region} onChange={(e) => { setRegion(e.target.value); setStore('') }} aria-label="區域">
          <option value="">全部區域</option>
          {regions.map((r) => <option key={r} value={r}>{r}（{storesByRegion[r]?.length ?? 0} 店）</option>)}
        </select>
        {view === 'store' && (
          <select value={store} onChange={(e) => setStore(e.target.value)} aria-label="門市">
            <option value="">{region ? `${region}全部門市` : '全部門市'}</option>
            {(region ? [region] : regions).map((r) => (
              <optgroup key={r} label={r}>
                {(storesByRegion[r] ?? []).map((s) => <option key={s.store_id} value={s.store_id}>{s.name}</option>)}
              </optgroup>
            ))}
          </select>
        )}
        <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="分類">
          <option value="">全部分類</option>
          {categories.map((c) => <option key={c.category} value={c.category}>{c.category}</option>)}
        </select>
        <label className="toggle"><input type="checkbox" checked={onlyLow} onChange={(e) => setOnlyLow(e.target.checked)} /> 只看缺貨／偏低</label>
        <span className="result-count">{loading ? '載入中…' : `${count} 項`}</span>
      </div>
      {error && <p className="form-error" role="alert">庫存載入失敗：{error}</p>}

      {!store && view === 'store' && (
        <div className="legend" aria-label="顏色說明">
          <span className="legend-title">可售數量：</span>
          <span><i className="swatch" />正常（3 以上）</span>
          <span><i className="swatch warn" />偏低（1～{STORE_LOW}）</span>
          <span><i className="swatch danger" />缺貨（0）</span>
          <span><b className="transit-sample">在途 N</b>＝已出發、還沒到店</span>
          <span className="legend-tip">點數字可以調整庫存</span>
        </div>
      )}
      {view === 'region' && (
        <div className="legend" aria-label="顏色說明">
          <span className="legend-title">區域可售加總：</span>
          <span><i className="swatch" />區內各店都正常</span>
          <span><i className="swatch warn" />有門市缺貨或偏低</span>
          <span><i className="swatch danger" />整區都沒貨</span>
          <span className="legend-tip">點數字可以展開看該區門市</span>
        </div>
      )}

      {view === 'region' ? (
        <div className="table-wrap card">
          <table className="data-table stock-matrix">
            <thead>
              <tr>
                <th>編號</th>
                <th>商品</th>
                {visibleRegions.map((r) => (
                  <th key={r} className="num">{r}<small className="th-sub">{storesByRegion[r]?.length ?? 0} 店</small></th>
                ))}
                <th className="num">合計可售</th>
                <th className="num">在途</th>
              </tr>
            </thead>
            <tbody>
              {lowMatrix.map((p) => (
                <tr key={p.product_id}>
                  <td className="mono">{p.product_id}</td>
                  <td><strong>{p.name}</strong><small>{p.model}</small></td>
                  {visibleRegions.map((r) => {
                    const sum = summarize((storesByRegion[r] ?? []).map((s) => p.stores[s.store_id]))
                    const problems = [sum.out && `缺貨 ${sum.out}`, sum.low && `偏低 ${sum.low}`].filter(Boolean)
                    const note = problems.length ? `${problems.join('・')} 店` : sum.transit ? `在途 ${sum.transit}` : ''
                    return (
                      <td key={r} className="num">
                        <button
                          type="button"
                          className={`cell-btn region-cell ${regionTone(sum)}`}
                          onClick={() => drillInto(r)}
                          title={`${r} ${sum.stores} 家門市：可售 ${sum.available}、缺貨 ${sum.out} 店、偏低 ${sum.low} 店、在途 ${sum.transit}（點一下看各門市）`}
                        >
                          {sum.available}{note && <small className={sum.out || sum.low ? 'region-note' : 'transit'}>{note}</small>}
                        </button>
                      </td>
                    )
                  })}
                  <td className="num"><strong>{total(p)}</strong></td>
                  <td className="num muted-num">{transit(p) || '—'}</td>
                </tr>
              ))}
              {!loading && !lowMatrix.length && <tr><td colSpan={visibleRegions.length + 4} className="empty">沒有符合條件的商品</td></tr>}
            </tbody>
          </table>
        </div>
      ) : !store ? (
        <div className="table-wrap card">
          {region && (
            <p className="drill-bar">
              目前只看 <b>{region}</b> 的 {visibleStores.length} 家門市
              <button type="button" className="btn ghost small" onClick={() => setRegion('')}>看全部區域</button>
              <button type="button" className="btn ghost small" onClick={() => changeView('region')}>回到依區域</button>
            </p>
          )}
          <table className="data-table stock-matrix">
            <thead>
              <tr>
                <th>編號</th>
                <th>商品</th>
                {visibleStores.map((s) => <th key={s.store_id} className="num">{s.name.replace('店', '')}<small className="th-sub">{s.region}</small></th>)}
                <th className="num">合計可售</th>
                <th className="num">在途</th>
              </tr>
            </thead>
            <tbody>
              {lowMatrix.map((p) => (
                <tr key={p.product_id}>
                  <td className="mono">{p.product_id}</td>
                  <td><strong>{p.name}</strong><small>{p.model}</small></td>
                  {visibleStores.map((s) => {
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
                          {n}{r?.in_transit > 0 && <small className="transit">在途 {r.in_transit}</small>}
                        </button>
                      </td>
                    )
                  })}
                  <td className="num"><strong>{total(p)}</strong></td>
                  <td className="num muted-num">{transit(p) || '—'}</td>
                </tr>
              ))}
              {!loading && !lowMatrix.length && <tr><td colSpan={visibleStores.length + 4} className="empty">沒有符合條件的商品</td></tr>}
            </tbody>
          </table>
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
              {lowRows.filter((r) => visibleIds.has(r.store_id)).map((r) => (
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
// 調貨單、異動紀錄共用：關鍵字（停 0.25 秒才查）＋分類
function useSearchFilters() {
  const [q, setQ] = useState('')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 250)
    return () => clearTimeout(t)
  }, [q])
  return { q, setQ, query, category, setCategory, active: Boolean(query || category) }
}

function SearchFields({ f, categories, placeholder }) {
  return (
    <>
      <input type="search" className="search" placeholder={placeholder} value={f.q} onChange={(e) => f.setQ(e.target.value)} aria-label="關鍵字搜尋" />
      <select value={f.category} onChange={(e) => f.setCategory(e.target.value)} aria-label="分類">
        <option value="">全部分類</option>
        {categories.map((c) => <option key={c.category} value={c.category}>{c.category}</option>)}
      </select>
    </>
  )
}

function TransfersTab({ stores, categories, onNew, refreshKey, onChanged }) {
  const f = useSearchFilters()
  const [status, setStatus] = useState('in_transit')
  const [store, setStore] = useState('')
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState('')
  const params = new URLSearchParams({ status, store, q: f.query, category: f.category }).toString()
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
        <SearchFields f={f} categories={categories} placeholder="搜尋品名、品牌、型號、單號或備註" />
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
            {!loading && !transfers.length && <tr><td colSpan="8" className="empty">{f.active ? '沒有符合搜尋條件的調貨單' : '沒有調貨單'}</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}

// ===== 異動紀錄 =====
function MovementsTab({ stores, categories, refreshKey }) {
  const [store, setStore] = useState('')
  const [type, setType] = useState('')
  const f = useSearchFilters()
  const { data, loading, error } = useLoad(`/inventory/movements?${new URLSearchParams({ store, type, q: f.query, category: f.category, limit: 100 })}`, [refreshKey])
  const movements = data?.movements ?? []
  return (
    <>
      <div className="toolbar">
        <SearchFields f={f} categories={categories} placeholder="搜尋品名、品牌、型號、編號或備註" />
        <select value={store} onChange={(e) => setStore(e.target.value)} aria-label="門市">
          <option value="">全部門市</option>
          {stores.map((s) => <option key={s.store_id} value={s.store_id}>{s.name}</option>)}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label="動作">
          <option value="">全部動作</option>
          {Object.entries(MOVEMENT_LABELS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        <span className="result-count">{loading ? '載入中…' : `${f.active || type || store ? '符合' : '最近'} ${movements.length} 筆`}</span>
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
            {!loading && !movements.length && <tr><td colSpan="9" className="empty">{f.active || type || store ? '沒有符合條件的異動紀錄' : '還沒有庫存異動。到「庫存總表」點數字就能調整庫存。'}</td></tr>}
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
  const [regions, setRegions] = useState([])
  const [categories, setCategories] = useState([])
  const [products, setProducts] = useState([])
  const [refreshKey, setRefreshKey] = useState(0)
  const [adjusting, setAdjusting] = useState(null) // { productId, storeId, inventory, name }
  const [transfer, setTransfer] = useState(null) // { productId?, toStore? }
  const [toast, setToast] = useToast()

  useEffect(() => {
    api('/stores').then((d) => { setStores(d.stores); setRegions(d.regions ?? []) }).catch(() => {})
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
          regions={regions}
          categories={categories}
          refreshKey={refreshKey}
          onAdjust={openAdjust}
          onTransfer={(productId, storeId) => setTransfer({ productId, toStore: storeId })}
        />
      )}
      {tab === 'transfers' && <TransfersTab stores={stores} categories={categories} refreshKey={refreshKey} onNew={() => setTransfer({})} onChanged={changed} />}
      {tab === 'movements' && <MovementsTab stores={stores} categories={categories} refreshKey={refreshKey} />}

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
