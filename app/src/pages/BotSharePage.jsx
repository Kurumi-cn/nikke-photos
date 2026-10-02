// BOT 分享页：把练度数据交给 QQ 机器人（角色数据 / 表格设置 / 面板格式）
//
// 三个分区：
//   1. 角色数据 —— 选角色导分享码，BOT 那边 /妮姬导入
//   2. 表格设置 —— 只导「谁 + 什么顺序」，练度数据由 BOT 从自己的存档里取
//   3. 面板格式 —— 占位，还没定
import { useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import CharacterSharePanel from '../components/CharacterSharePanel.jsx'
import { findCharacter } from '../lib/roster.js'
import { encodeTableShareCode } from '../lib/shareCode.js'
import { defaultTableCodes, loadStatsSelection } from '../lib/statsSelection.js'
import '../styles/botShare.css'

export default function BotSharePage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [copyHint, setCopyHint] = useState('')
  const hintTimer = useRef(0)
  const codeRef = useRef(null)

  // 名单来源：优先用词条统计页里排好的顺序，没选过就退回「全部已完善 + 按属性排列」
  const { codes, fromStats, rows } = useMemo(() => {
    const saved = loadStatsSelection().filter((code) => findCharacter(code))
    const list = saved.length > 0 ? saved : defaultTableCodes()
    return { codes: list, fromStats: saved.length > 0, rows: list.length }
  }, [])

  const { code, codeError } = useMemo(() => {
    if (codes.length === 0) return { code: '', codeError: '' }
    try {
      return { code: encodeTableShareCode({ nameCodes: codes }), codeError: '' }
    } catch (error) {
      return { code: '', codeError: String(error?.message || error) }
    }
  }, [codes])

  const goBack = () => {
    if (location.key !== 'default') navigate(-1)
    else navigate('/my')
  }

  const flash = (text) => {
    setCopyHint(text)
    window.clearTimeout(hintTimer.current)
    hintTimer.current = window.setTimeout(() => setCopyHint(''), 1800)
  }

  const handleCopy = () => {
    const node = codeRef.current
    if (node) {
      node.focus()
      node.select()
    }
    flash('已选中，请按 Ctrl+C 复制')
    try {
      const pending = navigator.clipboard?.writeText(code)
      if (pending && typeof pending.then === 'function') pending.then(() => flash('已复制')).catch(() => {})
    } catch {
      // 剪贴板不可用：保留「已选中」提示
    }
  }

  return (
    <main className="page">
      <button type="button" className="back" onClick={goBack}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M12.5 8h-9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <path d="M7 4 3 8l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        返回
      </button>

      <div className="page-head">
        <div>
          <h1>BOT 分享</h1>
          <div className="desc">
            把练度数据交给 QQ 机器人，之后在聊天里直接出角色面板图和练度统计表
          </div>
        </div>
      </div>

      <CharacterSharePanel />

      <section className="bs-section" aria-label="表格设置">
        <header className="bs-head">
          <div>
            <h2>表格设置</h2>
            <div className="desc">
              表格码只带「有哪些角色、按什么顺序」，练度数据由 BOT 从你自己的存档里取
            </div>
          </div>
          {rows > 0 ? <div className="count">共 <strong>{rows}</strong> 行</div> : null}
        </header>

        <p className="bs-note">
          {rows === 0
            ? '当前存档还没有四件装备都录完的角色，先到「数据录入」把装备补齐。'
            : fromStats
              ? '名单用的是词条统计页里排好的顺序，想改顺序就到那边拖拽调整。'
              : '还没在词条统计页选过角色，这里默认用「全部已完善角色，按属性排列」。'}
        </p>

        <div className="share-output">
          <textarea
            ref={codeRef}
            className="share-code"
            readOnly
            rows={3}
            value={code}
            placeholder={rows === 0 ? '没有可导出的角色' : '表格码会出现在这里'}
            onFocus={(event) => event.target.select()}
          />
          <div className="share-meta">
            {codeError
              ? <span className="dlg-error">{codeError}</span>
              : <span>{rows} 行 · {code ? `${code.length} 字符` : '—'}</span>}
            <span className="bs-actions">
              <button type="button" className="btn btn-sm" onClick={() => navigate('/stats')}>
                去词条统计页调整
              </button>
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={handleCopy}
                disabled={!code}
              >
                {copyHint || '复制表格码'}
              </button>
            </span>
          </div>
        </div>

        <p className="bs-hint">
          在 QQ 里发 <code>/妮姬导入 &lt;表格码&gt;</code>，之后 <code>/妮姬练度统计</code> 就按这份名单出表。
        </p>
      </section>

      <section className="bs-section is-placeholder" aria-label="面板格式">
        <header className="bs-head">
          <div>
            <h2>面板格式</h2>
            <div className="desc">决定 BOT 出图时长什么样</div>
          </div>
          <span className="badge-soon">暂未开放</span>
        </header>
        <p className="bs-note">
          计划做成：挑要显示哪些模块、立绘用哪张皮、要不要底色，存成一套「面板方案」再分享给 BOT。
          具体怎么配还没定，定了再放到这里。
        </p>
      </section>
    </main>
  )
}
