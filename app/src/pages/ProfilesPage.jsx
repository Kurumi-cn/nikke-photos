import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import AccountImportDialog from '../components/AccountImportDialog.jsx'
import FullyRecordedDialog from '../components/FullyRecordedDialog.jsx'
import ProfileDialog from '../components/ProfileDialog.jsx'
import ProfileImportFlow from '../components/ProfileImportFlow.jsx'
import { CHARACTERS, applyFilters, countActiveFilters, findCharacter } from '../lib/roster.js'
import {
  createProfile,
  deleteProfile,
  exportProfile,
  fullyRecordedCodes,
  getCurrentProfileId,
  listProfiles,
  nextProfileName,
  setCurrentProfile,
  subscribeProfiles,
  updateProfile,
} from '../lib/profileStore.js'
import { t } from '../lib/i18n.js'

const SORT_OPTIONS = [
  { key: 'updatedAt', label: '最近修改时间' },
  { key: 'createdAt', label: '创建时间' },
  { key: 'name', label: '名称' },
]

const DEFAULT_TOGGLES = { cnPublished: false, collectible: false, overSpec: false }
const NO_SELECTION = {}

// 列表观感状态按会话保存：点角色进详情再返回时恢复弹窗、筛选与滚动位置
const VIEW_KEY = 'nikke-photos:profiles-view'
const DEFAULT_VIEW = {
  openProfileId: null,
  search: '',
  selected: NO_SELECTION,
  toggles: DEFAULT_TOGGLES,
  sortKey: 'updatedAt',
  sortDir: 'desc',
  gridScroll: 0,
  pageScroll: 0,
}

const loadView = () => {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(VIEW_KEY) || 'null')
    if (!parsed || typeof parsed !== 'object') return DEFAULT_VIEW
    return {
      ...DEFAULT_VIEW,
      ...parsed,
      selected: parsed.selected && typeof parsed.selected === 'object' ? parsed.selected : NO_SELECTION,
      toggles: { ...DEFAULT_TOGGLES, ...(parsed.toggles || {}) },
      sortKey: SORT_OPTIONS.some((item) => item.key === parsed.sortKey) ? parsed.sortKey : 'updatedAt',
      sortDir: parsed.sortDir === 'asc' ? 'asc' : 'desc',
    }
  } catch {
    return DEFAULT_VIEW
  }
}

const pad = (value) => String(value).padStart(2, '0')
const formatTime = (iso) => {
  if (!iso) return '—'
  const date = new Date(iso)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
/** 导出文件名的时间戳：20261004-2130 */
const stamp = () => {
  const now = new Date()
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`
}

/** 存档管理页：概览列表（当前档置顶）+ 新建 / 切换 / 详情编辑 / 删除 / 角色一览 */
export default function ProfilesPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const restored = useRef(loadView())

  const [profiles, setProfiles] = useState(() => listProfiles())
  const [currentId, setCurrentId] = useState(() => getCurrentProfileId())
  const [view, setView] = useState(restored.current)
  const [editor, setEditor] = useState(null) // { mode, profile? }
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [accountImport, setAccountImport] = useState(false)
  const [profileImport, setProfileImport] = useState(null) // parseProfile 产物；非空时打开档案导入流程
  const [notice, setNotice] = useState('')

  const gridRef = useRef(null)
  const gridScrollRef = useRef(restored.current.gridScroll)
  const viewRef = useRef(view)
  viewRef.current = view

  // 存档列表 / 当前档随数据层变更刷新
  useEffect(() => subscribeProfiles(() => {
    setProfiles(listProfiles())
    setCurrentId(getCurrentProfileId())
  }), [])

  // 恢复页面滚动位置（从角色详情返回时）
  useLayoutEffect(() => {
    const top = restored.current.pageScroll
    if (top) window.scrollTo(0, top)
  }, [])

  // 离开页面时记录页面滚动位置
  useEffect(() => () => {
    try {
      sessionStorage.setItem(VIEW_KEY, JSON.stringify({ ...viewRef.current, pageScroll: window.scrollY }))
    } catch {
      // 隐私模式等场景下存储不可用，忽略
    }
  }, [])

  const patchView = (patch) => setView((prev) => ({ ...prev, ...patch }))

  // 恢复弹窗内网格的滚动位置（弹窗打开后执行一次）
  useEffect(() => {
    if (!view.openProfileId || !gridRef.current) return
    gridRef.current.scrollTop = gridScrollRef.current
  }, [view.openProfileId])

  const goBack = () => {
    if (location.key !== 'default') navigate(-1)
    else navigate('/my')
  }

  const decorated = useMemo(() => profiles.map((profile) => ({
    ...profile,
    isCurrent: profile.id === currentId,
    fully: fullyRecordedCodes(profile.id).length,
  })), [profiles, currentId])

  const ordered = useMemo(() => {
    const direction = view.sortDir === 'asc' ? 1 : -1
    const compare = (left, right) => {
      if (view.sortKey === 'name') {
        return left.name.localeCompare(right.name, 'zh-Hans-CN', { numeric: true }) * direction
      }
      const leftValue = view.sortKey === 'createdAt' ? left.createdAt : left.updatedAt
      const rightValue = view.sortKey === 'createdAt' ? right.createdAt : right.updatedAt
      return String(leftValue || '').localeCompare(String(rightValue || '')) * direction
    }
    const rest = decorated.filter((item) => !item.isCurrent).sort(compare)
    const current = decorated.find((item) => item.isCurrent)
    return current ? [current, ...rest] : rest
  }, [decorated, view.sortKey, view.sortDir])

  const dialogProfile = useMemo(
    () => decorated.find((item) => item.id === view.openProfileId) || null,
    [decorated, view.openProfileId],
  )

  const dialogCharacters = useMemo(() => {
    if (!dialogProfile) return []
    const list = fullyRecordedCodes(dialogProfile.id).map(findCharacter).filter(Boolean)
    return applyFilters(list, { search: view.search, selected: view.selected, toggles: view.toggles })
  }, [dialogProfile, view.search, view.selected, view.toggles])

  const activeCount = countActiveFilters(view.selected, view.toggles)

  const toggleOption = (key, value) => {
    setView((prev) => {
      const current = prev.selected[key] || []
      const next = current.includes(value) ? current.filter((item) => item !== value) : [...current, value]
      return { ...prev, selected: { ...prev.selected, [key]: next } }
    })
  }
  const toggleSwitch = (key) => setView((prev) => ({ ...prev, toggles: { ...prev.toggles, [key]: !prev.toggles[key] } }))
  const clearFilters = () => patchView({ selected: NO_SELECTION, toggles: DEFAULT_TOGGLES })

  const openCreate = () => setEditor({ mode: 'create', profile: { name: nextProfileName(), synchroLevel: '', remark: '' } })

  /** 导出当前存档为一个 JSON 文件（只含当前档） */
  const handleExportProfile = () => {
    const blob = new Blob([exportProfile()], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `nikke-photos-${t('档案')}-${stamp()}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  /** 档案类文件导入完成：列表刷新由 subscribeProfiles 负责，这里只给一条结果提示 */
  const finishProfileImport = (result, label) => {
    setProfileImport(null)
    const schemeNote = result.schemes ? t('，方案 {count} 个', { count: result.schemes }) : ''
    const renameNote = result.schemeRenames?.length
      ? t('（方案重名已改为 {names}）', { names: result.schemeRenames.map((item) => `「${item.to}」`).join('、') })
      : ''
    setNotice(`${t('已导入 {count} 个角色记录到', { count: result.imported })}${label}${result.unknown.length ? t('（{count} 个键未识别）', { count: result.unknown.length }) : ''}${schemeNote}${renameNote}`)
  }

  const handleSubmit = (values) => {
    if (editor?.mode === 'create') createProfile(values)
    else if (editor?.profile?.id) updateProfile(editor.profile.id, values)
    setEditor(null)
  }

  const handleDelete = () => {
    if (!confirmDelete) return
    try {
      deleteProfile(confirmDelete.id)
    } catch (error) {
      window.alert(String(error?.message || error))
    }
    setConfirmDelete(null)
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
          <h1>{t('存档管理')}</h1>
          <div className="desc">{t('每个存档独立保存角色数据；点击存档行即可切换为当前存档')}</div>
        </div>
        <div className="head-actions">
          <button type="button" className="btn" onClick={handleExportProfile}>{t('导出当前档案数据')}</button>
          <button type="button" className="btn" onClick={() => setAccountImport(true)}>{t('导入账号/档案数据')}</button>
          <button type="button" className="btn btn-primary" onClick={openCreate}>{t('新建存档')}</button>
        </div>
      </div>

      <div className="toolbar">
        <label className="sort-field">
          <span>{t('排序')}</span>
          <select value={view.sortKey} onChange={(event) => patchView({ sortKey: event.target.value })}>
            {SORT_OPTIONS.map((option) => (
              <option key={option.key} value={option.key}>{t(option.label)}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => patchView({ sortDir: view.sortDir === 'asc' ? 'desc' : 'asc' })}
        >
          {view.sortDir === 'asc' ? t('升序 ↑') : t('降序 ↓')}
        </button>
        <span className="spacer" />
        <span className="archive-count">{t('共')} <strong>{profiles.length}</strong> {t('个存档')}</span>
      </div>

      <div className="profile-list">
        {ordered.map((profile) => (
          <div
            key={profile.id}
            className={profile.isCurrent ? 'profile-row is-current' : 'profile-row'}
            onClick={() => { if (!profile.isCurrent) setCurrentProfile(profile.id) }}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !profile.isCurrent) setCurrentProfile(profile.id)
            }}
          >
            <div className="profile-main">
              <div className="profile-title">
                <b>{profile.name}</b>
                {profile.isCurrent ? <span className="profile-badge">{t('当前')}</span> : null}
              </div>
              <div className="profile-meta">
                <span>{t('已完善：')}<strong>{profile.fully}</strong></span>
                <span>{t('同步器等级 {level}', { level: profile.synchroLevel })}</span>
                <span>{t('最近修改 {time}', { time: formatTime(profile.updatedAt) })}</span>
              </div>
            </div>

            <div className="profile-actions" onClick={(event) => event.stopPropagation()}>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => patchView({ openProfileId: profile.id, pageScroll: window.scrollY })}
              >
                {t('角色一览')}
              </button>
              <button type="button" className="btn btn-sm" onClick={() => setEditor({ mode: 'edit', profile })}>
                {t('详情')}
              </button>
              <button
                type="button"
                className="btn btn-sm"
                disabled={profile.deletable === false}
                title={profile.deletable === false ? t('默认存档不可删除') : ''}
                onClick={() => setConfirmDelete(profile)}
              >
                {t('删除')}
              </button>
            </div>
          </div>
        ))}
      </div>

      {accountImport ? (
        <AccountImportDialog
          onProfileParsed={(parsed) => {
            setAccountImport(false)
            setProfileImport(parsed)
          }}
          onClose={() => setAccountImport(false)}
        />
      ) : null}

      {profileImport ? (
        <ProfileImportFlow
          parsed={profileImport}
          onDone={finishProfileImport}
          onClose={() => setProfileImport(null)}
        />
      ) : null}

      {notice ? (
        <div className="drop-toast" role="status">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice('')} aria-label={t('关闭')}>×</button>
        </div>
      ) : null}

      {editor ? (
        <ProfileDialog
          key={`${editor.mode}-${editor.profile?.id || 'new'}`}
          mode={editor.mode}
          initial={editor.profile}
          onClose={() => setEditor(null)}
          onSubmit={handleSubmit}
        />
      ) : null}

      {dialogProfile ? (
        <FullyRecordedDialog
          profileName={dialogProfile.name}
          isCurrent={dialogProfile.isCurrent}
          characters={dialogCharacters}
          activeCount={activeCount}
          search={view.search}
          selected={view.selected}
          toggles={view.toggles}
          onSearchChange={(value) => patchView({ search: value })}
          onToggleOption={toggleOption}
          onToggleSwitch={toggleSwitch}
          onClear={clearFilters}
          onSwitchToCurrent={() => setCurrentProfile(dialogProfile.id)}
          gridRef={gridRef}
          onGridScroll={(event) => { gridScrollRef.current = event.currentTarget.scrollTop }}
          onClose={() => patchView({ openProfileId: null })}
        />
      ) : null}

      {confirmDelete ? (
        <div
          className="dlg-mask"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setConfirmDelete(null)
          }}
        >
          <div className="dlg" role="dialog" aria-label={t('删除存档')}>
            <div className="dlg-head">
              <h2>{t('删除存档')}</h2>
              <button type="button" className="dlg-x" onClick={() => setConfirmDelete(null)} aria-label={t('关闭')}>×</button>
            </div>
            <div className="dlg-body">
              <p className="dlg-text">
                {t('确定删除存档「{name}」？该存档已完善 {count} 个角色的数据会一并删除，且无法恢复。', { name: confirmDelete.name, count: confirmDelete.fully })}
              </p>
            </div>
            <div className="dlg-foot">
              <button type="button" className="btn" onClick={() => setConfirmDelete(null)}>{t('取消')}</button>
              <button type="button" className="btn btn-danger" onClick={handleDelete}>{t('删除')}</button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  )
}
