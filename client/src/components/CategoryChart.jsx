// 商品管理的「圖表」檢視（橫條圖）
// 沒選分類 → 各分類有幾項商品；選了分類 → 該分類裡各品牌有幾項商品（往下鑽）
// 跟著上方的搜尋／品牌／狀態篩選一起變；點一條長條 → 篩選它並切回列表
const fmt = (n) => Number(n).toLocaleString('zh-TW')

export default function CategoryChart({ products, categories, category, brands, onPickCategory, onPickBrand, onBack }) {
  const byBrand = Boolean(category)
  const groupOf = (p) => (byBrand ? p.brand : p.category)

  // 統計上架中／已停售
  const counts = new Map()
  const ensure = (k) => { if (!counts.has(k)) counts.set(k, { key: k, active: 0, inactive: 0 }); return counts.get(k) }
  if (!byBrand) categories.forEach(ensure) // 分類固定只有幾個，0 項也畫出來
  for (const p of products) ensure(groupOf(p))[p.is_active ? 'active' : 'inactive'] += 1

  const rows = [...counts.values()]
    .map((r) => ({ ...r, total: r.active + r.inactive }))
    .sort((a, b) => b.total - a.total || a.key.localeCompare(b.key, 'zh-Hant'))
  const max = Math.max(1, ...rows.map((r) => r.total))
  const hasInactive = rows.some((r) => r.inactive > 0)
  const total = rows.reduce((s, r) => s + r.total, 0)
  const top = rows[0]
  // 品牌清單裡有、但目前沒有商品的品牌：不畫空長條，用一行字列出
  const emptyBrands = byBrand ? (brands ?? []).filter((b) => !counts.has(b)) : []
  const pick = byBrand ? onPickBrand : onPickCategory
  const unit = byBrand ? '品牌' : '分類'

  return (
    <div className="card viz-card cat-chart">
      <header className="cat-chart-head">
        <div>
          {byBrand && <button type="button" className="link-btn" onClick={onBack}>← 回到全部分類</button>}
          <h2>{byBrand ? `${category}・各品牌商品數` : '各分類商品數'}</h2>
          <p>
            共 {fmt(total)} 項
            {byBrand && `・${rows.length} 個品牌`}
            {top && top.total > 0 && top.total > (rows[1]?.total ?? 0) && <>・最多的是「{top.key}」{fmt(top.total)} 項</>}
            {rows.length > 1 && top?.total > 0 && top.total === rows[rows.length - 1].total && `・每個${unit}都是 ${fmt(top.total)} 項`}
            ・點長條可查看該{unit}的商品
          </p>
        </div>
        {hasInactive && (
          <div className="viz-legend" aria-label="圖例">
            <span><i className="legend-swatch active" aria-hidden="true" />上架中</span>
            <span><i className="legend-swatch inactive" aria-hidden="true" />已停售</span>
          </div>
        )}
      </header>

      <ul className={`cat-bars ${byBrand ? 'by-brand' : ''}`}>
        {rows.map((r) => {
          const tip = `${r.key}：${fmt(r.total)} 項（上架中 ${fmt(r.active)}・已停售 ${fmt(r.inactive)}）`
          return (
            <li key={r.key}>
              <button type="button" className="cat-bar-row" onClick={() => pick(r.key)} aria-label={`${tip}，點一下查看`} disabled={!r.total}>
                <span className="cat-bar-label">{r.key}</span>
                <span className="cat-bar-track" aria-hidden="true">
                  <span className="cat-bar-fill" style={{ width: `${(r.total / max) * 100}%` }}>
                    {r.active > 0 && <span className="seg-active" style={{ flexGrow: r.active }} />}
                    {r.inactive > 0 && <span className="seg-inactive" style={{ flexGrow: r.inactive }} />}
                  </span>
                  <span className="cat-tip" role="presentation">{tip}</span>
                </span>
                <span className="cat-bar-value">
                  {fmt(r.total)}
                  {r.inactive > 0 && <small>停售 {fmt(r.inactive)}</small>}
                </span>
              </button>
            </li>
          )
        })}
        {!rows.length && <li className="empty">沒有符合條件的商品</li>}
      </ul>

      {emptyBrands.length > 0 && (
        <p className="cat-empty-note">目前沒有商品的品牌：{emptyBrands.join('、')}</p>
      )}
    </div>
  )
}
