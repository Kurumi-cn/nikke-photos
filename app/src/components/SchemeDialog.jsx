// 方案管理弹窗：数据录入页里打开（带「应用至当前角色」）；「更多」页用的是独立页面 SchemesPage
import { useEffect } from 'react'
import SchemeManager from './SchemeManager.jsx'
import { t } from '../lib/i18n.js'

export default function SchemeDialog({ targetName, onApply, onClose }) {
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
      <div className="dlg dlg-scheme" role="dialog" aria-label={t('方案管理')}>
        <div className="dlg-head">
          <h2>{t('方案管理')}</h2>
          <button type="button" className="dlg-x" onClick={onClose} aria-label={t('关闭')}>×</button>
        </div>

        <div className="dlg-body dlg-body-scroll">
          <p className="scheme-desc">
            {t('方案属于当前存档，是一组可复用的默认值，需要时手动「应用」到角色。')}
            {onApply
              ? t('应用会写入「{name}」的基础、研究所与技能、魔方与收藏品；装备词条不受影响。', { name: targetName })
              : t('应用操作请到「数据录入」页里进行。')}
          </p>
          <SchemeManager onApply={onApply} />
        </div>

        <div className="dlg-foot">
          <button type="button" className="btn" onClick={onClose}>{t('关闭')}</button>
        </div>
      </div>
    </div>
  )
}
