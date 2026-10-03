// 「版本更新」提示：进页面时若用户上次读到的版本号与当前版本不一致就弹一次。
// 勾了「不再提醒」才记录已读版本号（见 lib/updateNotice.js），没勾下次还会弹。
import { useEffect, useState } from 'react'
import { BASELINE_VERSION, CHANGELOG, CURRENT_VERSION, displayDate } from '../data/changelog.js'
import { markVersionSeen, readSeenVersion } from '../lib/updateNotice.js'
import '../styles/changelog.css'

export default function UpdateNoticeDialog({ onClose }) {
  const [mute, setMute] = useState(false)
  const entry = CHANGELOG[0]
  // 上一个版本：用户上次读到的版本；从没读过就是加版本号之前的状态
  const fromVersion = readSeenVersion() || BASELINE_VERSION

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const close = () => {
    if (mute) markVersionSeen(CURRENT_VERSION)
    onClose()
  }

  return (
    <div
      className="dlg-mask"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close()
      }}
    >
      <div className="dlg" role="dialog" aria-label="版本更新">
        <div className="dlg-head">
          <h2>版本更新</h2>
          <button type="button" className="dlg-x" onClick={close} aria-label="关闭">×</button>
        </div>

        <div className="dlg-body">
          <p className="cl-range">v{fromVersion} → v{CURRENT_VERSION}</p>
          <ol className="cl-items">
            {entry.items.map((item, index) => (
              <li key={item}>{index + 1}、{item}</li>
            ))}
          </ol>
          <div className="cl-date">{displayDate(entry.date)}</div>

          <label className="cl-mute">
            <input
              type="checkbox"
              checked={mute}
              onChange={(event) => setMute(event.target.checked)}
            />
            <span>不再提醒（有新版本时仍会提示）</span>
          </label>
        </div>

        <div className="dlg-foot">
          <button type="button" className="btn btn-primary" onClick={close}>知道了</button>
        </div>
      </div>
    </div>
  )
}
