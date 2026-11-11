import { useEffect, useRef, useState } from 'react'
import { api, formatPrice } from '../api.js'

const EXAMPLES = [
  '預算 2 萬，小家庭適合哪台冰箱？',
  '6 坪房間的冷氣，要省電',
  '租屋族除濕機，一萬以內',
  '客廳想換 55 吋電視',
  '兩萬五左右的滾筒洗衣機，要能烘乾',
  '有沒有便宜的氣炸鍋',
]

function StockLine({ product, storeName }) {
  if (product.available_here != null) {
    if (product.available_here > 0) return <span className="badge ok">{storeName}現貨 {product.available_here} 台</span>
    const other = product.stores[0]
    return (
      <span className="badge warn">
        {storeName}缺貨{other ? `・${other.name}有 ${other.available} 台，可調貨` : ''}
      </span>
    )
  }
  return (
    <span className="badge info">
      全台可售 {product.available_total} 台{product.stores[0] ? `・最多：${product.stores[0].name}` : ''}
    </span>
  )
}

function ProductCard({ product, rank, storeName }) {
  return (
    <article className="rec-card">
      <div className="rec-head">
        <span className="rec-rank">{rank}</span>
        <div>
          <h4>{product.name}</h4>
          <small>{product.product_id} · {product.brand} · {product.model}</small>
        </div>
        <span className="price-cell rec-price">
          <strong>{formatPrice(product.price)}</strong>
          {product.list_price > product.price && <s>{formatPrice(product.list_price)}</s>}
        </span>
      </div>
      <StockLine product={product} storeName={storeName} />
      {product.reasons.length > 0 && (
        <ul className="rec-reasons">
          {product.reasons.map((r) => <li key={r}>{r}</li>)}
        </ul>
      )}
      {product.misses?.length > 0 && (
        <ul className="rec-misses">
          {product.misses.map((r) => <li key={r}>{r}</li>)}
        </ul>
      )}
    </article>
  )
}

function AssistantMessage({ msg, storeName }) {
  if (msg.error) return <div className="bubble bot error">{msg.error}</div>
  return (
    <div className="bubble bot">
      {msg.understood?.length > 0 && (
        <div className="understood">
          <span>我理解的需求：</span>
          {msg.understood.map((u) => <span key={u} className="badge">{u}</span>)}
        </div>
      )}
      <p>{msg.answer}</p>
      {msg.products?.length > 0 && (
        <div className="rec-list">
          {msg.products.map((p, i) => <ProductCard key={p.product_id} product={p} rank={i + 1} storeName={storeName} />)}
        </div>
      )}
      {msg.products?.length > 0 && <p className="hint">以上推薦只根據系統內的商品、價格與庫存資料，不會推薦沒有庫存的商品。</p>}
    </div>
  )
}

export default function Assistant() {
  const [stores, setStores] = useState([])
  const [regions, setRegions] = useState([])
  const [storeId, setStoreId] = useState('')
  const [status, setStatus] = useState(null)
  const [messages, setMessages] = useState([]) // { role: 'user'|'bot', ... }
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [context, setContext] = useState(null) // 上一輪抓到的需求，讓追問可以沿用
  const endRef = useRef(null)

  useEffect(() => {
    api('/stores').then((d) => { setStores(d.stores); setRegions(d.regions ?? []) }).catch(() => {})
    api('/assistant/status').then(setStatus).catch(() => {})
  }, [])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, busy])

  const storeName = stores.find((s) => s.store_id === storeId)?.name ?? ''

  async function ask(question) {
    const q = question.trim()
    if (!q || busy) return
    setInput('')
    setMessages((m) => [...m, { role: 'user', text: q }])
    setBusy(true)
    try {
      const d = await api('/assistant/ask', { method: 'POST', body: { question: q, store_id: storeId || undefined, context } })
      setMessages((m) => [...m, { role: 'bot', ...d, storeName }])
      if (d.need?.category || d.need?.budget) setContext(d.need)
    } catch (err) {
      setMessages((m) => [...m, { role: 'bot', error: `查詢失敗：${err.message}` }])
    } finally {
      setBusy(false)
    }
  }

  function restart() {
    setMessages([])
    setContext(null)
  }

  return (
    <section className="page" aria-labelledby="assistant-heading">
      <div className="page-head">
        <div>
          <p className="eyebrow">MODULE 04</p>
          <h1 id="assistant-heading">智慧導購</h1>
          <p className="muted">用一句話描述需求，系統從實際有庫存的商品中推薦，並說明推薦理由與不符合的地方。</p>
        </div>
        <span className={`badge ${status?.mode === 'ai' ? 'ok' : 'warn'} mode-badge`} title="之後設定 Claude API 金鑰即可啟用 AI 對話模式">
          {status?.mode === 'ai' ? 'AI 模式' : '關鍵字模式（AI 尚未啟用）'}
        </span>
      </div>

      <div className="assistant">
        <div className="assistant-bar">
          <label>顧客所在門市
            <select value={storeId} onChange={(e) => setStoreId(e.target.value)}>
              <option value="">不指定（看全台庫存）</option>
              {regions.map((r) => (
                <optgroup key={r} label={r}>
                  {stores.filter((s) => s.region === r).map((s) => <option key={s.store_id} value={s.store_id}>{s.name}</option>)}
                </optgroup>
              ))}
            </select>
          </label>
          {messages.length > 0 && <button type="button" className="btn ghost small" onClick={restart}>重新開始</button>}
        </div>

        <div className="chat" aria-live="polite">
          {messages.length === 0 && (
            <div className="bubble bot welcome-bubble">
              <p>你好！告訴我想找什麼家電，最好加上<b>預算</b>、<b>坪數</b>或<b>家裡幾個人</b>，我會從有庫存的商品裡挑最適合的。</p>
              <div className="chips">
                {EXAMPLES.map((e) => <button key={e} type="button" className="chip" onClick={() => ask(e)}>{e}</button>)}
              </div>
            </div>
          )}
          {messages.map((m, i) =>
            m.role === 'user'
              ? <div key={i} className="bubble user">{m.text}</div>
              : <AssistantMessage key={i} msg={m} storeName={m.storeName} />,
          )}
          {busy && <div className="bubble bot typing">查詢中…</div>}
          <div ref={endRef} />
        </div>

        {messages.length > 0 && (
          <div className="chips follow-chips">
            {['預算多 5 千呢？', '便宜一點的', '要省電的'].map((e) => (
              <button key={e} type="button" className="chip" onClick={() => ask(e)} disabled={busy}>{e}</button>
            ))}
          </div>
        )}

        <form className="chat-input" onSubmit={(e) => { e.preventDefault(); ask(input) }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="例如：預算 3 萬，4 個人用的冰箱"
            maxLength={300}
            aria-label="輸入需求"
          />
          <button type="submit" className="btn" disabled={busy || !input.trim()}>送出</button>
        </form>
      </div>
    </section>
  )
}
