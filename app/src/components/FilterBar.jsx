import { useEffect, useRef, useState } from 'react'
import { TAXONOMY, assetUrl } from '../lib/roster.js'

const SWITCHES = [
  { key: 'cnPublished', label: '国服已实装' },
  { key: 'collectible', label: '珍藏品' },
  { key: 'overSpec', label: '超标准' },
]

/**
 * 6 组分类下拉 + 3 个开关 + 清空筛选。
 * 交互约定（沿用既有工具习惯）：点选项不收起下拉，点外部或 Esc 收起，点另一组直接切换。
 *
 * hiddenGroups：要隐藏的分类组 key（如 'element'）。「我的妮姬」页把属性抽成了独立按钮行，
 * 就靠这个把这个下拉藏起来，而不是在组件里判断是哪个页面在用。
 */
export default function FilterBar({
  selected,
  toggles,
  activeCount,
  onToggleOption,
  onToggleSwitch,
  onClear,
  hiddenGroups = [],
}) {
  const [openKey, setOpenKey] = useState(null)
  const rootRef = useRef(null)
  const groups = TAXONOMY.filters.filter((group) => !hiddenGroups.includes(group.key))

  useEffect(() => {
    if (!openKey) return undefined
    const onPointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpenKey(null)
    }
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpenKey(null)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [openKey])

  return (
    <div className="fbar" ref={rootRef}>
      {groups.map((group) => {
        const chosen = selected[group.key] || []
        const open = openKey === group.key
        return (
          <div key={group.key} className={open ? 'fgroup open' : 'fgroup'}>
            <button
              type="button"
              className={chosen.length ? 'fgroup-btn has' : 'fgroup-btn'}
              aria-expanded={open}
              onClick={() => setOpenKey(open ? null : group.key)}
            >
              {group.label}
              {chosen.length > 0 && <span className="badge">{chosen.length}</span>}
              <span className="caret">▾</span>
            </button>
            {open && (
              <div className="fpop">
                {group.options.map((option) => {
                  const active = chosen.includes(option.value)
                  return (
                    <button
                      key={option.value}
                      type="button"
                      className={active ? 'fopt active' : 'fopt'}
                      onClick={() => onToggleOption(group.key, option.value)}
                    >
                      <img src={assetUrl(option.icon)} alt="" />
                      <span className="name">{option.label}</span>
                      {active && <span className="check">✓</span>}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}

      <span className="sep" />

      {SWITCHES.map((item) => (
        <button
          key={item.key}
          type="button"
          className={toggles[item.key] ? 'switch on' : 'switch'}
          aria-pressed={Boolean(toggles[item.key])}
          onClick={() => onToggleSwitch(item.key)}
        >
          <span className="track" />
          {item.label}
        </button>
      ))}

      {activeCount > 0 && (
        <button type="button" className="link-btn" onClick={onClear}>
          清空筛选 ({activeCount})
        </button>
      )}
    </div>
  )
}