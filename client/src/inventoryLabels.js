// 庫存動作與異動類型的中文名稱（後端也會檢查，這裡只負責顯示）
export const ADJUST_ACTIONS = [
  { value: 'receive', label: '進貨入庫', hint: '實體庫存增加，可售跟著增加', qtyLabel: '進貨數量' },
  { value: 'display_add', label: '上展示機', hint: '從可售中撥出當展示機', qtyLabel: '數量' },
  { value: 'display_remove', label: '撤展示機', hint: '展示機收回，變回可售', qtyLabel: '數量' },
  { value: 'damage', label: '標記瑕疵', hint: '從可售中標記為瑕疵品', qtyLabel: '數量' },
  { value: 'scrap', label: '瑕疵報廢', hint: '瑕疵品報廢，實體庫存減少', qtyLabel: '數量' },
  { value: 'count', label: '盤點調整', hint: '直接輸入盤點後的實體數量', qtyLabel: '盤點後實體數量' },
]

export const MOVEMENT_LABELS = {
  ...Object.fromEntries(ADJUST_ACTIONS.map((a) => [a.value, a.label])),
  transfer_out: '調出',
  transfer_in: '調入到貨',
  transfer_cancel: '調貨取消退回',
  order_reserve: '訂單預留',
  order_release: '訂單取消釋放',
  order_ship: '訂單出貨',
}

export const TRANSFER_STATUS = {
  in_transit: { label: '在途', tone: 'info' },
  received: { label: '已到貨', tone: 'ok' },
  cancelled: { label: '已取消', tone: 'muted' },
}

export const formatDateTime = (s) =>
  s ? new Date(s).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : ''
