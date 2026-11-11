import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { modules } from '../modules.js'

function StatCard({ label, value, hint, tone, href }) {
  const content = (
    <>
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
      {hint && <span className="stat-hint">{hint}</span>}
    </>
  )
  return href
    ? <a className={`stat-card ${tone ?? ''}`} href={href}>{content}</a>
    : <div className={`stat-card ${tone ?? ''}`}>{content}</div>
}

export default function Overview() {
  const [stats, setStats] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api('/stats').then((d) => setStats(d.stats)).catch((e) => setError(e.message))
  }, [])

  return (
    <>
      <section className="welcome">
        <div>
          <p className="eyebrow">SMART RETAIL OPERATIONS</p>
          <h1>讓每一筆零售資料，<br />都成為更好的決策。</h1>
          <p className="welcome-copy">整合商品、門市庫存與訂單流程，打造更清楚的零售營運視角。</p>
        </div>
        <div className="welcome-icon" aria-hidden="true">
          <span>好物</span>
          <strong>選得<br />剛剛好</strong>
          <i>✳</i>
        </div>
      </section>

      <section className="notice" aria-label="模擬資料聲明">
        <span className="notice-icon" aria-hidden="true">i</span>
        <p><strong>個人作品集模擬專案</strong><br />品牌名稱僅用於呈現零售情境；商品型號、規格、價格、門市與庫存皆為虛構資料，與各品牌及全國電子官方無關，也不連接任何企業內部系統。</p>
      </section>

      <section className="overview-section" aria-labelledby="snapshot-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">YOUR WORKSPACE</p>
            <h2 id="snapshot-heading">營運快照</h2>
          </div>
          <span className="empty-status">{stats ? '即時資料' : error ? '' : '載入中…'}</span>
        </div>
        {error && <p className="form-error" role="alert">營運資料載入失敗：{error}</p>}
        {stats && (
          <div className="stat-grid">
            <StatCard label="上架商品" value={stats.active_products} hint={`共 ${stats.products} 項商品`} href="#products" />
            <StatCard label="門市" value={stats.stores} hint="台南、高雄、台中、台北" />
            <StatCard
              label="全門市可售量"
              value={stats.available_units.toLocaleString('zh-TW')}
              hint={`件｜在途調貨 ${stats.transfers_in_transit ?? 0} 張`}
              href="#inventory"
            />
            <StatCard
              label="低庫存商品"
              value={stats.low_stock_products}
              hint="全門市可售 ≤ 5 件"
              tone={stats.low_stock_products > 0 ? 'warn' : ''}
              href="#products"
            />
          </div>
        )}
      </section>

      <section className="overview-section modules-section" aria-labelledby="modules-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">BUILT STEP BY STEP</p>
            <h2 id="modules-heading">系統模組</h2>
          </div>
          <span className="module-count">4 個規劃模組</span>
        </div>
        <div className="module-grid">
          {modules.map((module) => {
            const Tag = module.href ? 'a' : 'article'
            return (
              <Tag className={`module-card ${module.href ? 'module-card-link' : ''}`} key={module.number} href={module.href}>
                <div className="module-card-top">
                  <span className="module-number">{module.number}</span>
                  <span className={`module-status ${module.href ? 'ready' : ''}`}>{module.status}</span>
                </div>
                <h3>{module.title}</h3>
                <p>{module.detail}</p>
              </Tag>
            )
          })}
        </div>
      </section>
    </>
  )
}
