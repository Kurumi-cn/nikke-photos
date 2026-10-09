// 角色数据分享码面板：勾选已完善角色 + 勾选导出字段 → 实时生成 NKP2 分享码
//
// 原来是一个独立页面（/share-code）。现在作为「BOT 分享」页的第一块内容，
// 所以剥掉了 <main className="page"> 和返回按钮，只留面板本身。
import { useEffect, useMemo, useRef, useState } from 'react'
import FilterBar from './FilterBar.jsx'
import ShareCodeNotice from './ShareCodeNotice.jsx'
import { t } from '../lib/i18n.js'
import { CHARACTERS, applyFilters, assetUrl, countActiveFilters, displayName, findCharacter, iconFor } from '../lib/roster.js'
import {
  fullyRecordedCodes,
  getCurrentProfile,
  getCurrentProfileId,
  loadRecord,
  subscribeProfiles,
} from '../lib/profileStore.js'
import {
  SHARE_FIELDS,
  SHARE_MAX_COUNT,
  dismissShareNotice,
  encodeShareCode,
  isShareNoticeDismissed,
  loadShareFields,
  saveShareFields,
} from '../lib/shareCode.js'

const DEFAULT_TOGGLES = { cnPublished: false, collectible: false, overSpec: false }
const NO_SELECTION = {}

export default function CharacterSharePanel() {
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(NO_SELECTION)
  const [toggles, setToggles] = useState(DEFAULT_TOGGLES)
  const [picked, setPicked] = useState([])
  const [limitHit, setLimitHit] = useState(false)
  const [fields, setFields] = useState(() => loadShareFields())
  const [noticeOpen, setNoticeOpen] = useState(() => !isShareNoticeDismissed())
  const [copyHint, setCopyHint] = useState('')
  const limitTimer = useRef(0)
  const codeRef = useRef(null)
  const hintTimer = useRef(0)

  const [profile, setProfile] = useState(() => getCurrentProfile())
  const [fullyCodes, setFullyCodes] = useState(() => fullyRecordedCodes(getCurrentProfileId()))

  // 切换存档后刷新（已完善名单随存档变化）
  useEffect(() => subscribeProfiles(() => {
    setProfile(getCurrentProfile())
    setFullyCodes(fullyRecordedCodes(getCurrentProfileId()))
  }), [])

  const pool = useMemo(() => fullyCodes.map(findCharacter).filter(Boolean), [fullyCodes])
  const filtered = useMemo(
    () => applyFilters(pool, { search, selected, toggles }),
    [pool, search, selected, toggles],
  )
  const activeCount = countActiveFilters(selected, toggles)

  // 实时生成：勾选项 / 选中角色 / 存档元信息任一变化即重算（位打包很快，无需防抖）
  const { code, codeError } = useMemo(() => {
    if (picked.length === 0) return { code: '', codeError: '' }
    try {
      return {
        code: encodeShareCode({
          synchroLevel: profile.synchroLevel,
          research: profile.research,
          characters: picked.map((item) => ({ nameCode: item, record: loadRecord(item) || {} })),
          fields,
        }),
        codeError: '',
      }
    } catch (error) {
      return { code: '', codeError: String(error?.message || error) }
    }
  }, [picked, fields, profile])

  const toggleOption = (key, value) => {
    setSelected((prev) => {
      const current = prev[key] || []
      const next = current.includes(value) ? current.filter((item) => item !== value) : [...current, value]
      return { ...prev, [key]: next }
    })
  }
  const toggleSwitch = (key) => setToggles((prev) => ({ ...prev, [key]: !prev[key] }))

  const toggleField = (key) => {
    if (key === 'equip') return // 装备词条恒为必选
    setFields((prev) => saveShareFields(
      prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key],
    ))
  }

  const togglePick = (nameCode) => {
    const value = String(nameCode)
    setPicked((prev) => {
      if (prev.includes(value)) return prev.filter((item) => item !== value)
      if (prev.length >= SHARE_MAX_COUNT) {
        setLimitHit(true)
        window.clearTimeout(limitTimer.current)
        limitTimer.current = window.setTimeout(() => setLimitHit(false), 2600)
        return prev
      }
      return [...prev, value]
    })
  }

  const flash = (text) => {
    setCopyHint(text)
    window.clearTimeout(hintTimer.current)
    hintTimer.current = window.setTimeout(() => setCopyHint(''), 1800)
  }

  // 先同步选中文本并立即反馈；剪贴板写入成功后再升级为「已复制」。
  // 部分环境（窗口无焦点）writeText 的 Promise 既不 resolve 也不 reject，故反馈不能挂在它上面。
  const handleCopy = () => {
    const node = codeRef.current
    if (node) {
      node.focus()
      node.select()
    }
    flash(t('已选中，请按 Ctrl+C 复制'))
    try {
      const pending = navigator.clipboard?.writeText(code)
      if (pending && typeof pending.then === 'function') pending.then(() => flash(t('已复制'))).catch(() => {})
    } catch {
      // 剪贴板不可用：保留「已选中」提示
    }
  }

  const closeNotice = (dontShowAgain) => {
    if (dontShowAgain) dismissShareNotice()
    setNoticeOpen(false)
  }

  return (
    <section className="bs-section" aria-label={t('角色数据分享码')}>
      <header className="bs-head">
        <div>
          <h2>{t('角色数据')}</h2>
          <div className="desc">
            {t('选已完善的角色生成分享码，在 QQ 里发')} <code>/妮姬导入 &lt;{t('分享码')}&gt;</code>
          </div>
        </div>
        <div className="count">{t('已选')} <strong>{picked.length}</strong> / {SHARE_MAX_COUNT}</div>
      </header>

      <div className="toolbar">
        <label className="search">
          <span className="icon">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.4" />
              <path d="M10.6 10.6L14 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('搜索：中文名 / 英文名 / 资源号 / 拼音首字母')}
            spellCheck={false}
          />
          {search ? (
            <button type="button" className="search-clear" onClick={() => setSearch('')} aria-label={t('清空搜索')}>×</button>
          ) : null}
        </label>

        <FilterBar
          selected={selected}
          toggles={toggles}
          activeCount={activeCount}
          onToggleOption={toggleOption}
          onToggleSwitch={toggleSwitch}
          onClear={() => { setSelected(NO_SELECTION); setToggles(DEFAULT_TOGGLES) }}
        />

        <span className="spacer" />

        <span className="share-limit">{t('单次最多 {max} 个{extra}', { max: SHARE_MAX_COUNT, extra: limitHit ? t('（已达上限，先取消部分选择）') : '' })}</span>
        {picked.length > 0 ? (
          <button type="button" className="btn btn-sm" onClick={() => setPicked([])}>{t('清空选择')}</button>
        ) : null}
      </div>

      <div className="share-fields">
        <div className="share-fields-head">
          <span className="t">{t('导出字段')}</span>
          <span className="h">{t('装备词条必选；勾得越少，码越短')}</span>
          <span className="spacer" />
          <button type="button" className="link-btn" onClick={() => setNoticeOpen(true)}>{t('默认值说明')}</button>
        </div>
        <div className="field-list">
          {SHARE_FIELDS.map((field) => (
            <label
              key={field.key}
              className={`field-item${field.locked ? ' is-locked' : ''}`}
              title={field.locked ? t('装备词条为必选项') : undefined}
            >
              <input
                type="checkbox"
                checked={fields.includes(field.key)}
                disabled={field.locked}
                onChange={() => toggleField(field.key)}
              />
              <span>{t(field.label)}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="share-output">
        <textarea
          ref={codeRef}
          className="share-code"
          readOnly
          rows={3}
          value={code}
          placeholder={t('先在上面选角色，码会实时出现在这里')}
          onFocus={(event) => event.target.select()}
        />
        <div className="share-meta">
          {codeError
            ? <span className="dlg-error">{t(codeError)}</span>
            : <span>{t('{count} 个角色', { count: picked.length })} · {code ? t('{n} 字符', { n: code.length }) : '—'}</span>}
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={handleCopy}
            disabled={!code}
          >
            {copyHint || t('复制分享码')}
          </button>
        </div>
      </div>

      {pool.length > 0 ? (
        filtered.length > 0 ? (
          <div className="pick-grid">
            {filtered.map((character) => {
              const item = String(character.nameCode)
              const active = picked.includes(item)
              const blocked = !active && picked.length >= SHARE_MAX_COUNT
              const elementIcon = iconFor('element', character.element)
              const burstIcon = iconFor('use_burst_skill', character.use_burst_skill)
              return (
                <button
                  key={item}
                  type="button"
                  className={`pick-tile${active ? ' is-picked' : ''}${blocked ? ' is-disabled' : ''}`}
                  onClick={() => togglePick(item)}
                  title={displayName(character)}
                >
                  <span className="pick-thumb">
                    {character.avatar
                      ? <img src={assetUrl(character.avatar)} alt="" loading="lazy" decoding="async" />
                      : <span className="ph">{t('无头像')}</span>}
                    {elementIcon ? <img className="elem" src={assetUrl(elementIcon)} alt="" /> : null}
                    {burstIcon ? <img className="burst" src={assetUrl(burstIcon)} alt="" /> : null}
                    <span className="pick-check" aria-hidden="true">✓</span>
                  </span>
                  <span className="pick-name">{displayName(character)}</span>
                </button>
              )
            })}
          </div>
        ) : (
          <div className="empty">
            <div className="t">{t('没有匹配的角色')}</div>
            <div>{t('换个关键词，或调整筛选条件')}</div>
          </div>
        )
      ) : (
        <div className="empty">
          <div className="t">{t('当前存档还没有已完善的角色')}</div>
          <div>{t('先在「数据录入」把角色的四件装备填完，这里就能生成分享码了')}</div>
        </div>
      )}

      {noticeOpen ? <ShareCodeNotice onClose={closeNotice} /> : null}
    </section>
  )
}
