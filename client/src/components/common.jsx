import { useEscape } from '../hooks.js'

// 置中的對話框
export function Modal({ title, onClose, children, wide = false }) {
  useEscape(onClose)
  return (
    <div className="overlay center" onClick={onClose}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="關閉">×</button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Toast({ message }) {
  return message ? <div className="toast" role="status">{message}</div> : null
}
