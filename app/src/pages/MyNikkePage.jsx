import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import CharacterGrid from '../components/CharacterGrid.jsx'
import FilterBar from '../components/FilterBar.jsx'
import { CHARACTERS, TAXONOMY, applyFilters, assetUrl, countActiveFilters } from '../lib/roster.js'
import { ELEMENT_ORDER, elementColorOf, elementLabelOf } from '../lib/statsModel.js'
import { fullyRecordedCodes, getCurrentProfile, getCurrentProfileId, subscribeProfiles } from '../lib/profileStore.js'
import { ZOOM_PRESETS, loadGridZoom, saveGridZoom } from '../lib/gridZoom.js'
import '../styles/myNikke.css'

const NO_SELECTION = {}
const DEFAULT_TOGGLES = { cnPublished: false, collectible: false, overSpec: false }

// 筛选状态按会话保存：点进角色详情再返回、刷新页面都能恢复（和角色列表页同一套做法，
// 但用独立的 key —— 本页没有属性下拉，筛选项并不相同）
const FILTER_STORAGE_KEY = 'nikke-photos:my-nikke-filters'

// 属性按钮：顺序取 statsModel 的 ELEMENT_ORDER（燃烧→水冷→风压→电击→铁甲），
// 图标与颜色沿用 taxonomy 里那一套，和筛选下拉同源。
const ELEMENT_OPTIONS = TAXONOMY.filters.find((group) => group.key === 'element')?.options || []
const ELEMENT_BUTTONS = ELEMENT_ORDER.map((label) => {
  const option = ELEMENT_OPTIONS.find((item) => item.label === label) || {}
  return { label, value: option.value || label, icon: option.icon || '' }
})

const loadFilterState = () => {
  try {
    const raw = sessionStorage.getItem(FILTER_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return {
      search: typeof parsed.search === 'string' ? parsed.search : '',
      selected: parsed.selected && typeof parsed.selected === 'object' ? parsed.selected : NO_SELECTION,
      toggles: parsed.toggles && typeof parsed.toggles === 'object'
        ? { ...DEFAULT_TOGGLES, ...parsed.toggles }
        : DEFAULT_TOGGLES,
      element: ELEMENT_ORDER.includes(parsed.element) ? parsed.element : '',
    }
  } catch {
    return null
  }
}

export default function MyNikkePage() {
  const restored = useMemo(loadFilterState, [])
  const [profile, setProfile] = useState(() => getCurrentProfile())
  const [codes, setCodes] = useState(() => fullyRecordedCodes(getCurrentProfileId()))
  const [search, setSearch] = useState(restored?.search ?? '')
  const [selected, setSelected] = useState(restored?.selected ?? NO_SELECTION)
  const [toggles, setToggles] = useState(restored?.toggles ?? DEFAULT_TOGGLES)
  const [element, setElement] = useState(restored?.element ?? '')
  const [zoom, setZoom] = useState(() => loadGridZoom())

  // 存档数据变化（录入 / 导入 / 切换存档）后重新取已完善名单
  useEffect(() => subscribeProfiles(() => {
    setProfile(getCurrentProfile())
    setCodes(fullyRecordedCodes(getCurrentProfileId()))
  }), [])

  useEffect(() => {
    try {
      sessionStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify({ search, selected, toggles, element }))
    } catch {
      // 隐私模式等场景下存储不可用，忽略即可
    }
  }, [search, selected, toggles, element])

  useEffect(() => { saveGridZoom(zoom) }, [zoom])

  const recordedSet = useMemo(() => new Set(codes), [codes])

  // 已完善角色按**角色表顺序**排（不是存档里的录入顺序）
  const completed = useMemo(
    () => CHARACTERS.filter((character) => recordedSet.has(character.nameCode)),
    [recordedSet],
  )

  // 属性按钮之外的条件先应用一遍：按钮上的数量要按「其他筛选都生效后」来统计，
  // 否则筛了武器还显示全量属性人数，点了会得到空列表
  const scoped = useMemo(
    () => applyFilters(completed, { search, selected, toggles }),
    [completed, search, selected, toggles],
  )

  const elementCounts = useMemo(() => {
    const counts = new Map()
    for (const character of scoped) {
      const label = elementLabelOf(character.element)
      counts.set(label, (counts.get(label) || 0) + 1)
    }
    return counts
  }, [scoped])

  const filtered = useMemo(
    () => (element ? scoped.filter((character) => elementLabelOf(character.element) === element) : scoped),
    [scoped, element],
  )

  // 按属性分组（燃烧→水冷→风压→电击→铁甲），组内保持角色表顺序
  const groups = useMemo(() => {
    const buckets = new Map(ELEMENT_ORDER.map((label) => [label, []]))
    for (const character of filtered) {
      const label = elementLabelOf(character.element)
      if (!buckets.has(label)) buckets.set(label, [])
      buckets.get(label).push(character)
    }
    return [...buckets]
      .filter(([, list]) => list.length > 0)
      .map(([label, characters]) => ({ label, characters }))
  }, [filtered])

  const activeCount = countActiveFilters(selected, toggles) + (element ? 1 : 0)
  const zoomPreset = ZOOM_PRESETS.find((item) => item.key === zoom) || ZOOM_PRESETS[1]

  const toggleOption = (key, value) => {
    setSelected((prev) => {
      const current = prev[key] || []
      const next = current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value]
      return { ...prev, [key]: next }
    })
  }

  const toggleSwitch = (key) => setToggles((prev) => ({ ...prev, [key]: !prev[key] }))

  const clearFilters = () => {
    setSelected(NO_SELECTION)
    setToggles(DEFAULT_TOGGLES)
    setElement('')
  }

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>我的妮姬</h1>
          <div className="desc">「{profile.name}」中四件装备已录入完整的角色，点击头像进入角色详情</div>
        </div>
        <div className="count">
          已完善 <strong>{completed.length}</strong> 名
          {activeCount > 0 && ` · 匹配 ${filtered.length}`}
        </div>
      </div>

      {completed.length === 0 ? (
        <div className="empty mn-empty">
          <div className="t">当前还没有已完善的角色</div>
          <div>
            点击
            <Link className="btn btn-sm mn-empty-btn" to="/data">数据录入</Link>
            前往登记角色
          </div>
        </div>
      ) : (
        <>
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
                placeholder="搜索：中文名 / 英文名 / 资源号 / 拼音首字母"
                spellCheck={false}
              />
              {search ? (
                <button type="button" className="search-clear" onClick={() => setSearch('')} aria-label="清空搜索">×</button>
              ) : null}
            </label>

            {/* 属性已抽成下面那行独立按钮，这里把它从下拉里藏掉，避免同一维度两个控件 */}
            <FilterBar
              selected={selected}
              toggles={toggles}
              activeCount={activeCount}
              hiddenGroups={['element']}
              onToggleOption={toggleOption}
              onToggleSwitch={toggleSwitch}
              onClear={clearFilters}
            />

            <span className="mn-elements">
              {ELEMENT_BUTTONS.map((item) => {
                const count = elementCounts.get(item.label) || 0
                const active = element === item.label
                return (
                  <button
                    key={item.label}
                    type="button"
                    className={active ? 'mn-element active' : 'mn-element'}
                    style={active ? { '--el-color': elementColorOf(item.value) } : undefined}
                    disabled={count === 0}
                    aria-pressed={active}
                    title={count === 0 ? `没有已完善的${item.label}角色` : `${item.label} ${count} 名`}
                    onClick={() => setElement(active ? '' : item.label)}
                  >
                    {item.icon ? <img src={assetUrl(item.icon)} alt="" /> : null}
                    <span>{item.label}</span>
                    <b>{count}</b>
                  </button>
                )
              })}

              <span className="spacer" />

              <div className="zoom" role="group" aria-label="列表缩放">
                {ZOOM_PRESETS.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    className={item.key === zoom ? 'active' : ''}
                    onClick={() => setZoom(item.key)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </span>
          </div>

          {filtered.length > 0 ? (
            groups.map((group) => (
              <section className="mn-group" key={group.label || 'unknown'}>
                <h2
                  className="mn-group-head"
                  style={group.label ? { color: elementColorOf(ELEMENT_BUTTONS.find((item) => item.label === group.label)?.value) } : undefined}
                >
                  {group.label || '其他'}
                  <b>{group.characters.length}</b>
                </h2>
                <CharacterGrid characters={group.characters} tileSize={zoomPreset.size} />
              </section>
            ))
          ) : (
            <div className="empty">
              <div className="t">没有匹配的角色</div>
              <div>换个关键词，或调整筛选条件</div>
            </div>
          )}
        </>
      )}
    </main>
  )
}
