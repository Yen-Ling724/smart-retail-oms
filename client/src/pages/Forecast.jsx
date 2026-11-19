import { useEffect, useMemo, useState } from 'react'
import { api, formatPrice } from '../api.js'

const fmt = (n) => Math.round(Number(n)).toLocaleString('zh-TW')
const wan = (n) => (n >= 100000 ? `${(n / 10000).toLocaleString('zh-TW', { maximumFractionDigits: 0 })} 萬` : fmt(n))
const ym = (m) => `${m.slice(2, 4)}/${m.slice(5, 7)}`
const sum = (a) => a.reduce((s, x) => s + x, 0)
const MONTH_NAMES = ['1 月', '2 月', '3 月', '4 月', '5 月', '6 月', '7 月', '8 月', '9 月', '10 月', '11 月', '12 月']

const STATUS = {
  reorder_now: { label: '立即補貨', tone: 'danger' },
  plan: { label: '旺季前補貨', tone: 'warn' },
  ok: { label: '充足', tone: 'ok' },
  excess: { label: '庫存過多', tone: 'info' },
}
const PLAN_TABS = [
  { key: 'need', label: '需要補貨', test: (r) => r.status === 'reorder_now' || r.status === 'plan' },
  { key: 'excess', label: '庫存過多', test: (r) => r.status === 'excess' },
  { key: 'all', label: '全部', test: () => true },
]

function Kpi({ label, value, hint, tone }) {
  return (
    <div className={`stat-card ${tone ?? ''}`}>
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
      {hint && <span className="stat-hint">{hint}</span>}
    </div>
  )
}

function Card({ title, sub, children, wide, action }) {
  return (
    <section className={`viz-card ${wide ? 'wide' : ''}`}>
      <header className="fc-card-head">
        <div>
          <h2>{title}</h2>
          {sub && <p>{sub}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  )
}

// 實際銷量（實線）＋預測（虛線、同色）＋ 80% 區間（淡色帶）；補助期間灰底。滑過每個月看數字
function ForecastChart({ months, future, chart, events }) {
  const [hover, setHover] = useState(null)
  const all = [...months, ...future]
  const n = all.length
  const W = 960
  const H = 300
  const pad = { l: 48, r: 16, t: 26, b: 34 }
  const max = Math.max(...chart.actual, ...chart.upper) * 1.08 || 1
  const step = Math.pow(10, Math.floor(Math.log10(max))) / (max / Math.pow(10, Math.floor(Math.log10(max))) > 5 ? 1 : 2)
  const ticks = []
  for (let v = 0; v <= max; v += step) ticks.push(v)
  const x = (i) => pad.l + (i / (n - 1)) * (W - pad.l - pad.r)
  const y = (v) => H - pad.b - (v / max) * (H - pad.t - pad.b)
  const T = months.length
  const actualPath = chart.actual.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('')
  const fcPath = [`M${x(T - 1).toFixed(1)},${y(chart.actual[T - 1]).toFixed(1)}`, ...chart.forecast.map((v, h) => `L${x(T + h).toFixed(1)},${y(v).toFixed(1)}`)].join('')
  const band = [
    `M${x(T - 1)},${y(chart.actual[T - 1])}`,
    ...chart.upper.map((v, h) => `L${x(T + h)},${y(v)}`),
    ...chart.lower.map((v, h) => `L${x(T + chart.lower.length - 1 - h)},${y(chart.lower[chart.lower.length - 1 - h])}`).slice(0),
    'Z',
  ].join('')
  const subsidies = events.filter((e) => e.type === 'subsidy')
  const span = (e) => {
    const a = all.findIndex((m) => m >= e.start_month)
    let b = all.length - 1
    for (let i = all.length - 1; i >= 0; i--) if (all[i] <= e.end_month) { b = i; break }
    return a < 0 || a > b ? null : [a, b]
  }
  const value = (i) => (i < T ? { kind: '實際', v: chart.actual[i] } : { kind: '預測', v: chart.forecast[i - T], lo: chart.lower[i - T], hi: chart.upper[i - T] })
  const activeEvents = (m) => events.filter((e) => m >= e.start_month && m <= e.end_month)
  const half = (W - pad.l - pad.r) / (n - 1) / 2

  return (
    <div className="fc-chart">
      <div className="fc-legend" aria-label="圖例">
        <span><i className="sw solid" />實際銷量</span>
        <span><i className="sw dash" />預測</span>
        <span><i className="sw band" />80% 預測區間</span>
        <span><i className="sw sub" />補助期間</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="冷氣月銷量：實際與未來 12 個月預測" onMouseLeave={() => setHover(null)}>
        {subsidies.map((e) => {
          const s = span(e)
          if (!s) return null
          return (
            <g key={e.id}>
              <rect x={x(s[0]) - half} y={pad.t} width={x(s[1]) - x(s[0]) + half * 2} height={H - pad.t - pad.b} className="fc-sub" />
              <text x={x(s[0]) - half + 4} y={pad.t - 8} className="fc-sub-label">補助</text>
            </g>
          )
        })}
        {ticks.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} className="fc-grid" />
            <text x={pad.l - 8} y={y(v) + 4} className="fc-axis" textAnchor="end">{fmt(v)}</text>
          </g>
        ))}
        {all.map((m, i) => (i % 3 === 0 ? <text key={m} x={x(i)} y={H - pad.b + 18} className="fc-axis" textAnchor="middle">{ym(m)}</text> : null))}
        <line x1={x(T - 1) + half} x2={x(T - 1) + half} y1={pad.t} y2={H - pad.b} className="fc-today" />
        <text x={x(T - 1) + half + 4} y={pad.t + 12} className="fc-axis">預測 →</text>
        <path d={band} className="fc-band" />
        <path d={actualPath} className="fc-line" />
        <path d={fcPath} className="fc-line dash" />
        {hover != null && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} className="fc-cross" />
            <circle cx={x(hover)} cy={y(value(hover).v)} r="5" className="fc-dot" />
          </>
        )}
        {all.map((m, i) => (
          <rect key={m} x={x(i) - half} y={pad.t} width={half * 2} height={H - pad.t - pad.b} fill="transparent" onMouseEnter={() => setHover(i)} />
        ))}
      </svg>
      {hover != null && (() => {
        const v = value(hover)
        const left = Math.min(Math.max((x(hover) / W) * 100, 12), 82)
        const ev = activeEvents(all[hover])
        return (
          <div className="fc-tip" style={{ left: `${left}%` }}>
            <strong>{all[hover].replace('-', ' 年 ')} 月</strong>
            <div>{v.kind}：{fmt(v.v)} 台</div>
            {v.lo != null && <div className="muted">區間 {fmt(v.lo)}～{fmt(v.hi)} 台</div>}
            {ev.map((e) => <div key={e.id} className="muted">{e.name}（×{Number(e.uplift)}）</div>)}
          </div>
        )
      })()}
    </div>
  )
}

export default function Forecast() {
  const [scope, setScope] = useState('')
  const [tempDelta, setTempDelta] = useState(0)
  const [leading, setLeading] = useState(false)
  const [tab, setTab] = useState('need')
  const [showTable, setShowTable] = useState(false)
  const [planLimit, setPlanLimit] = useState(20)
  const [result, setResult] = useState({ key: null, data: null, error: '' })

  const [kind, id] = scope.split(':')
  const key = new URLSearchParams({ ...(kind === 'r' ? { region: id } : kind === 's' ? { store: id } : {}), temp_delta: tempDelta, leading: leading ? 1 : 0 }).toString()
  const loading = result.key !== key
  useEffect(() => {
    let cancelled = false
    api(`/forecast?${key}`)
      .then((d) => { if (!cancelled) setResult({ key, data: d, error: '' }) })
      .catch((e) => { if (!cancelled) setResult((r) => ({ ...r, key, error: e.message })) })
    return () => { cancelled = true }
  }, [key])

  const d = result.data
  const scopeName = useMemo(() => {
    if (!d) return ''
    if (kind === 'r') return id
    if (kind === 's') return d.stores.find((s) => s.store_id === id)?.name ?? ''
    return `全部 ${d.stores.length} 間門市`
  }, [d, kind, id])

  if (!d) {
    return (
      <section className="page">
        <p className="muted">{result.error ? `載入失敗：${result.error}` : '計算中…'}</p>
      </section>
    )
  }
  if (d.empty) return <section className="page"><p className="muted">{d.message}</p></section>

  const T = d.months.length
  const next12 = sum(d.chart.forecast)
  const last12 = sum(d.chart.actual.slice(-12))
  const peakIdx = d.future.map((m, i) => [m, i]).filter(([m]) => ['06', '07', '08'].includes(m.slice(5)))
  const peakF = sum(peakIdx.map(([, i]) => d.chart.forecast[i]))
  const peakLast = sum(d.months.map((m, i) => [m, i]).filter(([m]) => ['06', '07', '08'].includes(m.slice(5))).slice(-3).map(([, i]) => d.chart.actual[i]))
  const needRows = d.plan.filter((r) => r.need_month)
  const orderUnits = sum(needRows.map((r) => r.order_qty))
  const orderValue = sum(needRows.map((r) => r.order_qty * r.price))
  const transferUnits = sum(d.transfers.map((t) => t.qty))
  const excessRows = d.plan.filter((r) => r.status === 'excess')
  const excessValue = sum(excessRows.map((r) => Math.max(0, r.position - r.need_12) * r.price))
  const tabTest = PLAN_TABS.find((t) => t.key === tab).test
  const planRows = d.plan.filter(tabTest).sort((a, b) => (a.order_by ?? '9999').localeCompare(b.order_by ?? '9999') || b.months_supply - a.months_supply)
  const maxTier = Math.max(...d.by_tier.flatMap((t) => t.forecast), 1)
  const bt = d.backtest

  return (
    <section className="page" aria-labelledby="forecast-heading">
      <div className="page-head">
        <div>
          <p className="eyebrow">MODULE 06</p>
          <h1 id="forecast-heading">需求預測與補貨</h1>
          <p className="muted">
            冷氣季節性需求預測與備貨建議：依 36 個月銷售、氣溫、補助與促銷，預測各門市 × 坪數級距未來 12 個月的需求，
            算出安全庫存、最晚下單日與跨店調撥。<span className="badge warn">銷售歷史為模擬資料</span>
          </p>
        </div>
      </div>

      <div className="toolbar fc-toolbar">
        <select value={scope} onChange={(e) => setScope(e.target.value)} aria-label="範圍">
          <option value="">全部門市</option>
          <optgroup label="區域">
            {d.regions.map((r) => <option key={r} value={`r:${r}`}>{r}</option>)}
          </optgroup>
          {d.regions.map((r) => (
            <optgroup key={r} label={`${r}門市`}>
              {d.stores.filter((s) => s.region === r).map((s) => <option key={s.store_id} value={`s:${s.store_id}`}>{s.name}</option>)}
            </optgroup>
          ))}
        </select>
        <div className="seg-group" role="group" aria-label="夏季氣溫情境">
          <span className="seg-label">夏季氣溫情境</span>
          {[-1, 0, 1, 2].map((t) => (
            <button key={t} type="button" className={tempDelta === t ? 'active' : ''} aria-pressed={tempDelta === t} onClick={() => setTempDelta(t)}>
              {t === 0 ? '與往年相同' : `${t > 0 ? '+' : ''}${t}°C`}
            </button>
          ))}
        </div>
        <label className="check-inline">
          <input type="checkbox" checked={leading} onChange={(e) => setLeading(e.target.checked)} />
          納入 3D 試算領先指標（前 2 個月）
        </label>
        <span className="result-count">{loading ? '計算中…' : scopeName}</span>
      </div>
      {result.error && <p className="form-error" role="alert">{result.error}</p>}

      <div className="stat-grid five">
        <Kpi label="未來 12 個月預測" value={`${fmt(next12)} 台`} hint={`過去 12 個月實際 ${fmt(last12)} 台（${next12 >= last12 ? '+' : ''}${Math.round((next12 / Math.max(last12, 1) - 1) * 100)}%）`} />
        <Kpi label="明年旺季（6～8 月）" value={`${fmt(peakF)} 台`} hint={`今年同期實際 ${fmt(peakLast)} 台${tempDelta ? `・情境 ${tempDelta > 0 ? '+' : ''}${tempDelta}°C` : ''}`} />
        <Kpi label="回測誤差（總量）" value={`${bt.wape_total_model}%`} hint={`「去年同月」法 ${bt.wape_total_naive}%・各門市×級距 ${bt.wape_model}% vs ${bt.wape_naive}%`} tone={bt.wape_total_model < bt.wape_total_naive ? '' : 'warn'} />
        <Kpi label="建議向供應商下單" value={`${fmt(orderUnits)} 台`} hint={`約 NT$ ${wan(orderValue)}・另跨店調撥 ${fmt(transferUnits)} 台`} tone={needRows.some((r) => r.status === 'reorder_now') ? 'warn' : ''} />
        <Kpi label="庫存過多（超過 12 個月需求）" value={`${excessRows.length} 項`} hint={`多出的庫存約 NT$ ${wan(excessValue)}，可調撥或促銷去化`} tone={excessRows.length ? 'warn' : ''} />
      </div>

      <div className="viz-grid">
        <Card
          title={`冷氣月銷量與預測・${scopeName}`}
          sub={`${ym(d.months[0])}～${ym(d.history_end)} 實際，${ym(d.future[0])}～${ym(d.future.at(-1))} 預測（已計入已排定的補助與促銷）`}
          wide
          action={<button type="button" className="btn ghost small" onClick={() => setShowTable((v) => !v)}>{showTable ? '看圖表' : '看表格'}</button>}
        >
          {showTable ? (
            <div className="table-wrap">
              <table className="data-table compact">
                <thead><tr><th>月份</th><th className="num">實際</th><th className="num">預測</th><th className="num">80% 區間</th></tr></thead>
                <tbody>
                  {[...d.months.slice(-12).map((m, i) => [m, d.chart.actual[T - 12 + i], null]), ...d.future.map((m, h) => [m, null, h])].map(([m, a, h]) => (
                    <tr key={m}><td>{m}</td><td className="num">{a != null ? fmt(a) : '—'}</td><td className="num">{h != null ? fmt(d.chart.forecast[h]) : '—'}</td><td className="num">{h != null ? `${fmt(d.chart.lower[h])}～${fmt(d.chart.upper[h])}` : '—'}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <ForecastChart months={d.months} future={d.future} chart={d.chart} events={d.events.filter((e) => !e.category || e.category === '冷氣')} />
          )}
        </Card>

        <Card title="回測：預測準不準？" sub={`假裝不知道最後 6 個月：只用前 ${T - 6} 個月建模，預測 ${ym(bt.months[0])}～${ym(bt.months.at(-1))}，再跟實際比（全部門市合計）`}>
          <div className="table-wrap">
            <table className="data-table compact">
              <thead><tr><th>月份</th><th className="num">實際</th><th className="num">本模型</th><th className="num">去年同月</th></tr></thead>
              <tbody>
                {bt.months.map((m, i) => (
                  <tr key={m}>
                    <td>{m}</td>
                    <td className="num">{fmt(bt.total_actual[i])}</td>
                    <td className="num">{fmt(bt.total_model[i])}<small>{Math.round(((bt.total_model[i] - bt.total_actual[i]) / bt.total_actual[i]) * 100)}%</small></td>
                    <td className="num">{fmt(bt.total_naive[i])}<small>{Math.round(((bt.total_naive[i] - bt.total_actual[i]) / bt.total_actual[i]) * 100)}%</small></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint">誤差用 WAPE（絕對誤差總和 ÷ 實際總量）。「去年同月」沒考慮成長、補助與氣溫，所以誤差較大；單店單級距的量小、隨機波動大，誤差自然比總量高。</p>
        </Card>

        <Card title="模型學到了什麼" sub="季節指數用區域總量估計，各門市只估自己的水準">
          <div className="table-wrap">
            <table className="data-table compact fc-season">
              <thead><tr><th>區域</th>{MONTH_NAMES.map((m) => <th key={m} className="num">{m.replace(' 月', '')}</th>)}<th className="num">年成長</th></tr></thead>
              <tbody>
                {Object.entries(d.model.seasonal_index).map(([r, s]) => (
                  <tr key={r}><td>{r}</td>{s.map((v, i) => <td key={i} className="num" style={{ background: `color-mix(in srgb, var(--series-1) ${Math.round(Math.min(v / 2.4, 1) * 45)}%, transparent)` }}>{v.toFixed(2)}</td>)}<td className="num">{d.model.yearly_growth[r]}%</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="fc-notes">
            <li>季節指數 1.00＝全年平均；7 月約是平均的 2 倍以上，1～2 月只有 3 成多。</li>
            <li>夏季（5～9 月）氣溫每比往年高 1°C，冷氣需求約 <b>{d.model.temp_elasticity >= 0 ? '+' : ''}{(d.model.temp_elasticity * 100).toFixed(1)}%</b>（從歷史資料估計）。</li>
            <li>補助、促銷期間的需求先除掉事件影響再建模，預測時再乘回已排定的事件。</li>
          </ul>
        </Card>

        <Card title="各坪數級距未來 12 個月預測（台）" sub="顏色越深＝需求越多；過去 12 個月實際做對照" wide>
          <div className="table-wrap">
            <table className="data-table compact fc-heat">
              <thead><tr><th>級距</th><th className="num">過去 12 月</th>{d.future.map((m) => <th key={m} className="num">{ym(m)}</th>)}<th className="num">合計</th></tr></thead>
              <tbody>
                {d.by_tier.map((t) => (
                  <tr key={t.tier}>
                    <td>{t.tier}</td>
                    <td className="num muted-num">{fmt(t.last12)}</td>
                    {t.forecast.map((v, i) => <td key={i} className="num" style={{ background: `color-mix(in srgb, var(--series-1) ${Math.round((v / maxTier) * 55)}%, transparent)`, color: v / maxTier > 0.6 ? '#fff' : undefined }}>{fmt(v)}</td>)}
                    <td className="num"><strong>{fmt(sum(t.forecast))}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <div className="viz-grid">
        <Card title="補貨建議（門市 × 坪數級距）" sub="依預測推算每月月底庫存，低於當月安全庫存的月份＝預計不足；最晚下單日＝不足月份 − 交期 − 7 天緩衝" wide>
          <div className="tabs" role="tablist">
            {PLAN_TABS.map((t) => (
              <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={`tab ${tab === t.key ? 'active' : ''}`} onClick={() => { setTab(t.key); setPlanLimit(20) }}>
                {t.label}<span className="tab-count">{d.plan.filter(t.test).length}</span>
              </button>
            ))}
          </div>
          <div className="table-wrap">
            <table className="data-table compact">
              <thead>
                <tr>
                  <th>門市</th><th>級距</th><th>分類</th><th className="num">可售＋在途</th><th className="num">安全庫存<small>現在／旺季</small></th>
                  <th>預計不足</th><th>最晚下單</th><th className="num">建議下單</th><th className="num">調入／調出</th><th className="num">可撐幾個月</th><th>狀態</th>
                </tr>
              </thead>
              <tbody>
                {planRows.slice(0, planLimit).map((r) => (
                  <tr key={`${r.store_id}|${r.tier}`}>
                    <td>{r.store_name}<small>{r.region}</small></td>
                    <td>{r.tier}</td>
                    <td><span className="badge" title={`服務水準 ${Math.round(r.service * 100)}%`}>{r.abc}{r.xyz}</span><small>服務 {Math.round(r.service * 100)}%</small></td>
                    <td className="num">{r.available}{r.in_transit ? <small>在途 {r.in_transit}</small> : null}</td>
                    <td className="num">{r.safety_stock}／{r.peak_safety_stock}</td>
                    <td>{r.need_month ? ym(r.need_month) : '—'}</td>
                    <td className={r.status === 'reorder_now' ? 'text-danger' : ''}>{r.order_by ?? '—'}</td>
                    <td className="num">{r.order_qty ? <strong>{r.order_qty}</strong> : '—'}{r.need_month && r.eoq ? <small>EOQ {r.eoq}</small> : null}</td>
                    <td className="num">{r.transfer_in ? `+${r.transfer_in}` : ''}{r.transfer_in && r.transfer_out ? '／' : ''}{r.transfer_out ? `−${r.transfer_out}` : ''}{!r.transfer_in && !r.transfer_out ? '—' : ''}</td>
                    <td className="num">{r.months_supply}</td>
                    <td><span className={`badge ${STATUS[r.status].tone}`}>{STATUS[r.status].label}</span></td>
                  </tr>
                ))}
                {!planRows.length && <tr><td colSpan="11" className="empty">沒有符合的項目</td></tr>}
              </tbody>
            </table>
          </div>
          {planRows.length > planLimit && (
            <div className="fc-more">
              <button type="button" className="btn ghost small" onClick={() => setPlanLimit((n) => n + 40)}>再顯示 40 項（共 {planRows.length} 項）</button>
              <span className="hint">依最晚下單日排序；可用上方範圍只看某區或某間門市。</span>
            </div>
          )}
        </Card>

        <Card title="跨店調撥建議" sub="旺季前，先從同區「庫存超過自己 12 個月需求」的門市調貨，再向供應商補不足的部分">
          {d.transfers.length ? (
            <div className="table-wrap">
              <table className="data-table compact">
                <thead><tr><th>級距</th><th>調出門市</th><th>調入門市</th><th className="num">台數</th><th>調入店不足月份</th></tr></thead>
                <tbody>
                  {d.transfers.map((t, i) => (
                    <tr key={i}><td>{t.tier}</td><td>{t.from_name}</td><td>{t.to_name}</td><td className="num">{t.qty}</td><td>{t.need_month ? ym(t.need_month) : '—'}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="muted">目前範圍內沒有可以調撥的組合。</p>}
          <p className="hint">實際建立調貨單請到「門市庫存 → 調貨單」。</p>
        </Card>

        <Card title="ABC／XYZ 分類" sub="ABC＝近 12 個月營收占比（A 前 80%）；XYZ＝需求穩定度（變異係數）">
          <div className="table-wrap">
            <table className="data-table compact fc-abc">
              <thead><tr><th></th><th className="num">X 穩定</th><th className="num">Y 普通</th><th className="num">Z 波動大</th></tr></thead>
              <tbody>
                {['A', 'B', 'C'].map((a) => (
                  <tr key={a}><th>{a}<small>服務水準 {Math.round(d.model.service_levels[a] * 100)}%</small></th>{['X', 'Y', 'Z'].map((x) => <td key={x} className="num">{d.abc_xyz[`${a}${x}`] ?? 0}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="fc-notes">
            <li>A 類（主力）用較高的服務水準，安全庫存多一點，避免旺季缺貨。</li>
            <li>C／Z 類（長尾、波動大）不宜每店都大量備貨，可集中在區域大店，其他門市接單調貨。</li>
          </ul>
        </Card>

        <Card title="3D 試算領先指標" sub="各區近 28 天冷氣試算＋場勘預約，跟前 28 天比；勾選上方選項會用來微調前 2 個月預測">
          <div className="table-wrap">
            <table className="data-table compact">
              <thead><tr><th>區域</th><th className="num">近 28 天</th><th className="num">前 28 天</th><th className="num">變化</th></tr></thead>
              <tbody>
                {d.leading.map((l) => (
                  <tr key={l.region}><td>{l.region}</td><td className="num">{l.recent}</td><td className="num">{l.prior}</td><td className="num">{l.ratio >= 1 ? '+' : ''}{Math.round((l.ratio - 1) * 100)}%</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint">調整幅度＝30% × 變化（上下限 −15%～+25%），只影響前 2 個月。資料來自 3D 坪數選購頁。</p>
        </Card>

        <Card title="已排定的補助與促銷" sub="事件倍數為示範設定（1.15＝需求多 15%）">
          <div className="table-wrap">
            <table className="data-table compact">
              <thead><tr><th>事件</th><th>期間</th><th className="num">倍數</th></tr></thead>
              <tbody>
                {d.events.filter((e) => e.end_month >= d.months[T - 12]).map((e) => (
                  <tr key={e.id}><td>{e.name}<small>{e.type === 'subsidy' ? '補助' : '促銷'}{e.category ? `・${e.category}` : '・全分類'}</small></td><td>{ym(e.start_month)}{e.end_month !== e.start_month ? `～${ym(e.end_month)}` : ''}</td><td className="num">×{Number(e.uplift)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="供應商交期（示範設定）" sub="各坪數級距的交期依該級距的品牌組成加權">
          <div className="table-wrap">
            <table className="data-table compact">
              <thead><tr><th>品牌</th><th className="num">平均交期</th><th className="num">標準差</th></tr></thead>
              <tbody>
                {d.lead_times.map((l) => (
                  <tr key={l.brand}><td>{l.brand}{l.note && <small>{l.note}</small>}</td><td className="num">{Number(l.lead_days)} 天</td><td className="num">±{Number(l.lead_sd_days)} 天</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="計算方式" sub="給簡報用的公式說明" wide>
          <ol className="fc-method">
            <li><b>去除事件影響</b>：實際銷量 ÷ 當月補助、促銷倍數，得到「一般月份」的需求。</li>
            <li><b>季節指數與成長率</b>：用各區總量估計（每個月是全年平均的幾倍；第一年到最後一年的平均成長）。</li>
            <li><b>門市水準</b>：每間門市 × 坪數級距的需求除掉季節、成長、事件、氣溫後，用指數平滑（α = 0.3）取得目前水準。</li>
            <li><b>預測</b> ＝ 水準 × 成長 × 季節指數 × 已排定事件倍數 × 氣溫情境 ×（3D 領先指標）。</li>
            <li><b>安全庫存</b> ＝ z × √(交期 × 日需求標準差² ＋ 日需求² × 交期標準差²)，z 依 ABC 服務水準（98%／95%／90%）；每個月依當月預測重算，旺季較高。</li>
            <li><b>再訂購點</b> ＝ 日需求 × 交期 ＋ 安全庫存；<b>經濟訂購量 EOQ</b> ＝ √(2 × 年需求 × 每次下單成本 800 ÷ (年持有成本率 20% × 單價))。</li>
            <li><b>補貨時機</b>：用預測推算每月月底庫存，第一個低於安全庫存的月份就是「預計不足」；建議量足以撐過之後 3 個月，至少一個 EOQ。</li>
          </ol>
          <p className="hint">本頁的銷售歷史、氣溫、事件倍數與交期都是示範用的模擬資料；接上真實銷售資料後，計算方式不變。</p>
        </Card>
      </div>
    </section>
  )
}
