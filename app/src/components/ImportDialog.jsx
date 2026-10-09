import { useState } from 'react'
import { t } from '../lib/i18n.js'

/**
 * 导入档案弹窗：读入 .json 后，让用户选择「覆盖某个存档」或「新建存档并导入」。
 * 由父组件用 key 控制挂载，打开时即为最新初值。
 */
export default function ImportDialog({ parsed, profiles, currentId, error, onClose, onOverwrite, onNew }) {
  const [targetId, setTargetId] = useState(currentId)
  const target = profiles.find((item) => item.id === targetId)

  return (
    <div
      className="dlg-mask"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="dlg dlg-wide" role="dialog" aria-label={t('导入档案')}>
        <div className="dlg-head">
          <h2>{t('导入档案')}</h2>
          <button type="button" className="dlg-x" onClick={onClose} aria-label={t('关闭')}>×</button>
        </div>

        <div className="dlg-body">
          <p className="dlg-text">
            {t('读入')} <strong>{parsed.count}</strong> {t('个角色记录')}
            {parsed.unknown.length ? t('（{count} 个未识别，将被跳过）', { count: parsed.unknown.length }) : ''}。
          </p>

          {Array.isArray(parsed.notices) && parsed.notices.length ? (
            <ul className="import-notes">
              {parsed.notices.map((item) => <li key={item}>{item}</li>)}
            </ul>
          ) : null}

          <div className="import-block">
            <h3>{t('覆盖某个存档')}</h3>
            <div className="dlg-row">
              <span className="dlg-label">{t('目标存档')}</span>
              <select className="dlg-input" value={targetId} onChange={(event) => setTargetId(event.target.value)}>
                {profiles.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}{item.id === currentId ? t('（当前）') : ''}
                  </option>
                ))}
              </select>
            </div>
            <p className="import-hint">
              {t('保留目标存档的名称与备注，替换其角色数据；')}
              {parsed.synchroLevel == null ? t('本文件不含同步器等级，保留目标存档的原值。') : t('同步器等级取导入文件里的值。')}
            </p>
            <button type="button" className="btn" onClick={() => onOverwrite(targetId)}>
              {t('覆盖「{name}」', { name: target?.name || '' })}
            </button>
          </div>

          <div className="import-block">
            <h3>{t('新建存档并导入')}</h3>
            <p className="import-hint">
              {parsed.origin === 'workshop'
                ? t('存档名会自动编号为「workshop导入N」，可在下一步确认；同步器等级与研究等级也需要填写。')
                : parsed.synchroLevel == null
                  ? t('可在下一步填写名称、同步器等级与研究等级。')
                  : t('按导入文件里的名称与同步器等级预填，可在下一步修改。')}
            </p>
            <button type="button" className="btn btn-primary" onClick={onNew}>{t('新建存档并导入')}</button>
          </div>

          {error ? <p className="dlg-error">{error}</p> : null}
        </div>

        <div className="dlg-foot">
          <button type="button" className="btn" onClick={onClose}>{t('取消')}</button>
        </div>
      </div>
    </div>
  )
}
