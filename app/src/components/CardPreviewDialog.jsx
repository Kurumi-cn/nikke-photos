import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { CARD_HEIGHT, CARD_WIDTH } from '../lib/cardLayout.js'
import { t } from '../lib/i18n.js'

const ZOOMS = [
  { key: 'fit', label: '适应窗口' },
  { key: 1, label: '100%' },
  { key: 2, label: '200%' },
]

const MIN_SCALE = 0.25
const MAX_SCALE = 4

const clamp = (value) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, value))

/** 卡片放大预览层：导出前检查细节
 *  交互：三档缩放按钮 + 滚轮（以光标为中心）+ 放大后按住拖动平移 + 双击 /「适应窗口」返回原样
 *  autoSize：内容非固定尺寸（如词条统计表）时使用——按内容自然尺寸布局与缩放（卡片用法保持默认 736×1096） */
export default function CardPreviewDialog({ open, onClose, children, autoSize = false }) {
  const [zoom, setZoom] = useState('fit')
  const [fitScale, setFitScale] = useState(1)
  const [canPan, setCanPan] = useState(false)
  const [contentSize, setContentSize] = useState({ width: CARD_WIDTH, height: CARD_HEIGHT })
  const stageRef = useRef(null)
  const innerRef = useRef(null)
  // 滚轮缩放后要恢复的光标锚点（内容坐标 + 视口坐标）
  const pendingScroll = useRef(null)
  const dragRef = useRef(null)

  const sizeWidth = autoSize ? contentSize.width : CARD_WIDTH
  const sizeHeight = autoSize ? contentSize.height : CARD_HEIGHT

  const scale = zoom === 'fit' ? fitScale : zoom
  const scaleRef = useRef(scale)
  scaleRef.current = scale

  useEffect(() => {
    if (!open) return undefined
    setZoom('fit')
    pendingScroll.current = null
    dragRef.current = null
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  // autoSize：测量内容自然尺寸（offset 不受 transform 缩放影响）
  useEffect(() => {
    if (!open || !autoSize) return undefined
    const inner = innerRef.current
    if (!inner) return undefined
    const measure = () => {
      const child = inner.firstElementChild
      if (!child) return
      const width = child.offsetWidth
      const height = child.offsetHeight
      if (width > 0 && height > 0) {
        setContentSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }))
      }
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(inner)
    return () => observer.disconnect()
  }, [open, autoSize])

  // 适应窗口：按舞台可用尺寸取最小比例（与主预览同一套逻辑）
  useEffect(() => {
    if (!open) return undefined
    const stage = stageRef.current
    if (!stage) return undefined
    const update = () => {
      setFitScale(Math.min(1, (stage.clientWidth - 32) / sizeWidth, (stage.clientHeight - 32) / sizeHeight))
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [open, sizeWidth, sizeHeight])

  // 滚轮缩放：以光标为中心（wheel 需 passive:false 才能拦截默认滚动）
  useEffect(() => {
    if (!open) return undefined
    const stage = stageRef.current
    if (!stage) return undefined
    const onWheel = (event) => {
      event.preventDefault()
      const rect = stage.getBoundingClientRect()
      const mx = event.clientX - rect.left
      const my = event.clientY - rect.top
      const current = scaleRef.current
      // 光标下的内容坐标（按卡片未缩放空间计），缩放后据此还原视口位置
      const cx = (stage.scrollLeft + mx) / current
      const cy = (stage.scrollTop + my) / current
      const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12
      pendingScroll.current = { cx, cy, mx, my }
      setZoom(clamp(current * factor))
    }
    stage.addEventListener('wheel', onWheel, { passive: false })
    return () => stage.removeEventListener('wheel', onWheel)
  }, [open])

  // 缩放变化后：滚轮路径还原光标锚点，其余路径（切档/复位）滚动回顶部；并更新「可拖动」状态
  useLayoutEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const pending = pendingScroll.current
    if (pending) {
      stage.scrollLeft = pending.cx * scaleRef.current - pending.mx
      stage.scrollTop = pending.cy * scaleRef.current - pending.my
      pendingScroll.current = null
    } else {
      stage.scrollLeft = 0
      stage.scrollTop = 0
    }
    setCanPan(stage.scrollWidth > stage.clientWidth + 1 || stage.scrollHeight > stage.clientHeight + 1)
  }, [scale])

  if (!open) return null

  // 返回原样：复位到适应窗口 + 滚动回顶部
  const resetView = () => {
    pendingScroll.current = null
    setZoom('fit')
  }

  const pickZoom = (key) => {
    pendingScroll.current = null
    setZoom(key)
  }

  // 按住拖动平移（仅在放大溢出、可拖动时响应；卡片图片的原生拖拽已在 onDragStart 拦截）
  const onPointerDown = (event) => {
    if (event.button !== 0 || !canPan) return
    const stage = stageRef.current
    if (!stage) return
    dragRef.current = { x: event.clientX, y: event.clientY, left: stage.scrollLeft, top: stage.scrollTop }
    stage.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event) => {
    const drag = dragRef.current
    const stage = stageRef.current
    if (!drag || !stage) return
    stage.scrollLeft = drag.left - (event.clientX - drag.x)
    stage.scrollTop = drag.top - (event.clientY - drag.y)
  }

  const onPointerUp = () => {
    dragRef.current = null
  }

  return (
    <div
      className="dlg-mask pv-mask"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="pv-box" role="dialog" aria-label={t('卡片放大预览')}>
        <div className="pv-bar">
          <div className="zoom">
            {ZOOMS.map((item) => (
              <button
                key={item.key}
                type="button"
                className={zoom === item.key ? 'active' : ''}
                onClick={() => pickZoom(item.key)}
              >
                {t(item.label)}
              </button>
            ))}
          </div>
          <span className="pv-hint">
            {t('当前 {percent}% · 滚轮缩放 · 拖动平移 · 双击复位', { percent: Math.round(scale * 100) })}
          </span>
          <button type="button" className="dlg-x" onClick={onClose} aria-label={t('关闭')}>×</button>
        </div>
        <div
          className={canPan ? 'pv-stage pv-pan' : 'pv-stage'}
          ref={stageRef}
          onDoubleClick={resetView}
          onDragStart={(event) => event.preventDefault()}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div className="pv-card" style={{ width: sizeWidth * scale, height: sizeHeight * scale }}>
            <div
              className="pv-inner"
              ref={innerRef}
              style={{
                transform: `scale(${scale})`,
                ...(autoSize ? { width: 'max-content', height: 'max-content' } : null),
              }}
            >
              {children}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}