import { useEffect } from 'react'
import { CARD_HEIGHT, CARD_WIDTH } from '../lib/cardLayout.js'
import { t } from '../lib/i18n.js'

const RATIOS = [1, 2, 3]

export default function ExportDialog({
  open,
  onClose,
  ratio,
  onRatioChange,
  transparent,
  onTransparentChange,
  signature,
  onSignatureChange,
  fileName,
  onFileNameChange,
  exporting,
  error,
  onExport,
}) {
  useEffect(() => {
    if (!open) return undefined
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="dlg-mask"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="dlg" role="dialog" aria-label={t('导出设置')}>
        <div className="dlg-head">
          <h2>{t('导出图片')}</h2>
          <button type="button" className="dlg-x" onClick={onClose} aria-label={t('关闭')}>×</button>
        </div>

        <div className="dlg-body">
          <div className="dlg-row">
            <span className="dlg-label">{t('倍率')}</span>
            <div className="zoom">
              {RATIOS.map((item) => (
                <button
                  key={item}
                  type="button"
                  className={item === ratio ? 'active' : ''}
                  onClick={() => onRatioChange(item)}
                >
                  {item}x
                </button>
              ))}
            </div>
            <span className="dlg-hint">{t('输出 {width} × {height} px PNG', { width: CARD_WIDTH * ratio, height: CARD_HEIGHT * ratio })}</span>
          </div>

          <div className="dlg-row">
            <span className="dlg-label">{t('背景')}</span>
            <div className="zoom">
              <button type="button" className={transparent ? '' : 'active'} onClick={() => onTransparentChange(false)}>
                {t('卡片底色')}
              </button>
              <button type="button" className={transparent ? 'active' : ''} onClick={() => onTransparentChange(true)}>
                {t('透明')}
              </button>
            </div>
          </div>

          <div className="dlg-row">
            <span className="dlg-label">{t('署名')}</span>
            <button
              type="button"
              className={signature.enabled ? 'switch on' : 'switch'}
              aria-pressed={signature.enabled}
              onClick={() => onSignatureChange({ ...signature, enabled: !signature.enabled })}
            >
              <span className="track" />
              {signature.enabled ? t('已开启') : t('关闭')}
            </button>
          </div>

          {signature.enabled ? (
            <div className="dlg-row">
              <span className="dlg-label">{t('署名文字')}</span>
              <input
                className="dlg-input"
                value={signature.text}
                maxLength={40}
                placeholder={t('例如：@你的昵称')}
                onChange={(event) => onSignatureChange({ ...signature, text: event.target.value })}
              />
            </div>
          ) : null}

          <div className="dlg-row">
            <span className="dlg-label">{t('文件名')}</span>
            <input
              className="dlg-input"
              value={fileName}
              onChange={(event) => onFileNameChange(event.target.value)}
            />
          </div>

          {error ? <p className="dlg-error">{error}</p> : null}
        </div>

        <div className="dlg-foot">
          <button type="button" className="btn" onClick={onClose}>{t('取消')}</button>
          <button type="button" className="btn btn-primary" onClick={onExport} disabled={exporting}>
            {exporting ? t('导出中…') : t('导出 PNG')}
          </button>
        </div>
      </div>
    </div>
  )
}