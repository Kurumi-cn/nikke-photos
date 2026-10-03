import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import CharacterForm from '../components/CharacterForm.jsx'
import ConfirmDialog from '../components/ConfirmDialog.jsx'
import SchemeDialog from '../components/SchemeDialog.jsx'
import { CHARACTERS, applyFilters, assetUrl, findCharacter, labelFor } from '../lib/roster.js'
import { applyScheme, changeText } from '../lib/schemes.js'
import {
  fullyRecordedCodes,
  getCurrentProfileId,
  getResearch,
  getSynchroLevel,
  loadRecord,
  recordedCodes,
  removeRecord,
  researchLevelsFor,
  saveRecord,
  setSynchroLevel,
  syncSkillsToFullyRecorded,
} from '../lib/profileStore.js'
import { getTestProfile } from '../data/testProfiles.js'

const pad = (value) => String(value).padStart(2, '0')
const formatTime = (iso) => {
  if (!iso) return ''
  const date = new Date(iso)
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 数据录入页：左侧选择角色，右侧录入角色数据与装备词条（卡片效果在「角色详情」查看） */
export default function DataEntryPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const selectedCode = searchParams.get('code') || ''
  // 从「角色详情」跳入：单角色编辑模式——隐藏左侧选择器并显示返回按钮；从顶部 Tab 进入则显示完整工作区
  const fromDetail = location.state?.from === 'character'
  const goBack = () => {
    if (location.key !== 'default') navigate(-1)
    else navigate('/')
  }
  const character = selectedCode ? findCharacter(selectedCode) : null
  const sample = useMemo(() => getTestProfile(selectedCode), [selectedCode])

  const [search, setSearch] = useState('')
  const [record, setRecord] = useState({})
  const [hasStored, setHasStored] = useState(false)
  const [savedAt, setSavedAt] = useState(null)
  const [dirty, setDirty] = useState(false)
  const [recorded, setRecorded] = useState(() => new Set(recordedCodes()))
  const [synchroLevel, setSynchroLevelState] = useState(() => getSynchroLevel())
  const [research] = useState(() => getResearch())
  // 当前角色的职业 / 企业研究等级（按存档表取值）
  const researchLevels = researchLevelsFor(character, research)
  const [syncToast, setSyncToast] = useState('')
  const [syncSkills, setSyncSkills] = useState(null)
  const [schemeOpen, setSchemeOpen] = useState(false)
  const [pendingApply, setPendingApply] = useState(null)
  const lastToastRef = useRef(0)
  const toastTimerRef = useRef(0)

  // 切换角色：装入本机档案（无则用示例档案）
  useEffect(() => {
    if (!selectedCode) return
    const stored = loadRecord(selectedCode)
    setRecord(stored ?? getTestProfile(selectedCode) ?? {})
    setHasStored(Boolean(stored))
    setSavedAt(stored?.updatedAt ?? null)
    setDirty(false)
  }, [selectedCode])

  // 变更即落库（无防抖）：录入页没有拖动类高频操作，避免防抖窗口内切换角色丢失最后一次编辑
  useEffect(() => {
    if (!dirty || !selectedCode) return
    const saved = saveRecord(selectedCode, record)
    setSavedAt(saved.updatedAt)
    setHasStored(true)
    setDirty(false)
    setRecorded(new Set(recordedCodes()))
  }, [dirty, selectedCode, record])

  const list = useMemo(() => applyFilters(CHARACTERS, { search }), [search])

  const dataState = hasStored
    ? (savedAt ? `已保存到本机 · ${formatTime(savedAt)}` : '已保存到本机')
    : sample ? '示例数据，未保存到本机' : '暂无录入数据'

  const handleClearStored = () => {
    removeRecord(selectedCode)
    setRecord(sample ?? {})
    setHasStored(false)
    setSavedAt(null)
    setDirty(false)
    setRecorded(new Set(recordedCodes()))
  }

  const handleRestoreSample = () => {
    setRecord(sample ?? {})
    setDirty(true)
  }

  const showToast = (text) => {
    setSyncToast(text)
    window.clearTimeout(toastTimerRef.current)
    toastTimerRef.current = window.setTimeout(() => setSyncToast(''), 2200)
  }

  // 同步器等级为存档级全局唯一值：改动即静默同步全体；提示内置 3 秒 CD，避免连续输入时刷屏
  const handleSynchroLevel = (next) => {
    if (!Number.isFinite(next) || next < 1 || next > 2000) return
    const applied = setSynchroLevel(next)
    setSynchroLevelState(applied)
    const stamp = Date.now()
    if (stamp - lastToastRef.current < 3000) return
    lastToastRef.current = stamp
    showToast(`已同步全体妮姬等级为 ${applied}`)
  }

  // 技能同步：只作用于「已完善」角色，先弹二次确认
  const openSyncSkills = (skills) => {
    setSyncSkills({ values: skills, count: fullyRecordedCodes(getCurrentProfileId()).length })
  }

  const confirmSyncSkills = () => {
    const applied = syncSkillsToFullyRecorded(syncSkills.values)
    setSyncSkills(null)
    showToast(`已同步 ${applied} 名妮姬的技能等级`)
  }

  // 方案应用：只填/覆盖方案里指定了的项（强制替换才会覆盖），装备词条不受影响
  const commitSchemeApply = (outcome) => {
    setRecord(outcome.record)
    setDirty(true)
    setSchemeOpen(false)
    setPendingApply(null)
    const parts = []
    if (outcome.filled.length > 0) parts.push(`填入 ${outcome.filled.length} 项`)
    if (outcome.overwritten.length > 0) parts.push(`覆盖 ${outcome.overwritten.length} 项`)
    const notes = outcome.notes.length > 0 ? `（${outcome.notes.join('；')}）` : ''
    showToast(`已应用方案：${parts.join('，')}${notes}`)
  }

  const handleSchemeApply = (scheme) => {
    const outcome = applyScheme(record, scheme, { isFavoriteCharacter: Boolean(character?.favoriteItem) })
    if (outcome.filled.length === 0 && outcome.overwritten.length === 0) {
      showToast(outcome.notes.length > 0 ? `未应用：${outcome.notes.join('；')}` : '该方案没有可写入的值')
      return
    }
    // 会覆盖已填内容 → 先把要覆盖的字段列清楚，确认后再落库
    if (outcome.overwritten.length > 0) {
      setPendingApply({ scheme, outcome })
      return
    }
    commitSchemeApply(outcome)
  }

  return (
    <main className="page">
      {fromDetail ? (
        <button type="button" className="back" onClick={goBack}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M12.5 8h-9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <path d="M7 4 3 8l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          返回
        </button>
      ) : null}
      <div className="page-head">
        <div>
          <h1>数据录入</h1>
          <div className="desc">{fromDetail
            ? '编辑该角色的数据与装备词条；卡片效果在「角色详情」查看'
            : '选择角色，录入角色数据与装备词条；卡片效果在「角色详情」查看'}</div>
        </div>
        <div className="count">
          已录入 <strong>{recorded.size}</strong> / {CHARACTERS.length} 名
        </div>
      </div>

      <div className={fromDetail ? 'data-workspace is-single' : 'data-workspace'}>
        {fromDetail ? null : (
        <aside className="data-picker">
          <label className="data-search">
            <input
              type="text"
              value={search}
              placeholder="搜索：中文 / 英文 / 资源号 / 拼音首字母"
              onChange={(event) => setSearch(event.target.value)}
            />
            {search ? (
              <button type="button" className="search-clear" onClick={() => setSearch('')} aria-label="清空搜索">×</button>
            ) : null}
          </label>
          <div className="data-list">
            {list.map((item) => {
              const active = String(item.nameCode) === selectedCode
              return (
                <button
                  key={item.nameCode}
                  type="button"
                  className={active ? 'data-item active' : 'data-item'}
                  onClick={() => setSearchParams({ code: String(item.nameCode) })}
                >
                  {item.avatar
                    ? <img src={assetUrl(item.avatar)} alt="" loading="lazy" decoding="async" />
                    : <span className="data-avatar-ph" />}
                  <span className="data-name">{item.nameCn}</span>
                  {recorded.has(String(item.nameCode)) ? <i className="data-done" title="已录入" /> : null}
                </button>
              )
            })}
          </div>
        </aside>
        )}

        <section className="data-editor">
          {character ? (
            <>
              <div className="data-editor-head">
                <div className="char-head">
                  {character.avatar ? <img className="avatar" src={assetUrl(character.avatar)} alt={character.nameCn} /> : null}
                  <div>
                    <h2>{character.nameCn}</h2>
                    <div className="desc">{character.nameEn} · {character.nameCode} · {dataState}</div>
                  </div>
                </div>
                <div className="head-actions">
                  <button type="button" className="btn" onClick={() => setSchemeOpen(true)}>方案管理</button>
                  <Link className="btn" to={`/character/${character.nameCode}`}>查看角色详情</Link>
                </div>
              </div>
              <CharacterForm
                value={record}
                onChange={(next) => {
                  setRecord(next)
                  setDirty(true)
                }}
                synchroLevel={synchroLevel}
                onSynchroLevelChange={handleSynchroLevel}
                classLevel={researchLevels.classLevel}
                corporationLevel={researchLevels.corporationLevel}
                classLabel={character ? labelFor('class', character.class) : ''}
                corporationLabel={character ? labelFor('corporation', character.corporation) : ''}
                onSyncSkills={openSyncSkills}
                favoriteCharacter={Boolean(character.favoriteItem)}
                hasStored={hasStored}
                hasSample={Boolean(sample)}
                onClearStored={handleClearStored}
                onRestoreSample={handleRestoreSample}
              />
            </>
          ) : (
            <div className="empty">
              <div className="t">从左侧选择角色</div>
              <div>选中后即可录入数据与装备词条</div>
            </div>
          )}
        </section>
      </div>

      {syncSkills ? (
        <ConfirmDialog
          title="同步技能等级"
          message={(
            <>
              <p className="dlg-text">
                将把技能 <b>{syncSkills.values.skill1} / {syncSkills.values.skill2} / {syncSkills.values.burst}</b>
                （技能 1 / 技能 2 / 爆裂技能）同步至已完善的 <b>{syncSkills.count}</b> 名妮姬。
              </p>
              <p className="dlg-text">这些角色原有的技能等级会被覆盖。</p>
            </>
          )}
          confirmText="同步"
          onConfirm={confirmSyncSkills}
          onClose={() => setSyncSkills(null)}
        />
      ) : null}

      {schemeOpen && character ? (
        <SchemeDialog
          targetName={character.nameCn}
          onApply={handleSchemeApply}
          onClose={() => setSchemeOpen(false)}
        />
      ) : null}

      {pendingApply ? (
        <ConfirmDialog
          title="应用方案会覆盖已填字段"
          message={(
            <>
              <p className="dlg-text">方案「{pendingApply.scheme.name}」勾选了强制替换，下列已填字段会被覆盖：</p>
              <ul className="scheme-changes">
                {pendingApply.outcome.overwritten.map((item) => (
                  <li key={item.label}>{changeText(item)}</li>
                ))}
              </ul>
              {pendingApply.outcome.filled.length > 0 ? (
                <p className="dlg-text">另有 {pendingApply.outcome.filled.length} 项空白字段会被填入。</p>
              ) : null}
              <p className="dlg-text">装备词条不受影响。</p>
            </>
          )}
          confirmText="应用"
          onConfirm={() => commitSchemeApply(pendingApply.outcome)}
          onClose={() => setPendingApply(null)}
        />
      ) : null}

      {syncToast ? <div className="sync-toast" role="status">{syncToast}</div> : null}
    </main>
  )
}