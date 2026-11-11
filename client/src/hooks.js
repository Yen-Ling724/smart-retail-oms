import { useEffect, useState } from 'react'

// 按 Esc 關閉對話框／側欄
export function useEscape(onClose) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
}

// 底部提示訊息，2.5 秒後自動消失。搭配 <Toast message={toast} />
export function useToast() {
  const [toast, setToast] = useState('')
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(''), 2500)
    return () => clearTimeout(t)
  }, [toast])
  return [toast, setToast]
}
