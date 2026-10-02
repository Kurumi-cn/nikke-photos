import { useEffect, useRef, useState } from 'react'

/** 分享码弹窗：展示 NKP2 识别码 + 一键复制 + 字符数
 *
 * 词条统计页导出「表格配置码」时复用同一个弹窗，只是换掉标题、说明和计数单位。
 */
export default function ShareCodeDialog({
  open,
  onClose,
  code = '',
  count = 0,
  loading = false,
  error = '',
  title = '分享码',
  hint = '可以将此识别码导入到 bot 中。',
  unit = '个角色',
}) {
  const [copyHint, setCopyHint] = useState('')
  const codeRef = useRef(null)
  const hintTimer = useRef(0)

  useEffect(() => {
    if (!open) return undefined
    setCopyHint('')
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  const flash = (text) => {
    setCopyHint(text)
    window.clearTimeout(hintTimer.current)
    hintTimer.current = window.setTimeout(() => setCopyHint(''), 1800)
  }

  // 先同步选中文本并立即给出反馈；剪贴板写入成功后再升级为「已复制」。
  // 部分环境（窗口无焦点等）writeText 的 Promise 既不 resolve 也不 reject，因此不能把反馈挂在它上面。
  const handleCopy = () => {
    const node = codeRef.current
    if (node) {
      node.focus()
      node.select()
    }
    flash('已选中，请按 Ctrl+C 复制')
    try {
      const pending = navigator.clipboard?.writeText(code)
      if (pending && typeof pending.then === 'function') {
        pending.then(() => flash('已复制')).catch(() => {})
      }
    } catch {
      // 剪贴板不可用：保留「已选中」提示
    }
  }

  return (
    <div
      className="dlg-mask"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="dlg dlg-wide" role="dialog" aria-label={title}>
        <div className="dlg-head">
          <h2>{title}</h2>
          <button type="button" className="dlg-x" onClick={onClose} aria-label="关闭">×</button>
        </div>

        <div className="dlg-body">
          <p className="share-sub">{hint}</p>
          {error ? <p className="dlg-error">{error}</p> : null}
          <textarea
            ref={codeRef}
            className="share-code"
            readOnly
            rows={6}
            value={loading ? '生成中…' : code}
            onFocus={(event) => event.target.select()}
          />
          <div className="share-meta">
            <span>{count} {unit} · {code ? `${code.length} 字符` : '—'}</span>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={handleCopy}
              disabled={loading || !code}
            >
              {copyHint || '复制分享码'}
            </button>
          </div>
        </div>

        <div className="dlg-foot">
          <button type="button" className="btn" onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  )
}
