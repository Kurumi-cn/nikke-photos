import { useEffect } from 'react'

/** 通用二次确认弹窗；message 可以是字符串或任意节点（用于多行说明） */
export default function ConfirmDialog({
  title,
  message,
  confirmText = '确定',
  cancelText = '取消',
  danger = false,
  onConfirm,
  onClose,
}) {
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div
      className="dlg-mask"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="dlg" role="dialog" aria-label={title}>
        <div className="dlg-head">
          <h2>{title}</h2>
          <button type="button" className="dlg-x" onClick={onClose} aria-label="关闭">×</button>
        </div>

        <div className="dlg-body">
          {typeof message === 'string' ? <p className="dlg-text">{message}</p> : message}
        </div>

        <div className="dlg-foot">
          <button type="button" className="btn" onClick={onClose}>{cancelText}</button>
          <button
            type="button"
            className={danger ? 'btn btn-danger' : 'btn btn-primary'}
            onClick={onConfirm}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}
