import { useEffect, useState } from 'react'
import './App.css'
import './pages.css'
import { api } from './api.js'
import { modules } from './modules.js'
import Inventory from './pages/Inventory.jsx'
import Orders from './pages/Orders.jsx'
import Overview from './pages/Overview.jsx'
import Products from './pages/Products.jsx'

const PAGES = {
  overview: { title: '營運總覽', Component: Overview },
  products: { title: '商品管理', Component: Products },
  inventory: { title: '門市庫存', Component: Inventory },
  orders: { title: '訂單管理', Component: Orders },
}

const backendLabels = {
  checking: '後端連線中…',
  ok: '後端連線正常',
  down: '後端未連線',
}

function useBackendStatus() {
  const [status, setStatus] = useState('checking')
  useEffect(() => {
    api('/health').then(() => setStatus('ok')).catch(() => setStatus('down'))
  }, [])
  return status
}

// 用網址 # 切換頁面，例如 #products
function usePage() {
  const read = () => {
    const key = window.location.hash.replace('#', '')
    return PAGES[key] ? key : 'overview'
  }
  const [page, setPage] = useState(read)
  useEffect(() => {
    const onHash = () => { setPage(read()); window.scrollTo(0, 0) }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  return page
}

function App() {
  const backend = useBackendStatus()
  const page = usePage()
  const { title, Component } = PAGES[page]

  useEffect(() => {
    document.title = `${title}｜CCC家電 AI 智慧導購與門市營運管理系統`
  }, [title])

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#overview" aria-label="CCC家電首頁">
          <span className="brand-mark" aria-hidden="true">C</span>
          <span>CCC家電<small>AI 智慧導購與門市營運管理</small></span>
        </a>

        <p className="nav-heading">工作空間</p>
        <a className={`nav-link ${page === 'overview' ? 'active' : ''}`} href="#overview" aria-current={page === 'overview' ? 'page' : undefined}>
          <span aria-hidden="true">▦</span> 營運總覽
        </a>
        <p className="nav-heading">管理模組</p>
        {modules.map((module) => {
          const key = module.href?.replace('#', '')
          return module.href ? (
            <a
              className={`nav-link ${page === key ? 'active' : ''}`}
              href={module.href}
              key={module.number}
              aria-current={page === key ? 'page' : undefined}
            >
              <span aria-hidden="true">{module.number}</span> {module.title}
            </a>
          ) : (
            <span className="nav-link nav-link-disabled" key={module.number} aria-disabled="true">
              <span aria-hidden="true">{module.number}</span> {module.title}
            </span>
          )
        })}

        <div className="sidebar-note">
          <span className="status-dot" />
          <span>作品集模擬系統<small>不連接企業內部資料</small></span>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <span>{title}</span>
          <span className="topbar-pills">
            <span className={`demo-label backend-${backend}`} role="status">
              <span className="status-dot" /> {backendLabels[backend]}
            </span>
            <span className="demo-label"><span className="status-dot" /> 示範環境</span>
          </span>
        </header>

        <Component />

        <footer className="page-footer">CCC家電 AI 智慧導購與門市營運管理系統 · 個人作品集模擬系統</footer>
      </main>
    </div>
  )
}

export default App
