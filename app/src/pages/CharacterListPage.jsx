import { useEffect, useMemo, useState } from 'react'
import CharacterGrid from '../components/CharacterGrid.jsx'
import FilterBar from '../components/FilterBar.jsx'
import { CHARACTERS, applyFilters, countActiveFilters } from '../lib/roster.js'
import { ZOOM_PRESETS, loadGridZoom, saveGridZoom } from '../lib/gridZoom.js'
import { recordedCodes } from '../lib/profileStore.js'

const NO_SELECTION = {}
const DEFAULT_TOGGLES = { cnPublished: false, collectible: false, overSpec: false }

// 筛选状态按会话保存（sessionStorage）：点进角色再返回、刷新页面都能恢复
const FILTER_STORAGE_KEY = 'nikke-photos:list-filters'

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
    }
  } catch {
    return null
  }
}

export default function CharacterListPage() {
  const restored = useMemo(loadFilterState, [])
  const [search, setSearch] = useState(restored?.search ?? '')
  const [selected, setSelected] = useState(restored?.selected ?? NO_SELECTION)
  const [toggles, setToggles] = useState(restored?.toggles ?? DEFAULT_TOGGLES)
  const [zoom, setZoom] = useState(() => loadGridZoom())
  // 已录入角色集合：挂载时读一次（导入入口在「存档管理」页，回到本页时会重新挂载）
  const recorded = useMemo(() => new Set(recordedCodes()), [])

  // 筛选变化即写入会话存储（数据量很小，无需防抖）
  useEffect(() => {
    try {
      sessionStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify({ search, selected, toggles }))
    } catch {
      // 隐私模式等场景下存储不可用，忽略即可
    }
  }, [search, selected, toggles])

  // 缩放档位单独存一份，和「我的妮姬」页共用（见 lib/gridZoom.js）
  useEffect(() => { saveGridZoom(zoom) }, [zoom])

  const filtered = useMemo(
    () => applyFilters(CHARACTERS, { search, selected, toggles }),
    [search, selected, toggles],
  )
  const activeCount = countActiveFilters(selected, toggles)
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
  }

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>角色列表</h1>
          <div className="desc">点击角色进入角色详情：调整卡片并导出图片；数据录入见顶部「数据录入」页</div>
        </div>
        <div className="count">
          匹配 <strong>{filtered.length}</strong> / {CHARACTERS.length} 名
          {activeCount > 0 && ` · 已筛选 ${activeCount} 项`}
        </div>
      </div>

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

        <FilterBar
          selected={selected}
          toggles={toggles}
          activeCount={activeCount}
          onToggleOption={toggleOption}
          onToggleSwitch={toggleSwitch}
          onClear={clearFilters}
        />

        <span className="spacer" />

        <span className="archive-count">已录入 <strong>{recorded.size}</strong> 名</span>

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
      </div>

      {filtered.length > 0 ? (
        <CharacterGrid characters={filtered} tileSize={zoomPreset.size} recordedCodes={recorded} />
      ) : (
        <div className="empty">
          <div className="t">没有匹配的角色</div>
          <div>换个关键词，或调整筛选条件</div>
        </div>
      )}
    </main>
  )
}