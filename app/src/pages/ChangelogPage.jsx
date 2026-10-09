// 更新记录：历史所有版本一览（「更多」里的入口）
import { useLocation, useNavigate } from 'react-router-dom'
import { CHANGELOG, CURRENT_VERSION, displayDate } from '../data/changelog.js'
import { t } from '../lib/i18n.js'
import '../styles/changelog.css'

export default function ChangelogPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const goBack = () => {
    if (location.key !== 'default') navigate(-1)
    else navigate('/my')
  }

  return (
    <main className="page">
      <button type="button" className="back" onClick={goBack}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M12.5 8h-9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <path d="M7 4 3 8l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {t('返回')}
      </button>

      <div className="page-head">
        <div>
          <h1>{t('更新记录')}</h1>
          <div className="desc">{t('当前版本 v{version}', { version: CURRENT_VERSION })}</div>
        </div>
      </div>

      <div className="cl-list">
        {CHANGELOG.map((entry) => (
          <section className="cl-entry" key={entry.version}>
            <div className="cl-head">
              <b>v{entry.version}</b>
              {entry.version === CURRENT_VERSION ? <span className="cl-badge">{t('当前版本')}</span> : null}
            </div>
            <ol className="cl-items">
              {entry.items.map((item, index) => (
                <li key={item}>{index + 1}、{item}</li>
              ))}
            </ol>
            <div className="cl-date">{displayDate(entry.date)}</div>
          </section>
        ))}
      </div>
    </main>
  )
}
