import { useCallback, useEffect, useRef, useState } from 'react'
import { api, formatDate, formatPrice, stockLevel } from '../api.js'

const STATUS_OPTIONS = [
  { value: 'all', label: '全部狀態' },
  { value: 'active', label: '上架中' },
  { value: 'inactive', label: '已停售' },
]

function StockBadge({ available }) {
  const level = stockLevel(available)
  return (
    <span className="stock-cell">
      {available}
      {level && <span className={`badge ${level.tone}`}>{level.label}</span>}
    </span>
  )
}

function PriceCell({ list, sale }) {
  return (
    <span className="price-cell">
      <strong>{formatPrice(sale)}</strong>
      {list > sale && <s>{formatPrice(list)}</s>}
    </span>
  )
}

function useEscape(onClose) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
}

// ===== 商品詳情側欄 =====
function ProductDetail({ id, onClose, onEdit }) {
  const [product, setProduct] = useState(null)
  const [error, setError] = useState('')
  useEscape(onClose)

  // 換商品時元件會用 key 重新建立，所以這裡只需要載入一次
  useEffect(() => {
    api(`/products/${id}`).then((d) => setProduct(d.product)).catch((e) => setError(e.message))
  }, [id])

  return (
    <div className="overlay" onClick={onClose}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label="商品詳情" onClick={(e) => e.stopPropagation()}>
        <button className="icon-btn drawer-close" onClick={onClose} aria-label="關閉">×</button>
        {error && <p className="form-error" role="alert">{error}</p>}
        {!product && !error && <p className="muted">載入中…</p>}
        {product && (
          <>
            <p className="eyebrow">{product.product_id} · {product.category}</p>
            <h2 className="drawer-title">{product.name}</h2>
            <p className="muted">{product.brand} · 型號 {product.model} · 保固 {product.warranty || '—'}</p>
            <div className="drawer-tags">
              <span className={`badge ${product.is_active ? 'ok' : 'muted'}`}>{product.is_active ? '上架中' : '已停售'}</span>
              {product.replaced_by_product && (
                <span className="badge info">由 {product.replaced_by_product.model} 取代</span>
              )}
            </div>

            <div className="drawer-price">
              <PriceCell list={product.list_price} sale={product.sale_price} />
              <button className="btn" onClick={() => onEdit(product)}>編輯商品</button>
            </div>

            <h3 className="drawer-heading">規格</h3>
            {Object.keys(product.specs ?? {}).length ? (
              <dl className="spec-list">
                {Object.entries(product.specs).map(([k, v]) => (
                  <div key={k}><dt>{k}</dt><dd>{String(v)}</dd></div>
                ))}
              </dl>
            ) : <p className="muted">尚未填寫規格</p>}

            <h3 className="drawer-heading">各門市庫存</h3>
            <div className="table-wrap">
              <table className="data-table compact">
                <thead>
                  <tr><th>門市</th><th>實體</th><th>預留</th><th>展示</th><th>瑕疵</th><th>在途</th><th>可售</th></tr>
                </thead>
                <tbody>
                  {product.inventory.map((row) => (
                    <tr key={row.store_id}>
                      <td>{row.store_name}</td>
                      <td>{row.on_hand ?? 0}</td>
                      <td>{row.reserved ?? 0}</td>
                      <td>{row.display ?? 0}</td>
                      <td>{row.damaged ?? 0}</td>
                      <td>{row.in_transit ?? 0}</td>
                      <td><strong className={(row.available ?? 0) <= 0 ? 'text-danger' : ''}>{row.available ?? 0}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="hint">可售 = 實體 − 預留 − 展示 − 瑕疵（在途尚未到店，不計入）</p>

            <h3 className="drawer-heading">價格歷史</h3>
            <ul className="price-history">
              {product.prices.map((p) => (
                <li key={p.valid_from}>
                  <span>{formatDate(p.valid_from)} – {p.valid_to ? formatDate(p.valid_to) : '現在'}</span>
                  <PriceCell list={p.list_price} sale={p.sale_price} />
                </li>
              ))}
            </ul>
          </>
        )}
      </aside>
    </div>
  )
}

// ===== 新增／編輯表單 =====
const specsToText = (specs) => Object.entries(specs ?? {}).map(([k, v]) => `${k}：${v}`).join('\n')

function textToSpecs(text) {
  const specs = {}
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([^:：]+?)\s*[:：]\s*(.+?)\s*$/)
    if (m) specs[m[1]] = m[2]
  }
  return specs
}

function ProductForm({ product, categories, onClose, onSaved }) {
  const isNew = !product
  const [form, setForm] = useState(() => ({
    name: product?.name ?? '',
    brand: product?.brand ?? '',
    model: product?.model ?? '',
    category: product?.category ?? '',
    warranty: product?.warranty ?? '',
    list_price: product?.list_price ?? '',
    sale_price: product?.sale_price ?? '',
    is_active: product?.is_active ?? true,
    specs: specsToText(product?.specs),
  }))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const firstField = useRef(null)
  useEscape(onClose)
  useEffect(() => { firstField.current?.focus() }, [])

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  async function submit(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const body = {
        ...form,
        list_price: Number(form.list_price),
        sale_price: Number(form.sale_price),
        specs: textToSpecs(form.specs),
      }
      const { product: saved } = isNew
        ? await api('/products', { method: 'POST', body })
        : await api(`/products/${product.product_id}`, { method: 'PUT', body })
      onSaved(saved, isNew)
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  return (
    <div className="overlay center" onClick={onClose}>
      <form className="modal" role="dialog" aria-modal="true" aria-label={isNew ? '新增商品' : '編輯商品'} onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="modal-head">
          <h2>{isNew ? '新增商品' : `編輯商品 ${product.product_id}`}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="關閉">×</button>
        </div>

        <div className="form-grid">
          <label className="span-2">品名<input ref={firstField} value={form.name} onChange={set('name')} required placeholder="例：晴川 480L 變頻雙門冰箱" /></label>
          <label>品牌<input value={form.brand} onChange={set('brand')} required /></label>
          <label>型號<input value={form.model} onChange={set('model')} required placeholder="例：QC-R480" /></label>
          <label>分類
            <input value={form.category} onChange={set('category')} required list="category-options" />
            <datalist id="category-options">{categories.map((c) => <option key={c.category} value={c.category} />)}</datalist>
          </label>
          <label>保固<input value={form.warranty} onChange={set('warranty')} placeholder="例：3 年" /></label>
          <label>原價（元）<input type="number" min="0" step="1" value={form.list_price} onChange={set('list_price')} required /></label>
          <label>售價（元）<input type="number" min="0" step="1" value={form.sale_price} onChange={set('sale_price')} required /></label>
          <label className="span-2">規格<span className="hint">一行一項，格式「項目：內容」</span>
            <textarea rows="4" value={form.specs} onChange={set('specs')} placeholder={'容量：480L\n能效：1 級'} />
          </label>
          <label className="checkbox span-2"><input type="checkbox" checked={form.is_active} onChange={set('is_active')} /> 上架中</label>
        </div>
        {!isNew && <p className="hint">修改價格會自動留下一筆價格歷史。</p>}
        {error && <p className="form-error" role="alert">{error}</p>}

        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>取消</button>
          <button type="submit" className="btn" disabled={saving}>{saving ? '儲存中…' : '儲存'}</button>
        </div>
      </form>
    </div>
  )
}

// ===== 商品管理頁 =====
export default function Products() {
  const [q, setQ] = useState('')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [status, setStatus] = useState('all')
  const [result, setResult] = useState({ key: null, products: [], error: '' })
  const [reloadTick, setReloadTick] = useState(0)
  const [categories, setCategories] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [editing, setEditing] = useState(undefined) // undefined=關閉, null=新增, 物件=編輯
  const [toast, setToast] = useState('')

  // 輸入停 0.25 秒才搜尋，避免每打一個字就查一次
  useEffect(() => {
    const t = setTimeout(() => setQuery(q), 250)
    return () => clearTimeout(t)
  }, [q])

  const key = new URLSearchParams({ q: query, category, status }).toString()
  const loading = result.key !== key
  const { products, error } = result

  useEffect(() => {
    let cancelled = false
    api(`/products?${key}`)
      .then((d) => { if (!cancelled) setResult({ key, products: d.products, error: '' }) })
      .catch((e) => { if (!cancelled) setResult((r) => ({ ...r, key, error: e.message })) })
    return () => { cancelled = true }
  }, [key, reloadTick])

  const loadCategories = useCallback(() => {
    api('/categories').then((d) => setCategories(d.categories)).catch(() => {})
  }, [])
  useEffect(loadCategories, [loadCategories])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(''), 2500)
    return () => clearTimeout(t)
  }, [toast])

  const closeDetail = useCallback(() => setSelectedId(null), [])
  const closeForm = useCallback(() => setEditing(undefined), [])

  function handleSaved(saved, isNew) {
    setEditing(undefined)
    setSelectedId(saved.product_id)
    setToast(isNew ? `已新增 ${saved.product_id}` : '已儲存變更')
    setReloadTick((t) => t + 1)
    loadCategories()
  }

  return (
    <section className="page" aria-labelledby="products-heading">
      <div className="page-head">
        <div>
          <p className="eyebrow">MODULE 01</p>
          <h1 id="products-heading">商品管理</h1>
          <p className="muted">管理商品主檔、價格與規格。點一列可查看各門市庫存。</p>
        </div>
        <button className="btn" onClick={() => setEditing(null)}>＋ 新增商品</button>
      </div>

      <div className="toolbar">
        <input
          type="search"
          className="search"
          placeholder="搜尋品名、品牌、型號或編號"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="搜尋商品"
        />
        <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="分類">
          <option value="">全部分類</option>
          {categories.map((c) => <option key={c.category} value={c.category}>{c.category}（{c.count}）</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="狀態">
          {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <span className="result-count">{loading ? '載入中…' : `${products.length} 項`}</span>
      </div>

      {error && <p className="form-error" role="alert">商品載入失敗：{error}</p>}

      <div className="table-wrap card">
        <table className="data-table">
          <thead>
            <tr>
              <th>編號</th><th>商品</th><th>品牌</th><th>分類</th>
              <th className="num">售價</th><th className="num">可售</th><th>狀態</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr
                key={p.product_id}
                className={`clickable ${p.is_active ? '' : 'inactive'}`}
                onClick={() => setSelectedId(p.product_id)}
                onKeyDown={(e) => { if (e.key === 'Enter') setSelectedId(p.product_id) }}
                tabIndex={0}
              >
                <td className="mono">{p.product_id}</td>
                <td><strong>{p.name}</strong><small>{p.model}</small></td>
                <td>{p.brand}</td>
                <td>{p.category}</td>
                <td className="num"><PriceCell list={p.list_price} sale={p.sale_price} /></td>
                <td className="num"><StockBadge available={p.available} /></td>
                <td><span className={`badge ${p.is_active ? 'ok' : 'muted'}`}>{p.is_active ? '上架中' : '已停售'}</span></td>
              </tr>
            ))}
            {!loading && !products.length && !error && (
              <tr><td colSpan="7" className="empty">沒有符合條件的商品</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {selectedId && editing === undefined && (
        <ProductDetail key={selectedId} id={selectedId} onClose={closeDetail} onEdit={(p) => setEditing(p)} />
      )}
      {editing !== undefined && (
        <ProductForm product={editing} categories={categories} onClose={closeForm} onSaved={handleSaved} />
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </section>
  )
}
