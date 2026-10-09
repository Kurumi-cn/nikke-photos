// 方案管理：一份存档下的一组「角色默认值」，**手动**应用到当前角色
//
// 方案模型与语义见 lib/schemes.js 的文件头。本文件只管界面：
//   - 列表（名称 + 摘要 + 强制替换标记）
//   - 新建 / 编辑（编辑窗口的第一项就是方案名，改名也在这里）
//   - 删除（二次确认）
//   - 应用（只有传入 onApply 时才出现 —— 也就是「数据录入」页里打开的那份）
import { useEffect, useRef, useState } from 'react'
import ConfirmDialog from './ConfirmDialog.jsx'
import NumField from './NumField.jsx'
import { t, tData } from '../lib/i18n.js'
import '../styles/schemes.css'
import { CUBES } from '../lib/cubes.js'
import { getSchemes, saveSchemes } from '../lib/profileStore.js'
import {
  FAVORITE_SSR_OPTIONS, SCHEME_FIELD_ROWS, SCHEME_NAME_MAX,
  createScheme, isSchemeNameTaken, nextSchemeName, normalizeScheme,
  schemeHasAnyValue, schemeSummary, ssrLevelFromControl, ssrLevelToControl,
} from '../lib/schemes.js'

// 表单按「基础 / 研究所与技能」分两块展示（顺序仍由 SCHEME_FIELD_ROWS 决定）
const BASIC_ROWS = SCHEME_FIELD_ROWS.filter((row) => row.path[0] !== 'skills')
const SKILL_ROWS = SCHEME_FIELD_ROWS.filter((row) => row.path[0] === 'skills')

/** 非破坏性写入：path 最多两层（如 ['limitBreak','grade'] 或 ['affection']） */
const withField = (scheme, path, value) => {
  if (path.length === 1) return { ...scheme, [path[0]]: value }
  const [group, key] = path
  return { ...scheme, [group]: { ...(scheme[group] || {}), [key]: value } }
}

/**
 * 新建 / 编辑方案（同一组件，标题不同）。父组件用 key 控制挂载，打开即是最新初值。
 * mode: 'create' | 'edit'
 */
function SchemeEditor({ mode, initial, schemes, onClose, onSubmit }) {
  const [draft, setDraft] = useState(() => initial)
  const [touched, setTouched] = useState(false)
  const [invalidKeys, setInvalidKeys] = useState(() => new Set())
  const nameRef = useRef(null)

  useEffect(() => {
    // 名称默认全选，方便直接改写
    const timer = window.setTimeout(() => {
      nameRef.current?.focus()
      nameRef.current?.select()
    }, 0)
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  const setIn = (path, value) => setDraft((prev) => withField(prev, path, value))

  /** NumField 的越界回执：记录哪些格子当前是错的，错着就不让保存 */
  const markValidity = (key) => (valid) => setInvalidKeys((prev) => {
    if (valid === !prev.has(key)) return prev
    const next = new Set(prev)
    if (valid) next.delete(key)
    else next.add(key)
    return next
  })

  const trimmed = draft.name.trim()
  const nameError = !trimmed
    ? t('方案名不能为空')
    : (isSchemeNameTaken(schemes, trimmed, draft.id) ? t('方案名不允许重复') : '')
  const canSave = !nameError && invalidKeys.size === 0

  const submit = () => {
    setTouched(true)
    if (!canSave) {
      if (nameError) nameRef.current?.focus()
      return
    }
    onSubmit(normalizeScheme({ ...draft, name: trimmed }))
  }

  const renderRows = (rows) => rows.map(({ path, rangeKey, label }) => {
    const [group, key] = path
    return (
      <NumField
        key={path.join('.')}
        label={label}
        rangeKey={rangeKey}
        value={key === undefined ? draft[group] : draft[group]?.[key]}
        onChange={(value) => setIn(path, value)}
        onValidityChange={markValidity(path.join('.'))}
      />
    )
  })

  return (
    <div
      className="dlg-mask"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="dlg dlg-wide" role="dialog" aria-label={mode === 'create' ? t('新建方案') : t('编辑方案')}>
        <div className="dlg-head">
          <h2>{mode === 'create' ? t('新建方案') : t('编辑方案')}</h2>
          <button type="button" className="dlg-x" onClick={onClose} aria-label={t('关闭')}>×</button>
        </div>

        <div className="dlg-body dlg-body-scroll">
          <div>
            <div className="dlg-row">
              <span className="dlg-label">{t('方案名')}</span>
              <input
                ref={nameRef}
                className={touched && nameError ? 'dlg-input is-invalid' : 'dlg-input'}
                value={draft.name}
                maxLength={SCHEME_NAME_MAX}
                placeholder={t('例如：主号常用')}
                onChange={(event) => {
                  setTouched(true)
                  setIn(['name'], event.target.value)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') submit()
                }}
              />
            </div>
            {touched && nameError ? <p className="dlg-error">{nameError}</p> : null}
          </div>

          <label className="scheme-force">
            <input
              type="checkbox"
              checked={Boolean(draft.forceReplace)}
              onChange={(event) => setIn(['forceReplace'], event.target.checked)}
            />
            <span>
              <b>{t('强制替换')}</b>
              <small>{t('应用方案时，覆盖已输入的内容；方案里留空的项一律不碰（不勾则只填空缺）')}</small>
            </span>
          </label>

          <div className="form-grid">
            <section className="form-block">
              <h3>{t('基础')}</h3>
              {renderRows(BASIC_ROWS)}
              <p className="scheme-note">{t('留空表示该方案不指定这一项')}</p>
            </section>

            <section className="form-block">
              <h3>{t('研究所与技能')}</h3>
              {renderRows(SKILL_ROWS)}
            </section>

            <section className="form-block">
              <h3>{t('魔方与收藏品')}</h3>
              <label className="form-row">
                <span className="form-label">{t('魔方')}</span>
                <select
                  className="inp"
                  value={draft.cube?.resourceId ?? ''}
                  onChange={(event) => setIn(['cube', 'resourceId'], event.target.value === '' ? null : Number(event.target.value))}
                >
                  <option value="">{t('不指定')}</option>
                  {CUBES.map((cube) => (
                    <option key={cube.resourceId} value={cube.resourceId}>{tData(cube.nameCn)}</option>
                  ))}
                </select>
              </label>
              <NumField
                label="魔方等级"
                rangeKey="cubeLevel"
                value={draft.cube?.level}
                onChange={(value) => setIn(['cube', 'level'], value)}
                onValidityChange={markValidity('cube.level')}
              />

              <label className="form-row">
                <span className="form-label">{t('收藏品')}</span>
                <select
                  className="inp"
                  value={draft.favoriteItem?.rarity ?? ''}
                  onChange={(event) => setIn(['favoriteItem', 'rarity'], event.target.value || null)}
                >
                  <option value="">{t('不指定')}</option>
                  <option value="R">{t('R 收藏品')}</option>
                  <option value="SR">{t('SR 收藏品')}</option>
                </select>
              </label>
              <NumField
                label="收藏品等级"
                rangeKey="favoriteLevel"
                value={draft.favoriteItem?.level}
                onChange={(value) => setIn(['favoriteItem', 'level'], value)}
                onValidityChange={markValidity('favoriteItem.level')}
              />

              <label className="form-row">
                <span className="form-label">{t('珍藏品角色')}</span>
                <select
                  className="inp"
                  value={ssrLevelToControl(draft.favoriteSsrLevel)}
                  onChange={(event) => setIn(['favoriteSsrLevel'], ssrLevelFromControl(event.target.value))}
                >
                  {FAVORITE_SSR_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{t(option.label)}</option>
                  ))}
                </select>
                <span className="form-hint">{t('只对珍藏品角色生效，其余角色按上面的收藏品设置')}</span>
              </label>
            </section>
          </div>
        </div>

        <div className="dlg-foot">
          <button type="button" className="btn" onClick={onClose}>{t('取消')}</button>
          <button type="button" className="btn btn-primary" disabled={!canSave} onClick={submit}>
            {mode === 'create' ? t('创建') : t('保存')}
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * 方案管理主体（弹窗与独立页面共用同一份）
 *
 * @param {() => void} [onApply] 传入则显示「应用至当前角色」（仅数据录入页这么做）
 */
export default function SchemeManager({ onApply }) {
  const [schemes, setSchemes] = useState(() => getSchemes())
  const [editor, setEditor] = useState(null) // { mode, scheme }
  const [confirmDelete, setConfirmDelete] = useState(null)

  const commit = (list) => setSchemes(saveSchemes(list))

  const openCreate = () => setEditor({ mode: 'create', scheme: createScheme(nextSchemeName(schemes)) })
  const openEdit = (scheme) => setEditor({ mode: 'edit', scheme: { ...scheme } })

  const submitEditor = (scheme) => {
    commit(editor.mode === 'create'
      ? [...schemes, scheme]
      : schemes.map((item) => (item.id === scheme.id ? scheme : item)))
    setEditor(null)
  }

  const handleDelete = () => {
    commit(schemes.filter((item) => item.id !== confirmDelete.id))
    setConfirmDelete(null)
  }

  return (
    <div className="scheme-manager">
      <div className="scheme-toolbar">
        <button type="button" className="btn btn-primary btn-sm" onClick={openCreate}>{t('新建方案')}</button>
        <span className="spacer" />
        <span className="archive-count">{t('共')} <strong>{schemes.length}</strong> {t('个方案')}</span>
      </div>

      {schemes.length === 0 ? (
        <div className="empty">
          <div className="t">{t('还没有方案')}</div>
          <div>{t('方案可以预先存好一组默认值，需要时一键应用到这个角色')}</div>
        </div>
      ) : (
        <div className="scheme-list">
          {schemes.map((scheme) => {
            const summary = schemeSummary(scheme)
            return (
              <div className="scheme-row" key={scheme.id}>
                <div className="scheme-main">
                  <div className="scheme-title">
                    <b>{scheme.name}</b>
                    {scheme.forceReplace ? <span className="scheme-badge">{t('强制替换')}</span> : null}
                  </div>
                  <div className="scheme-meta">{summary ? t(summary) : t('未指定任何默认值')}</div>
                </div>
                <div className="scheme-actions">
                  {onApply ? (
                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      disabled={!schemeHasAnyValue(scheme)}
                      title={schemeHasAnyValue(scheme) ? '' : t('该方案没有指定任何默认值')}
                      onClick={() => onApply(scheme)}
                    >
                      {t('应用至当前角色')}
                    </button>
                  ) : null}
                  <button type="button" className="btn btn-sm" onClick={() => openEdit(scheme)}>{t('编辑')}</button>
                  <button type="button" className="btn btn-sm" onClick={() => setConfirmDelete(scheme)}>{t('删除')}</button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {editor ? (
        <SchemeEditor
          key={`${editor.mode}-${editor.scheme.id}`}
          mode={editor.mode}
          initial={editor.scheme}
          schemes={schemes}
          onClose={() => setEditor(null)}
          onSubmit={submitEditor}
        />
      ) : null}

      {confirmDelete ? (
        <ConfirmDialog
          title="删除方案"
          message={<p className="dlg-text">{t('确定删除方案「{name}」？删除后无法恢复。', { name: confirmDelete.name })}</p>}
          confirmText="删除"
          danger
          onConfirm={handleDelete}
          onClose={() => setConfirmDelete(null)}
        />
      ) : null}
    </div>
  )
}
