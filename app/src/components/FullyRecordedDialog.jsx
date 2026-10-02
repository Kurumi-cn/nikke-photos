import CharacterGrid from './CharacterGrid.jsx'
import FilterBar from './FilterBar.jsx'

/**
 * 角色一览弹窗：显示某个存档下「已完善」的角色。
 * 非当前存档为只读（网格不可点击），并提供「切换到当前档」。
 * 搜索 / 筛选状态由父组件持有，以便返回本页时恢复。
 */
export default function FullyRecordedDialog({
  profileName,
  isCurrent,
  characters,
  activeCount,
  search,
  selected,
  toggles,
  onSearchChange,
  onToggleOption,
  onToggleSwitch,
  onClear,
  onSwitchToCurrent,
  gridRef,
  onGridScroll,
  onClose,
}) {
  return (
    <div
      className="dlg-mask"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="dlg dlg-wide dlg-tall" role="dialog" aria-label={`${profileName} 角色一览`}>
        <div className="dlg-head">
          <h2>「{profileName}」已完善角色（{characters.length}）</h2>
          <button type="button" className="dlg-x" onClick={onClose} aria-label="关闭">×</button>
        </div>

        <div className="fr-toolbar">
          <label className="search">
            <span className="icon">
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.4" />
                <path d="M10.6 10.6L14 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </span>
            <input
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="搜索：中文名 / 英文名 / 资源号 / 拼音首字母"
              spellCheck={false}
            />
            {search ? (
              <button type="button" className="search-clear" onClick={() => onSearchChange('')} aria-label="清空搜索">×</button>
            ) : null}
          </label>

          <FilterBar
            selected={selected}
            toggles={toggles}
            activeCount={activeCount}
            onToggleOption={onToggleOption}
            onToggleSwitch={onToggleSwitch}
            onClear={onClear}
          />

          <span className="spacer" />

          {isCurrent ? (
            <span className="fr-current">当前存档</span>
          ) : (
            <button type="button" className="btn btn-sm" onClick={onSwitchToCurrent}>切换到当前档</button>
          )}
        </div>

        {!isCurrent ? (
          <p className="fr-readonly">该存档不是当前存档，角色一览仅供查看；点击「切换到当前档」后可进入角色详情。</p>
        ) : null}

        <div className="fr-body" ref={gridRef} onScroll={onGridScroll}>
          {characters.length > 0 ? (
            <div className={isCurrent ? 'fr-grid' : 'fr-grid is-readonly'}>
              <CharacterGrid characters={characters} tileSize="92px" />
            </div>
          ) : (
            <div className="empty">
              <div className="t">没有匹配的角色</div>
              <div>换个关键词，或调整筛选条件</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
