import './App.css'

const modules = [
  { number: '01', title: '商品管理', detail: '集中整理商品型號、規格與替代關係。', status: '規劃中' },
  { number: '02', title: '門市庫存', detail: '查看可售、預留、展示與在途數量。', status: '規劃中' },
  { number: '03', title: '訂單管理', detail: '建立多商品訂單並模擬庫存預留。', status: '規劃中' },
  { number: '04', title: '智慧導購', detail: '依預算、需求與實際庫存推薦商品。', status: '規劃中' },
]

function App() {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#overview" aria-label="零售智選首頁">
          <span className="brand-mark" aria-hidden="true">選</span>
          <span>零售智選<small>SMART RETAIL</small></span>
        </a>

        <p className="nav-heading">工作空間</p>
        <a className="nav-link active" href="#overview" aria-current="page">
          <span aria-hidden="true">▦</span> 營運總覽
        </a>
        <p className="nav-heading">管理模組</p>
        {modules.map((module) => (
          <span className="nav-link nav-link-disabled" key={module.number} aria-disabled="true">
            <span aria-hidden="true">{module.number}</span> {module.title}
          </span>
        ))}

        <div className="sidebar-note">
          <span className="status-dot" />
          <span>作品集模擬系統<small>不連接企業內部資料</small></span>
        </div>
      </aside>

      <main id="overview" className="main-content">
        <header className="topbar">
          <span>營運總覽</span>
          <span className="demo-label"><span className="status-dot" /> 示範環境</span>
        </header>

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
          <p><strong>個人作品集模擬專案</strong><br />使用虛構商品、門市、價格與庫存資料，不代表全國電子官方產品，也不連接任何企業內部系統。</p>
        </section>

        <section className="overview-section" aria-labelledby="snapshot-heading">
          <div className="section-heading">
            <div>
              <p className="eyebrow">YOUR WORKSPACE</p>
              <h2 id="snapshot-heading">營運快照</h2>
            </div>
            <span className="empty-status">資料準備中</span>
          </div>
          <div className="snapshot-card">
            <div className="snapshot-symbol" aria-hidden="true">▤</div>
            <div>
              <h3>儀表板尚未載入資料</h3>
              <p>接下來會先建立虛構商品資料，再逐步加入庫存與訂單。這裡只會顯示系統實際取得的資料。</p>
            </div>
          </div>
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
            {modules.map((module) => (
              <article className="module-card" key={module.number}>
                <div className="module-card-top">
                  <span className="module-number">{module.number}</span>
                  <span className="module-status">{module.status}</span>
                </div>
                <h3>{module.title}</h3>
                <p>{module.detail}</p>
              </article>
            ))}
          </div>
        </section>

        <footer className="page-footer">零售智選 · 個人作品集模擬系統</footer>
      </main>
    </div>
  )
}

export default App
