// 「编辑表格角色」弹窗：词条统计表的名单与署名都在这儿改
//
// 筛选与分组网格照搬「我的妮姬」页（同一批候选：四件装备齐的角色），属性按钮直接
// 复用 myNikke.css 的 .mn-element 样式，保证两处观感一致；
// 点一下选入、再点一下移出——即时生效，没有「确定/取消」，关掉弹窗就是完成。
import { useMemo, useState } from 'react'
import FilterBar from './FilterBar.jsx'
import { TAXONOMY, applyFilters, assetUrl, countActiveFilters, findCharacter, iconFor } from '../lib/roster.js'
import { CREDIT_MAX } from '../lib/statsCredit.js'
import { ELEMENT_ORDER, elementColorOf, elementLabelOf } from '../lib/statsModel.js'
import '../styles/myNikke.css'

const NO_SELECTION = {}
const DEFAULT_TOGGLES = { cnPublished: false, collectible: false, overSpec: false }

// 属性按钮：顺序取 ELEMENT_ORDER（燃烧→水冷→风压→电击→铁甲），图标色沿用 taxonomy
const ELEMENT_OPTIONS = TAXONOMY.filters.find((group) => group.key === 'element')?.options || []
const ELEMENT_BUTTONS = ELEMENT_ORDER.map((label) => {
  const option = ELEMENT_OPTIONS.find((item) => item.label === label) || {}
  return { label, value: option.value || label, icon: option.icon || '' }
})

export default function EditTableDialog({
  characters, selectedCodes, credit, onToggle, onClear, onCreditChange, onClose,
}) {
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(NO_SELECTION)
  const [toggles, setToggles] = useState(DEFAULT_TOGGLES)
  const [element, setElement] = useState('')
  /** 只看已选：按选择顺序单组列出，方便核对表格行序 */
  const [onlySelected, setOnlySelected] = useState(false)

  // 已选角色的序号（1 起）——就是它在表格里的行号
  const orderMap = useMemo(
    () => new Map(selectedCodes.map((code, index) => [code, index + 1])),
    [selectedCodes],
  )

  // 属性按钮之外的条件先应用一遍：按钮上的数量按「其他筛选都生效后」统计（与我的妮姬同口径）
  const scoped = useMemo(
    () => applyFilters(characters, { search, selected, toggles }),
    [characters, search, selected, toggles],
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
      .map(([label, list]) => ({ label, characters: list }))
  }, [filtered])

  // 「查看已选择」：按选择顺序（= 表格行序）单组列出
  const chosen = useMemo(() => selectedCodes.map(findCharacter).filter(Boolean), [selectedCodes])

  const activeCount = countActiveFilters(selected, toggles) + (element ? 1 : 0)

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

  const renderGrid = (list) => (
    <div className="et-grid">
      {list.map((character) => {
        const order = orderMap.get(character.nameCode)
        const elementIcon = iconFor('element', character.element)
        const burstIcon = iconFor('use_burst_skill', character.use_burst_skill)
        return (
          <button
            key={character.nameCode}
            type="button"
            className={order ? 'tile et-tile is-selected' : 'tile et-tile'}
            title={order ? `第 ${order} 行 · 再点移出` : '点击加入表格'}
            onClick={() => onToggle(character.nameCode)}
          >
            <div className="thumb">
              {character.avatar ? (
                <img src={assetUrl(character.avatar)} alt="" loading="lazy" decoding="async" />
              ) : (
                <span className="ph">无头像</span>
              )}
              {elementIcon ? (
                <img className="elem" src={assetUrl(elementIcon)} alt="" title={elementLabelOf(character.element)} />
              ) : null}
              {burstIcon ? <img className="burst" src={assetUrl(burstIcon)} alt="" /> : null}
              {order ? <span className="et-order">{order}</span> : null}
            </div>
            <div className="name">{character.nameCn}</div>
          </button>
        )
      })}
    </div>
  )

  return (
    <div
      className="dlg-mask"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="dlg et-dialog" role="dialog" aria-label="编辑表格角色">
        <div className="dlg-head">
          <h2>编辑表格角色</h2>
          <button type="button" className="dlg-x" onClick={onClose} aria-label="关闭">×</button>
        </div>

        <div className="et-credit">
          <label className="dlg-label" htmlFor="et-credit-input">表格署名</label>
          <input
            id="et-credit-input"
            className="dlg-input et-credit-input"
            value={credit}
            maxLength={CREDIT_MAX}
            placeholder={`选填，最多 ${CREDIT_MAX} 字`}
            onChange={(event) => onCreditChange(event.target.value)}
          />
          <span className="et-credit-hint">显示在表格左上角，随图片一起导出</span>
        </div>

        <div className="et-toolbar">
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

          {/* 属性已抽成下一行的独立按钮，这里把它从下拉里藏掉，避免同一维度两个控件 */}
          <FilterBar
            selected={selected}
            toggles={toggles}
            activeCount={activeCount}
            hiddenGroups={['element']}
            onToggleOption={toggleOption}
            onToggleSwitch={toggleSwitch}
            onClear={clearFilters}
          />
        </div>

        <div className="et-toolbar">
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
                title={count === 0 ? `没有可统计的${item.label}角色` : `${item.label} ${count} 名`}
                onClick={() => setElement(active ? '' : item.label)}
              >
                {item.icon ? <img src={assetUrl(item.icon)} alt="" /> : null}
                <span>{item.label}</span>
                <b>{count}</b>
              </button>
            )
          })}

          <span className="spacer" />

          <button
            type="button"
            className="btn btn-sm"
            disabled={selectedCodes.length === 0}
            title={selectedCodes.length === 0 ? '还没有选中任何角色' : '把已选角色全部移出表格'}
            onClick={onClear}
          >
            清空全部选中
          </button>

          <button
            type="button"
            className={onlySelected ? 'btn btn-sm et-only is-on' : 'btn btn-sm et-only'}
            onClick={() => setOnlySelected((prev) => !prev)}
          >
            {onlySelected ? '显示全部角色' : `查看已选择 ${selectedCodes.length}`}
          </button>
        </div>

        <div className="et-body">
          {onlySelected ? (
            chosen.length > 0 ? renderGrid(chosen) : (
              <div className="empty">
                <div className="t">还没有选任何角色</div>
                <div>在上面的列表里点击头像即可加入表格</div>
              </div>
            )
          ) : (
            groups.length > 0 ? groups.map((group) => (
              <section className="mn-group" key={group.label || 'unknown'}>
                <h2
                  className="mn-group-head"
                  style={group.label ? {
                    color: elementColorOf(ELEMENT_BUTTONS.find((item) => item.label === group.label)?.value),
                  } : undefined}
                >
                  {group.label || '其他'}
                  <b>{group.characters.length}</b>
                </h2>
                {renderGrid(group.characters)}
              </section>
            )) : (
              <div className="empty">
                <div className="t">没有匹配的角色</div>
                <div>换个关键词，或调整筛选条件</div>
              </div>
            )
          )}
        </div>

        <div className="dlg-foot et-foot">
          <span className="et-foot-note">已选 {selectedCodes.length} 名 · 点选顺序即表格行序</span>
          <button type="button" className="btn btn-primary" onClick={onClose}>完成</button>
        </div>
      </div>
    </div>
  )
}