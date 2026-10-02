// 装备词条识别弹窗：四路输入（拖拽 / 粘贴 / 选择文件 / 屏幕抓帧）→ 识别 → 逐行核对 → 应用到该部位
// 识别核心与资源加载分别在 src/lib/ocr/equipment.js 与 assets.js，本组件只负责交互
import { useEffect, useRef, useState } from 'react'
import { AFFIX_TIER_VALUES, FUNCTION_LABELS, affixTierText } from '../data/affixTiers.js'
import { recognizeEquipment } from '../lib/ocr/equipment.js'
import { captureScreenFrame, imageDataFromBlob, isScreenCaptureSupported, loadOcrAssets } from '../lib/ocr/assets.js'

const FUNCTION_OPTIONS = Object.entries(FUNCTION_LABELS)

/** 捕获源类型 → 中文说明（抓帧诊断显示用） */
const SURFACE_LABELS = { window: '单个窗口', monitor: '整个显示器', browser: '浏览器标签页' }

/** Blob → dataURL（本次识别图片的预览与下载用） */
const blobToDataUrl = (blob) => new Promise((resolve) => {
  const reader = new FileReader()
  reader.onload = () => resolve(reader.result)
  reader.onerror = () => resolve(null)
  reader.readAsDataURL(blob)
})

/** 识别输出 → 弹窗可编辑行（数值只允许档位值：吸附成功才有 level，失败留空并保留“需核对”） */
const toEditableRows = (rows) => rows.map((row) => (row.empty
  ? { position: row.position, empty: true, functionType: '', level: null, confidence: null }
  : {
    position: row.position,
    empty: false,
    functionType: row.functionType || '',
    level: row.tier ?? null,
    confidence: row.confidence || null,
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
        <option value="">未获得效果</option>
        {FUNCTION_OPTIONS.map(([code, label]) => (
          <option key={code} value={code}>{label}</option>
        ))}
      </select>
      <select
        className="inp inp-sm"
        ref={tierSelectRef}
        value={row.level ?? ''}
        disabled={!row.functionType}
        onChange={(event) => onChange({ level: event.target.value ? Number(event.target.value) : null })}
      >
        <option value="">{row.functionType ? '请选择档位' : '—'}</option>
        {tiers
          ? tiers.map((_, index) => (
            <option key={index} value={index + 1}>{`第 ${index + 1} 档 · ${affixTierText(row.functionType, index + 1)}`}</option>
          ))
          : null}
      </select>
      <span className="ocr-flag-cell">
        {row.confidence === 'snapped' ? <span className="ocr-flag">已校正至档位</span> : null}
        {row.confidence === 'low' ? <span className="ocr-flag ocr-flag-warn">需核对</span> : null}
      </span>
    </div>
  )
}

export default function EquipmentOcrDialog({ open, slotLabel, onClose, onApply }) {
  const [phase, setPhase] = useState('idle') // idle | busy | done
  const [rows, setRows] = useState([])
  const [message, setMessage] = useState('')
  const [dragActive, setDragActive] = useState(false)
  const [captureInfo, setCaptureInfo] = useState(null)
  const fileRef = useRef(null)
  const screenCaptureSupported = isScreenCaptureSupported()

  const recognize = async (source, frame = null) => {
    // source：Blob（拖拽/粘贴/选文件）或 ImageData（屏幕抓帧）；frame 为抓帧附带的预览信息
    setPhase('busy')
    setMessage('')
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
      // 先让“识别中…”渲染出来，再跑同步识别（面板图约 1 秒，全屏图稍长）
      await new Promise((resolve) => { setTimeout(resolve, 40) })
      const result = recognizeEquipment(image, assets)
      if (result.panel === null) {
        setPhase('idle')
        setMessage('未检测到装备面板，请重新截图，或裁剪出装备面板后粘贴')
        return
      }
      if (result.rows.every((row) => row.empty)) {
        setPhase('idle')
        setMessage('未识别到改造装备词条，请确认截图为装备详情面板（含“改造装备效果”区域）')
        return
      }
      setRows(toEditableRows(result.rows))
      setPhase('done')
    } catch (error) {
      setPhase('idle')
      setMessage(error?.message || '识别失败，请重试')
    }
  }

  const capture = async () => {
    setMessage('')
    try {
      const frame = await captureScreenFrame()
      await recognize(frame.imageData, { dataUrl: frame.dataUrl, meta: frame.meta })
    } catch (error) {
      if (error?.name === 'NotAllowedError' || error?.name === 'AbortError') return // 用户取消了共享选择
      setMessage(error?.message || '抓屏失败，请重试')
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
      ? { ...row, ...patch, confidence: null }
      : row)))
  }

  const apply = () => {
    if (phase !== 'done') return
    onApply(rows.map(toEquipmentLine))
    onClose()
  }

  useEffect(() => {
    if (!open) return undefined
    setPhase('idle')
    setRows([])
    setMessage('')
    setDragActive(false)
    setCaptureInfo(null)
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
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
      <div className="dlg dlg-wide" role="dialog" aria-label="识别装备词条">
        <div className="dlg-head">
          <h2>识别装备词条 · {slotLabel}</h2>
          <button type="button" className="dlg-x" onClick={onClose} aria-label="关闭">×</button>
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
            <p className="ocr-drop-text">请将截图拖拽至此，或进行粘贴、选择本地文件</p>
            <div className="ocr-drop-actions">
              {screenCaptureSupported ? (
                <button type="button" className="btn btn-sm" onClick={capture} disabled={phase === 'busy'}>截图识别</button>
              ) : null}
              <button type="button" className="btn btn-sm" onClick={() => fileRef.current?.click()} disabled={phase === 'busy'}>
                选择文件
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
            <p className="ocr-hint">浏览器抓帧画面可能受到压缩影响；若识别结果与实际游戏多次出现不符的情况，建议改用系统截图（Win+Shift+S）或QQ等软件的截图后粘贴或拖入</p>
          ) : null}

          {captureInfo ? (
            <div className="ocr-capture">
              <img className="ocr-capture-thumb" src={captureInfo.dataUrl} alt="本次识别图片预览" />
              <div className="ocr-capture-side">
                <b>本次识别图片</b>
                <span>
                  {captureInfo.meta
                    ? `${captureInfo.meta.displaySurface}${SURFACE_LABELS[captureInfo.meta.displaySurface] ? `（${SURFACE_LABELS[captureInfo.meta.displaySurface]}）` : ''} · `
                    : ''}
                  {captureInfo.width}×{captureInfo.height}
                </span>
                <button type="button" className="btn btn-sm" onClick={downloadCapture}>下载图片</button>
              </div>
            </div>
          ) : null}

          {phase === 'busy' ? <p className="ocr-status">识别中…</p> : null}
          {message ? <p className="dlg-error">{message}</p> : null}

          {phase === 'done' ? (
            <div className="ocr-rows">
              {rows.map((row) => (
                <OcrRow key={row.position} row={row} onChange={(patch) => updateRow(row.position, patch)} />
              ))}
              <p className="ocr-note">请逐行核对后应用；“未获得效果”行将保持空白。</p>
            </div>
          ) : null}
        </div>

        <div className="dlg-foot">
          <button type="button" className="btn" onClick={onClose}>取消</button>
          <button type="button" className="btn btn-primary" onClick={apply} disabled={phase !== 'done'}>应用</button>
        </div>
      </div>
    </div>
  )
}