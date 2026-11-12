// 商品管理的「圖表」檢視：各分類有幾項商品（橫條圖）
// 跟著上方的搜尋／品牌／狀態篩選一起變；點一條長條 → 篩選該分類並切回列表
const fmt = (n) => Number(n).toLocaleString('zh-TW')

export default function CategoryChart({ products, categories, onPick }) {
  // 依分類統計上架中／已停售
  const counts = new Map(categories.map((c) => [c, { category: c, active: 0, inactive: 0 }]))
  for (const p of products) {
    if (!counts.has(p.category)) counts.set(p.category, { category: p.category, active: 0, inactive: 0 })
    counts.get(p.category)[p.is_active ? 'active' : 'inactive'] += 1
  }
  const rows = [...counts.values()]
    .map((r) => ({ ...r, total: r.active + r.inactive }))
    .sort((a, b) => b.total - a.total || a.category.localeCompare(b.category, 'zh-Hant'))
  const max = Math.max(1, ...rows.map((r) => r.total))
  const hasInactive = rows.some((r) => r.inactive > 0)
  const total = rows.reduce((s, r) => s + r.total, 0)
  const top = rows[0]

  return (
    <div className="card viz-card cat-chart">
      <header className="cat-chart-head">
        <div>
          <h2>各分類商品數</h2>
          <p>
            共 {fmt(total)} 項
            {top && top.total > 0 && <>・最多的是「{top.category}」{fmt(top.total)} 項</>}
            ・點長條可查看該分類的商品
          </p>
        </div>
        {hasInactive && (
          <div className="viz-legend" aria-label="圖例">
            <span><i className="legend-swatch active" aria-hidden="true" />上架中</span>
            <span><i className="legend-swatch inactive" aria-hidden="true" />已停售</span>
          </div>
        )}
      </header>

      <ul className="cat-bars">
        {rows.map((r) => {
          const tip = `${r.category}：${fmt(r.total)} 項（上架中 ${fmt(r.active)}・已停售 ${fmt(r.inactive)}）`
          return (
            <li key={r.category}>
              <button type="button" className="cat-bar-row" onClick={() => onPick(r.category)} aria-label={`${tip}，點一下查看`} disabled={!r.total}>
                <span className="cat-bar-label">{r.category}</span>
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
    </div>
  )
}
