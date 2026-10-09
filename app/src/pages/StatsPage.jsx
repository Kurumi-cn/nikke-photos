// 词条统计页：页面以统计表为主体；角色的增删收在「编辑表格角色」大弹窗里
//（弹窗照搬「我的妮姬」的筛选与分组网格，点选即时生效）
// 支持按属性排列、拖拽调整行序、表格左上角署名、放大预览与导出高清 PNG
import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { toBlob } from 'html-to-image'
import CardPreviewDialog from '../components/CardPreviewDialog.jsx'
import EditTableDialog from '../components/EditTableDialog.jsx'
import ShareCodeDialog from '../components/ShareCodeDialog.jsx'
import { CHARACTERS, displayName, findCharacter } from '../lib/roster.js'
import { loadRecord } from '../lib/profileStore.js'
import { encodeTableShareCode } from '../lib/shareCode.js'
import { loadStatsCredit, saveStatsCredit } from '../lib/statsCredit.js'
import { loadStatsSelection, saveStatsSelection, sortCodesByElement } from '../lib/statsSelection.js'
import {
  STATS_COLUMNS,
  buildCharacterStats,
  cellToneOf,
  elementColorOf,
  isFullyRecorded,
} from '../lib/statsModel.js'
import { t } from '../lib/i18n.js'
import '../styles/stats.css'

const pad = (value) => String(value).padStart(2, '0')
const stamp = () => {
  const now = new Date()
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`
}

/** 统计表本体（导出目标；预览弹窗内复用，不接拖拽） */
function StatsSheet({ rows, sheetRef, drag, credit = '' }) {
  return (
    <div className="st-sheet" ref={sheetRef}>
      <table className="st-table">
        <thead>
          <tr>
            <th className="st-corner" aria-label={t('署名')}>
              {credit ? <span className="st-credit">{credit}</span> : null}
            </th>
            {STATS_COLUMNS.map((column) => <th key={column.key}>{t(column.label)}</th>)}
            <th>{t('阶数')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ character, stats }, index) => {
            const draggable = Boolean(drag)
            return (
              <tr
                key={character.nameCode}
                className={[
                  'st-row',
                  draggable && drag.index === index ? 'dragging' : '',
                  draggable && drag.overIndex === index && drag.index !== index ? 'drop-target' : '',
                ].filter(Boolean).join(' ')}
                draggable={draggable}
                onDragStart={draggable ? (event) => {
                  drag.onStart(index)
                  event.dataTransfer.effectAllowed = 'move'
                  event.dataTransfer.setData('text/plain', String(index))
                } : undefined}
                onDragOver={draggable ? (event) => {
                  event.preventDefault()
                  event.dataTransfer.dropEffect = 'move'
                  drag.onOver(index)
                } : undefined}
                onDrop={draggable ? (event) => {
                  event.preventDefault()
                  drag.onDrop(index)
                } : undefined}
                onDragEnd={draggable ? () => drag.onEnd() : undefined}
              >
                <td className="st-name" style={{ color: elementColorOf(character.element) || undefined }}>
                  {displayName(character)}
                </td>
                {STATS_COLUMNS.map((column) => {
                  const cell = stats.byFunction[column.key]
                  if (!cell) return <td key={column.key} className="st-cell" />
                  return (
                    <td key={column.key} className={`st-cell ${cellToneOf(cell.level)}`}>
                      {`${cell.value.toFixed(2)}%`}
                    </td>
                  )
                })}
                <td className="st-tier">{stats.tierScore}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default function StatsPage() {
  const navigate = useNavigate()
  const location = useLocation()
  // 名单存到会话里：BOT 分享页的「表格设置」要读同一份顺序，不能只活在组件状态里
  const [selectedCodes, setSelectedCodes] = useState(() => loadStatsSelection())
  // 署名：全局一份（本机浏览器），与存档、会话无关
  const [credit, setCredit] = useState(() => loadStatsCredit())
  const [editOpen, setEditOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [tableCodeOpen, setTableCodeOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [message, setMessage] = useState('')
  const [dragIndex, setDragIndex] = useState(-1)
  const [overIndex, setOverIndex] = useState(-1)
  const sheetRef = useRef(null)
  const dragIndexRef = useRef(-1)

  useEffect(() => {
    saveStatsSelection(selectedCodes)
  }, [selectedCodes])

  useEffect(() => {
    saveStatsCredit(credit)
  }, [credit])

  // 待选：四件装备都已录入的档案；选中顺序即表格行顺序
  const candidates = useMemo(
    () => CHARACTERS
      .map((character) => ({ character, record: loadRecord(character.nameCode) }))
      .filter(({ record }) => isFullyRecorded(record)),
    [],
  )
  const candidateCharacters = useMemo(() => candidates.map(({ character }) => character), [candidates])

  const rows = useMemo(
    () => selectedCodes
      .map((code) => ({
        character: findCharacter(code),
        stats: buildCharacterStats(loadRecord(code)),
      }))
      .filter((row) => row.character),
    [selectedCodes],
  )

  const toggleCharacter = (code) => {
    setSelectedCodes((prev) => (prev.includes(code) ? prev.filter((item) => item !== code) : [...prev, code]))
  }

  // 从「BOT 分享」的表格设置跳进来才显示返回；从顶部 Tab 直接进入则没有上级
  const fromBotShare = location.state?.from === 'bot-share'
  const goBack = () => {
    if (location.key !== 'default') navigate(-1)
    else navigate('/bot-share')
  }

  const sortByElement = () => setSelectedCodes((prev) => sortCodesByElement(prev))

  // 表格配置码（NKP2 类型 1）：只带角色号与行序，练度数据由 BOT 从对方自己的存档里取
  const { tableCode, tableCodeError } = useMemo(() => {
    if (selectedCodes.length === 0) return { tableCode: '', tableCodeError: '' }
    try {
      return { tableCode: encodeTableShareCode({ nameCodes: selectedCodes }), tableCodeError: '' }
    } catch (error) {
      return { tableCode: '', tableCodeError: String(error?.message || error) }
    }
  }, [selectedCodes])

  // 拖拽排序（HTML5 DnD）：从 dragIndexRef 拖到目标行位置
  const drag = {
    index: dragIndex,
    overIndex,
    onStart: (index) => {
      dragIndexRef.current = index
      setDragIndex(index)
    },
    onOver: (index) => setOverIndex(index),
    onDrop: (index) => {
      const from = dragIndexRef.current
      setDragIndex(-1)
      setOverIndex(-1)
      dragIndexRef.current = -1
      if (from < 0 || from === index) return
      setSelectedCodes((prev) => {
        const next = [...prev]
        const [item] = next.splice(from, 1)
        next.splice(index, 0, item)
        return next
      })
    },
    onEnd: () => {
      setDragIndex(-1)
      setOverIndex(-1)
      dragIndexRef.current = -1
    },
  }

  const handleExport = async () => {
    const node = sheetRef.current
    if (!node || rows.length === 0) return
    setExporting(true)
    setMessage('')
    try {
      if (document.fonts?.ready) await document.fonts.ready
      const blob = await toBlob(node, {
        pixelRatio: 3,
        backgroundColor: '#ffffff',
        style: { margin: '0' },
      })
      if (!blob) throw new Error(t('导出失败：未生成图片数据'))
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `nikke-${t('词条统计')}-${stamp()}.png`
      link.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      setMessage(String(error?.message || error))
    } finally {
      setExporting(false)
    }
  }

  return (
    <main className="page">
      {fromBotShare ? (
        <button type="button" className="back" onClick={goBack}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M12.5 8h-9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <path d="M7 4 3 8l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {t('返回')}
        </button>
      ) : null}

      <div className="page-head">
        <div>
          <h1>{t('词条统计')}</h1>
          <div className="desc">{t('汇总已录入角色的装备词条累加值；可拖拽行排序、按属性排列，导出高清图片或给 BOT 的表格码')}</div>
        </div>
        <button type="button" className="btn stats-edit-btn" onClick={() => setEditOpen(true)}>
          {t('编辑表格角色')}
        </button>
        <div className="head-actions">
          <button type="button" className="btn" onClick={sortByElement} disabled={rows.length < 2}>{t('按属性排列')}</button>
          <button type="button" className="btn" onClick={() => setPreviewOpen(true)} disabled={rows.length === 0}>{t('放大预览')}</button>
          <button type="button" className="btn" onClick={() => setTableCodeOpen(true)} disabled={rows.length === 0}>{t('导出表格码')}</button>
          <button type="button" className="btn btn-primary" onClick={handleExport} disabled={exporting || rows.length === 0}>
            {exporting ? t('导出中…') : t('导出图片')}
          </button>
        </div>
      </div>

      <section className="stats-main">
        <div className="stats-head">
          <span>
            {t('已选')} <strong>{rows.length}</strong> {t('名 · 可统计')} <strong>{candidates.length}</strong> {t('名（四件装备均已录入）')}
          </span>
          {rows.length > 0 ? (
            <button type="button" className="btn btn-sm" onClick={() => setSelectedCodes([])}>{t('清空')}</button>
          ) : null}
        </div>

        {rows.length > 0 ? (
          <StatsSheet rows={rows} sheetRef={sheetRef} drag={drag} credit={credit} />
        ) : (
          <div className="empty">
            <div className="t">{t('暂无角色')}</div>
            <div>{t('可点击上方「编辑表格角色」进行编辑')}</div>
          </div>
        )}

        {message ? <p className="dlg-error">{message}</p> : null}
      </section>

      <CardPreviewDialog open={previewOpen} onClose={() => setPreviewOpen(false)} autoSize>
        <StatsSheet rows={rows} credit={credit} />
      </CardPreviewDialog>

      {editOpen ? (
        <EditTableDialog
          characters={candidateCharacters}
          selectedCodes={selectedCodes}
          credit={credit}
          onToggle={toggleCharacter}
          onClear={() => setSelectedCodes([])}
          onCreditChange={setCredit}
          onClose={() => setEditOpen(false)}
        />
      ) : null}

      <ShareCodeDialog
        open={tableCodeOpen}
        onClose={() => setTableCodeOpen(false)}
        code={tableCode}
        count={selectedCodes.length}
        unit={t('行')}
        error={tableCodeError}
        title={t('表格配置码')}
        hint={t('发给 BOT：/妮姬导入 <表格码>，之后 /妮姬练度统计 就按这份名单和顺序出表。')}
      />
    </main>
  )
}