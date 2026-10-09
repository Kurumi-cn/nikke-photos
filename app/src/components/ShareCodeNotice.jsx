import { useEffect, useState } from 'react'
import { SHARE_DEFAULTS } from '../lib/shareCode.js'
import { t, tData } from '../lib/i18n.js'

/** 首次进入导出页的提示：没勾选的字段，BOT 端会按这份默认值展示 */
export default function ShareCodeNotice({ onClose }) {
  const [dontShow, setDontShow] = useState(false)

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div
      className="dlg-mask"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose(false)
      }}
    >
      <div className="dlg dlg-wide" role="dialog" aria-label={t('未导出字段的默认值')}>
        <div className="dlg-head">
          <h2>{t('没勾选的字段会按默认值填写')}</h2>
          <button type="button" className="dlg-x" onClick={() => onClose(false)} aria-label={t('关闭')}>×</button>
        </div>

        <div className="dlg-body dlg-body-scroll">
          <p className="share-sub">
            {t('只有勾选的字段会写进分享码。没勾的字段，BOT 会按下面这份默认值展示——所以勾得越少码越短，')}
            {t('但 BOT 看到的那几项并不是你的真实数据。')}
          </p>
          <ul className="default-list">
            {SHARE_DEFAULTS.map(([label, value]) => (
              <li key={label}>
                <span>{t(label)}</span>
                <b>{tData(value)}</b>
              </li>
            ))}
          </ul>
          <label className="notice-check">
            <input
              type="checkbox"
              checked={dontShow}
              onChange={(event) => setDontShow(event.target.checked)}
            />
            <span>{t('不再提醒')}</span>
          </label>
        </div>

        <div className="dlg-foot">
          <button type="button" className="btn btn-primary" onClick={() => onClose(dontShow)}>{t('知道了')}</button>
        </div>
      </div>
    </div>
  )
}
