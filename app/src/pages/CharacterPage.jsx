import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { toBlob } from 'html-to-image'
import CharacterCard from '../components/card/CharacterCard.jsx'
import CardPreviewDialog from '../components/CardPreviewDialog.jsx'
import ExportDialog from '../components/ExportDialog.jsx'
import ShareCodeDialog from '../components/ShareCodeDialog.jsx'
import { CARD_HEIGHT, CARD_WIDTH, DEFAULT_MODULES, MODULE_OPTIONS } from '../lib/cardLayout.js'
import { assetUrl, displayName, findCharacter } from '../lib/roster.js'
import { getResearch, getSynchroLevel, loadRecord, saveRecord, subscribeProfiles } from '../lib/profileStore.js'
import { encodeShareCode, loadShareFields } from '../lib/shareCode.js'
import { getTestProfile } from '../data/testProfiles.js'
import { t, tData } from '../lib/i18n.js'

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
const pad = (value) => String(value).padStart(2, '0')
const sanitize = (value) => String(value ?? '').replace(/[\\/:*?"<>|]/g, '_').trim()
const formatTime = (iso) => {
  if (!iso) return ''
  const date = new Date(iso)
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const DEFAULT_TRANSFORM = { offsetX: 50, offsetY: 0, scale: 100 }

export default function CharacterPage() {
  const { code } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const character = findCharacter(code)
  const sample = useMemo(() => getTestProfile(code), [code])
  const storedRecord = useMemo(() => loadRecord(code), [code])

  const [record, setRecord] = useState(storedRecord ?? sample ?? {})
  // 装备面板大小（%）：随档案保存，控制四件装备与词条合计的整体缩放（滑块上限 150）
  const panelScale = record.panelScale ?? 150
  const [hasStored, setHasStored] = useState(Boolean(storedRecord))
  const [dirty, setDirty] = useState(false)
  const [savedAt, setSavedAt] = useState(storedRecord?.updatedAt ?? null)
  const [modules, setModules] = useState(DEFAULT_MODULES)
  const [artworkId, setArtworkId] = useState('default')
  const [transform, setTransform] = useState(DEFAULT_TRANSFORM)
  const [signature, setSignature] = useState({ enabled: false, text: '' })
  const [transparent, setTransparent] = useState(false)
  const [ratio, setRatio] = useState(3)
  const [fileName, setFileName] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const [previewOpen, setPreviewOpen] = useState(false)
  // 预览大小：'auto' = 自适应（卡片高度对齐右侧配置栏）；数字 = 手动档位（百分比）
  const [previewZoom, setPreviewZoom] = useState('auto')
  const [fitScale, setFitScale] = useState(0.6)
  // 同步器等级 / 研究等级（均为存档级）；切换存档或别处改动后即时刷新
  const [synchroLevel, setSynchroLevelState] = useState(() => getSynchroLevel())
  const [research, setResearchState] = useState(() => getResearch())
  const [shareOpen, setShareOpen] = useState(false)
  const [shareCode, setShareCode] = useState('')
  const [shareError, setShareError] = useState('')
  const [sharing, setSharing] = useState(false)

  const cardRef = useRef(null)
  const stageRef = useRef(null)
  const dragRef = useRef(null)

  const artworks = character?.artworks || []
  const artwork = artworks.find((item) => item.id === artworkId) || artworks[0] || null

  // 切换角色：装入本机档案（无则用示例档案）
  useEffect(() => {
    const stored = loadRecord(code)
    const initial = stored ?? getTestProfile(code) ?? {}
    setRecord(initial)
    setHasStored(Boolean(stored))
    setSavedAt(stored?.updatedAt ?? null)
    setDirty(false)
    const artworkInit = initial.artwork || {}
    setArtworkId(artworkInit.id || 'default')
    setTransform({
      offsetX: artworkInit.offsetX ?? DEFAULT_TRANSFORM.offsetX,
      offsetY: artworkInit.offsetY ?? DEFAULT_TRANSFORM.offsetY,
      scale: artworkInit.scale ?? DEFAULT_TRANSFORM.scale,
    })
    setSignature({ enabled: false, text: '' })
    setTransparent(false)
    setRatio(3)
    setFileName('')
    setExportError('')
  }, [code])

  const cardProfile = useMemo(
    () => ({ ...record, artwork: { id: artworkId, ...transform } }),
    [record, artworkId, transform],
  )

  // 订阅存档变更：切换存档或别处改同步器 / 研究等级后，卡片数值即时刷新
  useEffect(() => subscribeProfiles(() => {
    setSynchroLevelState(getSynchroLevel())
    setResearchState(getResearch())
  }), [])

  // 自动保存（防抖 400ms）：只有真正录入过数据的角色才落库
  useEffect(() => {
    if (!dirty || Object.keys(record).length === 0) return undefined
    const timer = setTimeout(() => {
      const saved = saveRecord(code, cardProfile)
      setSavedAt(saved.updatedAt)
      setHasStored(true)
      setDirty(false)
    }, 400)
    return () => clearTimeout(timer)
  }, [dirty, code, cardProfile, record])

  // 离开页面时的兜底保存：防抖窗口内点「返回」，改动也不丢
  const latestRef = useRef(null)
  useEffect(() => {
    latestRef.current = { code, profile: cardProfile, dirty }
  }, [code, cardProfile, dirty])
  useEffect(() => () => {
    const latest = latestRef.current
    if (latest?.dirty && Object.keys(latest.profile || {}).length) saveRecord(latest.code, latest.profile)
  }, [])

  // 预览自适应缩放（导出对象本身不缩放）
  // 自动档 = 适配「首屏可视」：卡片不高于 stage 顶部到视口底之间的剩余高度，
  // 打开页面整张卡一屏可见、不用滚（此前只看容器，容器与右栏等高，
  // 配置项一多就把卡放大到屏幕外）。手动 60/80/100 档仍按容器缩放、页面滚动看细节
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return undefined
    const update = () => {
      const room = Math.max(240, window.innerHeight - stage.getBoundingClientRect().top - 20)
      setFitScale(Math.min(
        1,
        stage.clientWidth / CARD_WIDTH,
        stage.clientHeight / CARD_HEIGHT,
        room / CARD_HEIGHT,
      ))
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(stage)
    // 视口高度变化不一定会改变 stage 尺寸（它跟着右栏长度走），要单独听 window
    window.addEventListener('resize', update)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [character])

  // 手动档位取真实值（如 100% 即原尺寸）；预览区放不下时可在其中滚动查看，不做缩小或裁切
  const cardScale = previewZoom === 'auto' ? fitScale : previewZoom / 100

  // 返回上一级：有历史则回退（列表 → 详情、详情 → 数据录入等均可原路返回），否则回列表
  const goBack = () => {
    if (location.key !== 'default') navigate(-1)
    else navigate('/')
  }

  if (!character) {
    return (
      <main className="page">
        <button type="button" className="back" onClick={goBack}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M12.5 8h-9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <path d="M7 4 3 8l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {t('返回')}
        </button>
        <div className="empty">
          <div className="t">{t('未找到该角色')}</div>
          <div>{t('资源号 {code} 不在当前名单中', { code })}</div>
        </div>
      </main>
    )
  }

  const toggleModule = (key) => setModules((prev) => ({ ...prev, [key]: !prev[key] }))

  const resetArtwork = () => {
    setTransform({
      offsetX: record.artwork?.offsetX ?? DEFAULT_TRANSFORM.offsetX,
      offsetY: record.artwork?.offsetY ?? DEFAULT_TRANSFORM.offsetY,
      scale: record.artwork?.scale ?? DEFAULT_TRANSFORM.scale,
    })
  }

  const onPointerDown = (event) => {
    dragRef.current = { x: event.clientX, y: event.clientY, offsetX: transform.offsetX, offsetY: transform.offsetY }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event) => {
    const drag = dragRef.current
    if (!drag) return
    const previewScale = cardScale || 1
    // 与卡片渲染的“位移随缩放联动”保持一致：拖动时换算需再除以立绘缩放，保证 1:1 拖动手感
    const artworkScale = (transform.scale ?? 100) / 100
    const dx = ((event.clientX - drag.x) / (CARD_WIDTH * previewScale * artworkScale)) * 100
    const dy = ((event.clientY - drag.y) / (CARD_HEIGHT * previewScale * artworkScale)) * 100
    setTransform((prev) => ({
      ...prev,
      offsetX: clamp(drag.offsetX + dx, 0, 100),
      offsetY: clamp(drag.offsetY + dy, -40, 40),
    }))
    setDirty(true)
  }

  const onPointerUp = (event) => {
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const buildFileName = () => {
    const now = new Date()
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`
    return `${sanitize(`NIKKE_${displayName(character)}_${tData(artwork?.label) || t('默认')}_${stamp}`)}.png`
  }

  const openExport = () => {
    if (!fileName) setFileName(buildFileName())
    setExportError('')
    setDialogOpen(true)
  }

  const handleExport = async () => {
    const node = cardRef.current
    if (!node) return
    setExporting(true)
    setExportError('')
    try {
      const blob = await toBlob(node, {
        pixelRatio: ratio,
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        backgroundColor: transparent ? undefined : '#f5f7f8',
        style: { transform: 'none', margin: '0' },
      })
      if (!blob) throw new Error(t('导出失败：未生成图片数据'))
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${sanitize(fileName || buildFileName()).replace(/\.png$/i, '')}.png`
      link.click()
      URL.revokeObjectURL(url)
      setDialogOpen(false)
    } catch (error) {
      setExportError(String(error?.message || error))
    } finally {
      setExporting(false)
    }
  }

  const hasRecord = Object.keys(record).length > 0

  // 分享到 BOT：把当前角色（含最新编辑）编码成 NKP2 分享码
  const openShare = () => {
    setShareOpen(true)
    setShareError('')
    setShareCode('')
    setSharing(true)
    try {
      // 复用「导出分享码」页保存的字段选择，保证两个入口导出的内容一致
      setShareCode(encodeShareCode({
        synchroLevel,
        research,
        characters: [{ nameCode: character.nameCode, record }],
        fields: loadShareFields(),
      }))
    } catch (error) {
      setShareError(String(error?.message || error))
    } finally {
      setSharing(false)
    }
  }
  const dataState = hasStored
    ? (dirty ? t('正在保存…') : (savedAt ? `${t('已保存到本机')} · ${formatTime(savedAt)}` : t('已保存到本机')))
    : sample
      ? t('示例数据（{label}）· 修改后自动保存到本机', { label: sample.label })
      : t('暂无录入数据')

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
        <div className="char-head">
          {character.avatar ? <img className="avatar" src={assetUrl(character.avatar)} alt={displayName(character)} /> : null}
          <div>
            <h1>{displayName(character)}</h1>
            <div className="desc">
              {character.nameEn} · {character.nameCode} · {dataState}
            </div>
          </div>
        </div>
        <div className="head-actions">
          <Link className="btn" to={`/data?code=${character.nameCode}`} state={{ from: 'character' }}>{t('编辑该角色数据')}</Link>
          <button type="button" className="btn" onClick={openShare} disabled={!hasRecord}>{t('分享到 BOT')}</button>
          <button type="button" className="btn btn-primary" onClick={openExport}>{t('导出图片')}</button>
        </div>
      </div>

      <div className="workspace">
        <div className="stage-wrap">
          <div className="stage" ref={stageRef}>
            <div className="card-scale" style={{ width: CARD_WIDTH * cardScale, height: CARD_HEIGHT * cardScale }}>
              <div
                className="card-inner"
                style={{ transform: `scale(${cardScale})` }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
              >
                <CharacterCard
                    cardRef={cardRef}
                    character={character}
                    profile={hasRecord ? cardProfile : null}
                    synchroLevel={synchroLevel}
                    research={research}
                    artwork={artwork}
                    transform={transform}
                    panelScale={panelScale}
                  modules={modules}
                  signature={signature}
                  transparent={transparent}
                />
              </div>
            </div>
          </div>
          <div className="stage-hint">
            <span>{t('在卡片上拖动可移动立绘 · 预览 {scale}%', { scale: Math.round(cardScale * 100) })}</span>
            <div className="hint-zoom">
              {[['auto', '自动'], [60, '60%'], [80, '80%'], [100, '100%']].map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={previewZoom === key ? 'active' : ''}
                  onClick={() => setPreviewZoom(key)}
                  title={key === 'auto' ? t('卡片高度与右侧配置栏对齐') : t('固定 {label} 显示', { label })}
                >
                  {t(label)}
                </button>
              ))}
            </div>
          </div>
        </div>

        <aside className="config">
          <section className="config-block">
            <h2>{t('立绘')}</h2>
            <label className="field">
              <span>{t('版本（{count} 个）', { count: artworks.length })}</span>
              <select
                value={artwork?.id || ''}
                onChange={(event) => {
                  setArtworkId(event.target.value)
                  setDirty(true)
                }}
              >
                {artworks.map((item) => (
                  <option key={item.id} value={item.id}>{tData(item.label)}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t('缩放 {value}%', { value: transform.scale })}</span>
              <input
                type="range" min="70" max="300" value={transform.scale}
                onChange={(event) => {
                  setTransform((prev) => ({ ...prev, scale: Number(event.target.value) }))
                  setDirty(true)
                }}
              />
            </label>
            <label className="field">
              <span>{t('水平位置 {value}', { value: Math.round(transform.offsetX) })}</span>
              <input
                type="range" min="0" max="100" value={transform.offsetX}
                onChange={(event) => {
                  setTransform((prev) => ({ ...prev, offsetX: Number(event.target.value) }))
                  setDirty(true)
                }}
              />
            </label>
            <label className="field">
              <span>{t('垂直位置 {value}', { value: Math.round(transform.offsetY) })}</span>
              <input
                type="range" min="-40" max="40" value={transform.offsetY}
                onChange={(event) => {
                  setTransform((prev) => ({ ...prev, offsetY: Number(event.target.value) }))
                  setDirty(true)
                }}
              />
            </label>
            <button type="button" className="btn btn-sm" onClick={resetArtwork}>{t('复位立绘')}</button>
          </section>

          <section className="config-block">
            <h2>{t('模块')}</h2>
            <div className="module-list">
              {MODULE_OPTIONS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  className={modules[option.key] ? 'switch switch-sm on' : 'switch switch-sm'}
                  aria-pressed={Boolean(modules[option.key])}
                  onClick={() => toggleModule(option.key)}
                >
                  <span className="track" />
                  {t(option.label)}
                </button>
              ))}
            </div>
          </section>

          <section className="config-block">
            <h2>{t('布局')}</h2>
            <label className="field">
              <span>{t('装备与词条合计大小 {value}%', { value: panelScale })}</span>
              <input
                type="range" min="80" max="150" value={panelScale}
                onChange={(event) => {
                  setRecord((prev) => ({ ...prev, panelScale: Number(event.target.value) }))
                  setDirty(true)
                }}
              />
            </label>
          </section>

          <section className="config-block">
            <h2>{t('导出')}</h2>
            <p className="config-note">{t('默认 3x（{w} × {h} px）PNG；倍率、背景与署名在弹窗内设置。', { w: CARD_WIDTH * 3, h: CARD_HEIGHT * 3 })}</p>
            <div className="config-actions">
              <button type="button" className="btn" onClick={() => setPreviewOpen(true)}>{t('放大预览')}</button>
              <button type="button" className="btn" onClick={openExport}>{t('导出设置…')}</button>
            </div>
          </section>
        </aside>
      </div>

      <ExportDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        ratio={ratio}
        onRatioChange={setRatio}
        transparent={transparent}
        onTransparentChange={setTransparent}
        signature={signature}
        onSignatureChange={setSignature}
        fileName={fileName}
        onFileNameChange={setFileName}
        exporting={exporting}
        error={exportError}
        onExport={handleExport}
      />

      <CardPreviewDialog open={previewOpen} onClose={() => setPreviewOpen(false)}>
        <CharacterCard
          character={character}
          profile={hasRecord ? cardProfile : null}
          synchroLevel={synchroLevel}
          research={research}
          artwork={artwork}
          transform={transform}
          modules={modules}
          signature={signature}
          transparent={transparent}
          panelScale={panelScale}
        />
      </CardPreviewDialog>

      <ShareCodeDialog
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        code={shareCode}
        count={1}
        loading={sharing}
        error={shareError}
      />
    </main>
  )
}