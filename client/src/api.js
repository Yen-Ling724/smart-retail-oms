// 上線時前後端在不同網址，用 VITE_API_BASE 指定後端位置；開發時留空走 Vite proxy
const API_BASE = import.meta.env.VITE_API_BASE || ''

export async function api(path, { body, ...options } = {}) {
  const res = await fetch(`${API_BASE}/api${path}`, {
    ...options,
    headers: body ? { 'content-type': 'application/json', ...options.headers } : options.headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({ ok: false, error: '伺服器回應格式不正確' }))
  if (!res.ok || !data.ok) throw new Error(data.error || `請求失敗（${res.status}）`)
  return data
}

export const formatPrice = (n) => (n == null ? '—' : `NT$ ${Number(n).toLocaleString('zh-TW')}`)

export const formatDate = (s) => (s ? new Date(s).toLocaleDateString('zh-TW') : '')

export const LOW_STOCK = 5

export function stockLevel(available) {
  if (available <= 0) return { label: '缺貨', tone: 'danger' }
  if (available <= LOW_STOCK) return { label: '低庫存', tone: 'warn' }
  return null
}
