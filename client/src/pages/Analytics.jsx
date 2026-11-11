import { useEffect, useState } from 'react'
import { api, formatPrice } from '../api.js'
import { ORDER_STATUS } from '../orderLabels.js'

const fmt = (n) => Number(n).toLocaleString('zh-TW')
// 金額縮寫：10,931,390 → 1,093.1 萬
const wan = (n) => (n >= 100000 ? `${(n / 10000).toLocaleString('zh-TW', { maximumFractionDigits: 1 })} 萬` : fmt(n))

const STATUS_ORDER = ['pending', 'reserved', 'shipped', 'completed', 'cancelled']

function Kpi({ label, value, hint, href, tone }) {
  const Tag = href ? 'a' : 'div'
  return (
    <Tag className={`stat-card ${tone ?? ''}`} href={href}>
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
      {hint && <span className="stat-hint">{hint}</span>}
    </Tag>
  )
}

// 一個數列的橫條清單：標籤｜長條｜數值（數值是文字，不必滑過才看得到）
function BarList({ rows, max, valueLabel, caption }) {
  const top = max ?? Math.max(1, ...rows.map((r) => r.value))
  return (
    <table className="bar-list">
      <caption className="sr-only">{caption}</caption>
      <thead className="sr-only"><tr><th>項目</th><th>長條</th><th>{valueLabel}</th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} title={`${r.label}：${r.display}`}>
            <th scope="row">
              {r.label}
              {r.sub && <small>{r.sub}</small>}
            </th>
            <td className="bar-cell" aria-hidden="true">
              <span className="bar" style={{ width: `${Math.max((r.value / top) * 100, r.value > 0 ? 1.5 : 0)}%` }} />
            </td>
            <td className="bar-value">{r.display}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

const HEALTH = [
  { key: 'ok', label: '正常', icon: '●', cls: 'good' },
  { key: 'low', label: '偏低', icon: '▲', cls: 'warning' },
  { key: 'out', label: '缺貨', icon: '✕', cls: 'critical' },
]

// 各門市庫存健康：每家店一條分段長條，旁邊列出數字
function HealthBars({ stores, storeLow }) {
  return (
    <>
      <div className="viz-legend" aria-label="圖例">
        {HEALTH.map((h) => (
          <span key={h.key}><i className={`swatch-status ${h.cls}`} aria-hidden="true">{h.icon}</i>{h.label}</span>
        ))}
        <span className="viz-legend-note">偏低＝單店可售 1～{storeLow} 件</span>
      </div>
      <table className="health-list">
        <caption className="sr-only">各門市上架商品的庫存狀態件數</caption>
        <thead className="sr-only"><tr><th>門市</th><th>分布</th><th>正常</th><th>偏低</th><th>缺貨</th></tr></thead>
        <tbody>
          {stores.map((s) => {
            const total = s.ok + s.low + s.out || 1
            return (
              <tr key={s.store_id}>
                <th scope="row">{s.name}<small>{s.region}</small></th>
                <td className="health-bar" aria-hidden="true">
                  {HEALTH.map((h) => s[h.key] > 0 && (
                    <span
                      key={h.key}
                      className={`seg ${h.cls}`}
                      style={{ flexGrow: s[h.key] / total }}
                      title={`${s.name}・${h.label} ${s[h.key]} 項`}
                    />
                  ))}
                </td>
                {HEALTH.map((h) => (
                  <td key={h.key} className={`health-num ${h.key === 'out' && s.out ? 'text-danger' : ''}`}>
                    <span className="health-tag">{h.icon}</span>{s[h.key]}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </>
  )
}

function Card({ title, sub, children, wide }) {
  return (
    <section className={`viz-card ${wide ? 'wide' : ''}`}>
      <header>
        <h2>{title}</h2>
        {sub && <p>{sub}</p>}
      </header>
      {children}
    </section>
  )
}

export default function Analytics() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [tick, setTick] = useState(0)

  useEffect(() => {
    api('/analytics').then((d) => { setData(d); setError('') }).catch((e) => setError(e.message))
  }, [tick])

  const k = data?.kpis
  return (
    <section className="page" aria-labelledby="analytics-heading">
      <div className="page-head">
        <div>
          <p className="eyebrow">ANALYTICS</p>
          <h1 id="analytics-heading">營運分析</h1>
          <p className="muted">營收、訂單、庫存健康與熱銷商品。數字都是即時從資料庫計算。</p>
        </div>
        <button type="button" className="btn ghost" onClick={() => setTick((t) => t + 1)}>重新整理</button>
      </div>

      {error && <p className="form-error" role="alert">分析資料載入失敗：{error}</p>}
      {!data && !error && <p className="muted">載入中…</p>}

      {data && (
        <div>
          <div className="stat-grid">
            <Kpi label="已出貨營收" value={`NT$ ${wan(k.revenue)}`} hint={`${k.revenue_orders} 張已出貨／完成訂單`} href="#orders" />
            <Kpi label="已預留待出貨" value={`NT$ ${wan(k.reserved_value)}`} hint={`${k.reserved_orders} 張已預留訂單`} href="#orders" />
            <Kpi label="庫存價值" value={`NT$ ${wan(k.inventory_value)}`} hint={`實體庫存 ${fmt(k.inventory_units)} 件 × 售價`} />
            <Kpi
              label="缺貨門市品項"
              value={k.out_cells}
              hint={`共 ${k.total_cells} 個「門市 × 商品」，缺貨率 ${Math.round((k.out_cells / Math.max(k.total_cells, 1)) * 100)}%`}
              tone={k.out_cells ? 'warn' : ''}
              href="#inventory"
            />
          </div>

          <div className="viz-grid">
            <Card title="各門市庫存健康" sub="每家門市的上架商品，各有幾項正常、偏低、缺貨" wide>
              <HealthBars stores={data.store_health} storeLow={data.store_low} />
            </Card>

            <Card title="各分類庫存價值" sub="實體庫存 × 目前售價">
              <BarList
                caption="各分類庫存價值"
                valueLabel="庫存價值"
                rows={data.categories.map((c) => ({
                  key: c.category, label: c.category, sub: `可售 ${fmt(c.available)} 件`, value: c.value, display: `NT$ ${wan(c.value)}`,
                }))}
              />
            </Card>

            <Card title="各門市訂單金額" sub="不含已取消的訂單">
              <BarList
                caption="各門市訂單金額"
                valueLabel="訂單金額"
                rows={data.store_sales.map((s) => ({
                  key: s.store_id, label: s.name, sub: `${s.orders} 張`, value: s.total, display: formatPrice(s.total),
                }))}
              />
            </Card>

            <Card title="訂單狀態" sub="各狀態的訂單數">
              <BarList
                caption="訂單狀態"
                valueLabel="張數"
                rows={STATUS_ORDER.map((st) => {
                  const row = data.order_status.find((o) => o.status === st)
                  return {
                    key: st, label: ORDER_STATUS[st].label, sub: row ? formatPrice(row.total) : '', value: row?.count ?? 0, display: `${row?.count ?? 0} 張`,
                  }
                })}
              />
            </Card>

            <Card title="熱銷商品 Top 5" sub="依訂購件數（不含已取消）">
              {data.top_products.length ? (
                <BarList
                  caption="熱銷商品"
                  valueLabel="件數"
                  rows={data.top_products.map((p) => ({
                    key: p.product_id, label: p.name, sub: `${p.product_id}・${formatPrice(p.revenue)}`, value: p.qty, display: `${p.qty} 件`,
                  }))}
                />
              ) : <p className="muted">還沒有訂單資料</p>}
            </Card>
          </div>
        </div>
      )}
    </section>
  )
}
