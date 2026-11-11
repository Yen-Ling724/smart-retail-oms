// 訂單狀態、取貨方式的中文與顏色
export const ORDER_STATUS = {
  pending: { label: '待確認', tone: 'warn' },
  reserved: { label: '已預留', tone: 'info' },
  shipped: { label: '已出貨', tone: 'ok' },
  completed: { label: '已完成', tone: 'muted' },
  cancelled: { label: '已取消', tone: 'muted' },
}

export const FULFILLMENT = {
  pickup: '門市取貨',
  delivery: '宅配',
}

// 訂單列表上方的狀態分頁
export const ORDER_TABS = [
  { key: 'open', label: '進行中' },
  { key: 'pending', label: '待確認' },
  { key: 'reserved', label: '已預留' },
  { key: 'shipped', label: '已出貨' },
  { key: 'completed', label: '已完成' },
  { key: 'cancelled', label: '已取消' },
  { key: '', label: '全部' },
]
