// 装备词条识别弹窗：四路输入（拖拽 / 粘贴 / 选择文件 / 屏幕抓帧）→ 识别 → 逐行核对 → 应用到该部位
// 识别入口与资源加载分别在 src/lib/ocr/equipment/engine.js 与 assets.js，本组件只负责交互
import { useEffect, useRef, useState } from 'react'
import { AFFIX_TIER_VALUES, FUNCTION_LABELS, affixTierText } from '../data/affixTiers.js'
import { recognizeEquipment } from '../lib/ocr/equipment/engine.js'
import { runShadowComparison } from '../lib/ocr/equipment/shadow.js'
import { captureScreenFrame, imageDataFromBlob, isScreenCaptureSupported, loadOcrAssets } from '../lib/ocr/assets.js'
import { LOCALE_HANT, currentLocale, t, tData } from '../lib/i18n.js'
import ConfirmDialog from './ConfirmDialog.jsx'

const FUNCTION_OPTIONS = Object.entries(FUNCTION_LABELS)

/** 捕获源类型 → 中文说明（抓帧诊断显示用） */
const SURFACE_LABELS = { window: '单个窗口', monitor: '整个显示器', browser: '浏览器标签页' }

/**
 * 引擎 warning code → 用户能看懂的一句话（规格 §4.4「全局提示位」）
 *
 * 只翻译**对用户有行动意义**的：`ROW_VALUE_UNRESOLVED` 之类在行级已经用角标表达了，
 * 列在这里只会变成噪声。没在表里的 code 不展示（仍然留在返回值里供排查）。
 */
const WARNING_LABELS = {
  PANEL_LOGO_MISSING: '未找到 OVERLOAD 标识，已改用备用算法识别，请重点核对',
  PANEL_SUSPECT: '面板边界不可靠，识别结果可能有偏差',
  ROW_DETECTION_FAILED: '未能稳定定位三条词条行，已改用备用算法识别',
  LEGACY_FALLBACK_USED: '已回退到备用（旧版）识别算法',
  ROI_CLIPPED: '数值区域疑似被裁切，请核对',
}

/** Blob → dataURL（本次识别图片的预览与下载用） */
const blobToDataUrl = (blob) => new Promise((resolve) => {
  const reader = new FileReader()
  reader.onload = () => resolve(reader.result)
  reader.onerror = () => resolve(null)
  reader.readAsDataURL(blob)
})

/** 识别输出 → 弹窗可编辑行（数值只允许档位值：吸附成功才有 level，失败留空并保留“需核对”） */
const toEditableRows = (rows) => rows.map((row) => (row.empty
  ? {
    position: row.position,
    status: row.status || 'empty',
    empty: true,
    functionType: '',
    level: null,
    confidence: null,
    snapped: false,
    snapReason: 'none',
    needsConfirm: false,
    flags: [],
  }
  : {
    position: row.position,
    status: row.status || 'ok',
    empty: false,
    functionType: row.functionType || '',
    level: row.tier ?? null,
    confidence: row.confidence || null,
    snapped: Boolean(row.snapped),
    snapReason: row.snapReason || 'none',
    needsConfirm: Boolean(row.needsConfirm),
    flags: Array.isArray(row.flags) ? row.flags : [],
  }))

/** 行 → 写回数据：值由档位表推出（数值只可能落在档位上）；未获得行 → null */
const toEquipmentLine = (row) => {
  if (row.empty || !row.functionType) return null
  const tiers = AFFIX_TIER_VALUES[row.functionType]
  if (!row.level || !tiers) return { functionType: row.functionType, level: null, value: null }
  return { functionType: row.functionType, level: row.level, value: tiers[row.level - 1] }
}

function OcrRow({ row, onChange }) {
  const tiers = row.functionType ? AFFIX_TIER_VALUES[row.functionType] : null
  const tierSelectRef = useRef(null)

  /** 选中词条后自动把交互推进到档位下拉：优先尝试展开（showPicker），被浏览器拦截时退化为聚焦 */
  const jumpToTiers = () => {
    window.setTimeout(() => {
      const element = tierSelectRef.current
      if (!element) return
      element.focus()
      try {
        if (typeof element.showPicker === 'function') element.showPicker()
      } catch {
        // 部分环境要求更强的用户手势才能展开，忽略即可（已聚焦，可直接键盘选择）
      }
    }, 0)
  }

  return (
    <div className="ocr-row">
      <span className="ocr-pos">{row.position}</span>
      <select
        className="inp inp-sm"
        value={row.functionType}
        onChange={(event) => {
          onChange({ functionType: event.target.value, empty: !event.target.value })
          if (event.target.value) jumpToTiers()
        }}
      >
        <option value="">{t('未获得效果')}</option>
        {FUNCTION_OPTIONS.map(([code, label]) => (
          <option key={code} value={code}>{tData(label)}</option>
        ))}
      </select>
      <select
        className="inp inp-sm"
        ref={tierSelectRef}
        value={row.level ?? ''}
        disabled={!row.functionType}
        onChange={(event) => onChange({ level: event.target.value ? Number(event.target.value) : null })}
      >
        <option value="">{row.functionType ? t('请选择档位') : '—'}</option>
        {tiers
          ? tiers.map((_, index) => (
            <option key={index} value={index + 1}>{t('第 {tier} 档 · {text}', { tier: index + 1, text: affixTierText(row.functionType, index + 1) })}</option>
          ))
          : null}
      </select>
      <span className="ocr-flag-cell">
        {row.snapped ? <span className="ocr-flag">{t('已校正至档位')}</span> : null}
        {row.needsConfirm ? <span className="ocr-flag ocr-flag-warn">{t('需核对')}</span> : null}
      </span>
    </div>
  )
}

export default function EquipmentOcrDialog({ open, slotLabel, onClose, onApply }) {
  const [phase, setPhase] = useState('idle') // idle | busy | done
  const [rows, setRows] = useState([])
  const [message, setMessage] = useState('')
  const [warnings, setWarnings] = useState([])
  const [dragActive, setDragActive] = useState(false)
  const [captureInfo, setCaptureInfo] = useState(null)
  /** >0 表示正在等「应用前二次确认」，值是需要确认的行数（规格 §4.5 / Q19=a） */
  const [confirmCount, setConfirmCount] = useState(0)
  const confirmCountRef = useRef(0)
  const fileRef = useRef(null)
  const screenCaptureSupported = isScreenCaptureSupported()

  const recognize = async (source, frame = null) => {
    // source：Blob（拖拽/粘贴/选文件）或 ImageData（屏幕抓帧）；frame 为抓帧附带的预览信息
    setPhase('busy')
    setMessage('')
    setWarnings([])
    try {
      const [image, assets, dataUrl] = await Promise.all([
        source instanceof Blob ? imageDataFromBlob(source) : Promise.resolve(source),
        loadOcrAssets(),
        frame?.dataUrl ?? (source instanceof Blob ? blobToDataUrl(source) : Promise.resolve(null)),
      ])
      // 预览：所有输入来源统一显示本次识别的图片
      if (dataUrl) {
        setCaptureInfo({ dataUrl, meta: frame?.meta ?? null, width: image.width, height: image.height, at: Date.now() })
      }
      // 先让“识别中…”渲染出来，再跑识别（v2 全屏图约 50~100ms）
      await new Promise((resolve) => { setTimeout(resolve, 40) })
      const result = await recognizeEquipment(image, { ...assets, engine: 'v2' })
      // 影子模式（规格 §8.4）：默认关闭。开启时在后台再跑一遍旧引擎做对照，
      // 只写控制台与 localStorage，**不改 UI**；因此不 await —— 旧引擎约 6~8s，等它会拖住界面。
      // （旧引擎跑在主线程上，ON 期间识别后会卡顿数秒，属预期，仅供开发短开。）
      runShadowComparison(image, assets, result).catch((error) => {
        console.warn('[OCR 影子] 对照失败：', error)
      })
      // 引擎级失败必须与“识别不出来”分开表达（规格 §4.3）：三行都置 unknown 并带 OCR_ENGINE_ERROR
      if (result.engineError) {
        setPhase('idle')
        setMessage(t('识别引擎出错，本次结果不可用：{message}', { message: result.engineError.message }))
        return
      }
      setWarnings((result.warnings || []).filter((code) => WARNING_LABELS[code]))
      if (result.panel === null) {
        setPhase('idle')
        setMessage(t('未检测到装备面板，请重新截图，或裁剪出装备面板后粘贴'))
        return
      }
      if (result.rows.every((row) => row.empty)) {
        setPhase('idle')
        setMessage(t('未识别到改造装备词条，请确认截图为装备详情面板（含“改造装备效果”区域）'))
        return
      }
      setRows(toEditableRows(result.rows))
      setPhase('done')
    } catch (error) {
      setPhase('idle')
      setMessage(error?.message || t('识别失败，请重试'))
    }
  }

  const capture = async () => {
    setMessage('')
    try {
      const frame = await captureScreenFrame()
      await recognize(frame.imageData, { dataUrl: frame.dataUrl, meta: frame.meta })
    } catch (error) {
      if (error?.name === 'NotAllowedError' || error?.name === 'AbortError') return // 用户取消了共享选择
      setMessage(error?.message || t('抓屏失败，请重试'))
    }
  }

  // 把本次识别的图片存下来，便于核对内容（抓帧异常时也便于反馈问题）
  const downloadCapture = () => {
    if (!captureInfo) return
    const link = document.createElement('a')
    link.href = captureInfo.dataUrl
    link.download = `nikke-ocr-image-${captureInfo.at}.png`
    link.click()
  }

  const updateRow = (position, patch) => {
    setRows((current) => current.map((row) => (row.position === position
      ? {
        ...row,
        ...patch,
        confidence: null,
        snapped: false,
        snapReason: 'none',
        needsConfirm: false,
        flags: [],
      }
      : row)))
  }

  const apply = () => {
    if (phase !== 'done') return
    // 存在未确认的行时先问一次（规格 §4.5 / Q19=a）；确认后正常写入，
    // 装备数据模型里**不保留**任何"未确认"状态。
    // 刻意**不**把「名称没读出来（functionType 为空）」的行排除在外：那种行写回去等于把该槽清空，
    // 恰恰是最该提醒的一类。
    const count = rows.filter((row) => row.needsConfirm).length
    if (count > 0) {
      confirmCountRef.current = count
      setConfirmCount(count)
      return
    }
    onApply(rows.map(toEquipmentLine))
    onClose()
  }

  const confirmApply = () => {
    confirmCountRef.current = 0
    setConfirmCount(0)
    onApply(rows.map(toEquipmentLine))
    onClose()
  }

  useEffect(() => {
    if (!open) return undefined
    setPhase('idle')
    setRows([])
    setMessage('')
    setWarnings([])
    setDragActive(false)
    setCaptureInfo(null)
    confirmCountRef.current = 0
    setConfirmCount(0)
    const onKeyDown = (event) => {
      // 二次确认弹窗自己有 Esc 处理；这里不能跟着关，否则会连识别结果一起丢掉
      if (event.key === 'Escape' && !confirmCountRef.current) onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  // 粘贴图片（弹窗打开时全局监听）
  useEffect(() => {
    if (!open) return undefined
    const onPaste = (event) => {
      const items = event.clipboardData?.items || []
      for (const item of items) {
        if (typeof item.type === 'string' && item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (file) {
            event.preventDefault()
            recognize(file)
          }
          return
        }
      }
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [open])

  if (!open) return null

  return (
    <div
      className="dlg-mask"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="dlg dlg-wide" role="dialog" aria-label={t('识别装备词条')}>
        <div className="dlg-head">
          <h2>{t('识别装备词条 · {slot}', { slot: slotLabel })}</h2>
          <button type="button" className="dlg-x" onClick={onClose} aria-label={t('关闭')}>×</button>
        </div>

        <div className="dlg-body">
          <div
            className={dragActive ? 'ocr-drop active' : 'ocr-drop'}
            onDragOver={(event) => {
              event.preventDefault()
              setDragActive(true)
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={(event) => {
              event.preventDefault()
              setDragActive(false)
              const file = [...(event.dataTransfer?.files || [])].find((item) => item.type.startsWith('image/'))
              if (file) recognize(file)
            }}
          >
            <p className="ocr-drop-text">{t('请将截图拖拽至此，或进行粘贴、选择本地文件')}</p>
            <div className="ocr-drop-actions">
              {screenCaptureSupported ? (
                <button type="button" className="btn btn-sm" onClick={capture} disabled={phase === 'busy'}>{t('截图识别')}</button>
              ) : null}
              <button type="button" className="btn btn-sm" onClick={() => fileRef.current?.click()} disabled={phase === 'busy'}>
                {t('选择文件')}
              </button>
            </div>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) recognize(file)
            }}
          />

          {screenCaptureSupported ? (
            <p className="ocr-hint">{t('浏览器抓帧画面可能受到压缩影响；若识别结果与实际游戏多次出现不符的情况，建议改用系统截图（Win+Shift+S）或QQ等软件的截图后粘贴或拖入')}</p>
          ) : null}
          <p className="ocr-hint">{t('识别效果在 1920×1080 分辨率下最佳；截图请包含完整的装备面板（含 OVERLOAD 标识）')}</p>
          {currentLocale() === LOCALE_HANT ? (
            <p className="ocr-hint">{t('识别用的字符模板取自简体客户端，繁中客户端的截图可能识别不准，建议改用手动填写')}</p>
          ) : null}

          {captureInfo ? (
            <div className="ocr-capture">
              <img className="ocr-capture-thumb" src={captureInfo.dataUrl} alt={t('本次识别图片预览')} />
              <div className="ocr-capture-side">
                <b>{t('本次识别图片')}</b>
                <span>
                  {captureInfo.meta
                    ? `${captureInfo.meta.displaySurface}${SURFACE_LABELS[captureInfo.meta.displaySurface] ? `（${t(SURFACE_LABELS[captureInfo.meta.displaySurface])}）` : ''} · `
                    : ''}
                  {captureInfo.width}×{captureInfo.height}
                </span>
                <button type="button" className="btn btn-sm" onClick={downloadCapture}>{t('下载图片')}</button>
              </div>
            </div>
          ) : null}

          {phase === 'busy' ? <p className="ocr-status">{t('识别中…')}</p> : null}
          {message ? <p className="dlg-error">{message}</p> : null}
          {warnings.length > 0 ? (
            <ul className="ocr-warn-list">
              {warnings.map((code) => <li key={code}>{t(WARNING_LABELS[code])}</li>)}
            </ul>
          ) : null}

          {phase === 'done' ? (
            <div className="ocr-rows">
              {rows.map((row) => (
                <OcrRow key={row.position} row={row} onChange={(patch) => updateRow(row.position, patch)} />
              ))}
              <p className="ocr-note">{t('请逐行核对后应用；“未获得效果”行将保持空白。')}</p>
            </div>
          ) : null}
        </div>

        <div className="dlg-foot">
          <button type="button" className="btn" onClick={onClose}>{t('取消')}</button>
          <button type="button" className="btn btn-primary" onClick={apply} disabled={phase !== 'done'}>{t('应用')}</button>
        </div>
      </div>

      {confirmCount > 0 ? (
        <ConfirmDialog
          title="应用识别结果"
          message={`检测到 ${confirmCount} 条结果需要确认，是否仍然应用？`}
          confirmText="仍然应用"
          onConfirm={confirmApply}
          onClose={() => {
            confirmCountRef.current = 0
            setConfirmCount(0)
          }}
        />
      ) : null}
    </div>
  )
}