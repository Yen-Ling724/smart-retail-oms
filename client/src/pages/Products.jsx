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
      {level && <span className={`badge ${level.tone}`}>{level.label}</span>}
      <span className="stock-num">{available}</span>
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

// 依範本順序把規格整理成 [欄位名, 顯示文字]，數字欄位加上單位
function formatSpecs(specs = {}, template = []) {
  const known = template
    .filter((f) => specs[f.key] !== undefined && specs[f.key] !== '')
    .map((f) => [f.key, f.unit ? `${specs[f.key]} ${f.unit}` : String(specs[f.key])])
  const extra = Object.entries(specs)
    .filter(([k]) => !template.some((f) => f.key === k))
    .map(([k, v]) => [k, String(v)])
  return [...known, ...extra]
}

function useEscape(onClose) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
}

// ===== 商品詳情側欄 =====
function ProductDetail({ id, templates, onClose, onEdit }) {
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
                {formatSpecs(product.specs, templates[product.category]).map(([k, v]) => (
                  <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
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
// 依分類範本畫出規格欄位
function SpecFields({ template, specs, onChange }) {
  if (!template) return <p className="hint span-2">先選擇分類，就會出現該分類的規格欄位。</p>
  return template.map((field) => {
    const id = `spec-${field.key}`
    const value = specs[field.key] ?? ''
    const set = (e) => onChange(field.key, e.target.value)
    let input
    if (field.type === 'select') {
      input = (
        <select id={id} value={value} onChange={set} required={field.required}>
          <option value="">{field.required ? '請選擇' : '（不填）'}</option>
          {field.options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      )
    } else if (field.type === 'number') {
      input = (
        <span className="unit-input">
          <input id={id} type="number" step="any" min={field.min} max={field.max} value={value} onChange={set} required={field.required} />
          <span>{field.unit}</span>
        </span>
      )
    } else {
      input = <input id={id} value={value} onChange={set} required={field.required} placeholder={field.placeholder} maxLength={100} />
    }
    return (
      <label key={field.key} htmlFor={id} className={field.type === 'text' && !field.required ? 'span-2' : ''}>
        <span>{field.key}{field.required && <em className="req" aria-label="必填">*</em>}</span>
        {input}
      </label>
    )
  })
}

function ProductForm({ product, templates, brands, configError, onRetryConfig, onClose, onSaved }) {
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
  }))
  const [specs, setSpecs] = useState(() => ({ ...(product?.specs ?? {}) }))
  const template = templates[form.category]
  const setSpec = (key, value) => setSpecs((s) => ({ ...s, [key]: value }))

  const brandOptions = brands[form.category] ?? []

  // 換分類時只保留新分類也有的規格欄位；品牌不在新分類清單裡就清空
  function changeCategory(e) {
    const next = e.target.value
    const keys = new Set((templates[next] ?? []).map((f) => f.key))
    setSpecs((s) => Object.fromEntries(Object.entries(s).filter(([k]) => keys.has(k))))
    setForm((f) => ({ ...f, category: next, brand: (brands[next] ?? []).includes(f.brand) ? f.brand : '' }))
  }
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
        specs,
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

        {(configError || !Object.keys(templates).length) && (
          <div className="form-error config-error" role="alert">
            <span>{configError ? `分類與品牌清單載入失敗：${configError}` : '分類與品牌清單載入中…'}</span>
            {configError && <button type="button" className="btn ghost" onClick={onRetryConfig}>重新載入</button>}
          </div>
        )}

        <div className="form-grid">
          <label className="span-2">品名<input ref={firstField} value={form.name} onChange={set('name')} required placeholder="例：Panasonic 480L 變頻雙門冰箱" /></label>
          <label>分類
            <select value={form.category} onChange={changeCategory} required>
              <option value="">請選擇</option>
              {Object.keys(templates).map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label>品牌
            <select value={form.brand} onChange={set('brand')} required disabled={!form.category}>
              <option value="">{form.category ? '請選擇' : '請先選分類'}</option>
              {brandOptions.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </label>
          <label>型號<input value={form.model} onChange={set('model')} required placeholder="例：DM-RF480" /></label>
          <label>保固<input value={form.warranty} onChange={set('warranty')} placeholder="例：3 年" /></label>
          <label>原價（元）<input type="number" min="0" step="1" value={form.list_price} onChange={set('list_price')} required /></label>
          <label>售價（元）<input type="number" min="0" step="1" value={form.sale_price} onChange={set('sale_price')} required /></label>
          <label className="checkbox span-2"><input type="checkbox" checked={form.is_active} onChange={set('is_active')} /> 上架中</label>
        </div>

        <fieldset className="spec-fieldset">
          <legend>規格{form.category && `（${form.category}）`}</legend>
          <div className="form-grid">
            <SpecFields template={template} specs={specs} onChange={setSpec} />
          </div>
          {template && <p className="hint">標 * 為必填。不同分類有各自固定的規格欄位。</p>}
        </fieldset>
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
  const [brand, setBrand] = useState('')
  const [status, setStatus] = useState('all')
  const [result, setResult] = useState({ key: null, products: [], error: '' })
  const [reloadTick, setReloadTick] = useState(0)
  const [categories, setCategories] = useState([])
  const [config, setConfig] = useState({ templates: {}, brands: {}, error: '' })
  const [selectedId, setSelectedId] = useState(null)
  const [editing, setEditing] = useState(undefined) // undefined=關閉, null=新增, 物件=編輯
  const [toast, setToast] = useState('')

  // 輸入停 0.25 秒才搜尋，避免每打一個字就查一次
  useEffect(() => {
    const t = setTimeout(() => setQuery(q), 250)
    return () => clearTimeout(t)
  }, [q])

  const key = new URLSearchParams({ q: query, category, brand, status }).toString()

  // 品牌篩選：有選分類就只列該分類的品牌，否則列全部品牌
  const brandFilterOptions = category
    ? config.brands[category] ?? []
    : [...new Set(Object.values(config.brands).flat())].sort((a, b) => a.localeCompare(b, 'zh-Hant'))

  function changeCategoryFilter(e) {
    const next = e.target.value
    setCategory(next)
    if (next && brand && !(config.brands[next] ?? []).includes(brand)) setBrand('')
  }
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
  // 分類、規格欄位、品牌清單；載入失敗時表單會顯示「重新載入」
  const loadConfig = useCallback(() => {
    api('/catalog-config')
      .then((d) => setConfig({ templates: d.templates, brands: d.brands, error: '' }))
      .catch((e) => setConfig((c) => ({ ...c, error: e.message })))
  }, [])
  useEffect(loadConfig, [loadConfig])

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
        <select value={category} onChange={changeCategoryFilter} aria-label="分類">
          <option value="">全部分類</option>
          {categories.map((c) => <option key={c.category} value={c.category}>{c.category}（{c.count}）</option>)}
        </select>
        <select value={brand} onChange={(e) => setBrand(e.target.value)} aria-label="品牌">
          <option value="">全部品牌</option>
          {brandFilterOptions.map((b) => <option key={b} value={b}>{b}</option>)}
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
        <ProductDetail key={selectedId} id={selectedId} templates={config.templates} onClose={closeDetail} onEdit={(p) => setEditing(p)} />
      )}
      {editing !== undefined && (
        <ProductForm
          product={editing}
          templates={config.templates}
          brands={config.brands}
          configError={config.error}
          onRetryConfig={loadConfig}
          onClose={closeForm}
          onSaved={handleSaved}
        />
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </section>
  )
}
