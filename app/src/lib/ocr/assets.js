// 浏览器侧 OCR 资源与输入：模板加载（含缓存）、图片解码、屏幕抓帧
// 识别核心在 src/lib/ocr/equipment.js（纯函数，CLI 与浏览器共用）；本文件只做浏览器 I/O
import { FUNCTION_LABELS } from '../../data/affixTiers.js'
import { charOfTemplateFile, nameTemplateFromImage, valueTemplateFromImage } from './equipment.js'

const OCR_ROOT = `${import.meta.env.BASE_URL}ocr`

/** ImageBitmap → RGBA 像素（getImageData 返回未预乘 RGBA，模板 alpha 语义完整保留） */
const imageDataFromBitmap = (bitmap) => {
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  context.drawImage(bitmap, 0, 0)
  return context.getImageData(0, 0, bitmap.width, bitmap.height)
}

const loadImageData = async (url) => {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`加载 OCR 资源失败：${url}`)
  const bitmap = await createImageBitmap(await response.blob())
  try {
    return imageDataFromBitmap(bitmap)
  } finally {
    bitmap.close()
  }
}

let assetsPromise = null

/** 加载 OCR 模板（值字模 + 名称模板）并缓存；重复调用返回同一个 Promise */
export const loadOcrAssets = () => {
  if (!assetsPromise) {
    assetsPromise = buildAssets().catch((error) => {
      assetsPromise = null // 失败后允许重试
      throw error
    })
  }
  return assetsPromise
}

const buildAssets = async () => {
  // 字模清单由 scripts/extract-equipment-glyphs.mjs 生成（浏览器无法列目录）
  const response = await fetch(`${OCR_ROOT}/font-templates/Azonix-game/manifest.json`)
  if (!response.ok) throw new Error('缺少字模清单 manifest.json（请先运行 npm run ocr:equip-glyphs）')
  const manifest = await response.json()
  // 并发加载（约 150 个小文件，串行逐个等待会慢好几倍）
  const valueFiles = manifest.valueFiles || []
  const valueImages = await Promise.all(valueFiles.map((file) => loadImageData(`${OCR_ROOT}/font-templates/Azonix-game/${file}`)))
  const valueTemplates = []
  valueFiles.forEach((file, index) => {
    const template = valueTemplateFromImage(valueImages[index], charOfTemplateFile(file))
    if (template) valueTemplates.push(template)
  })
  const nameJobs = []
  for (const family of ['light', 'dark']) {
    for (const functionType of Object.keys(FUNCTION_LABELS)) {
      nameJobs.push({ functionType, family, url: `${OCR_ROOT}/affix-labels/${family}/${functionType}.png` })
    }
  }
  const nameImages = await Promise.all(nameJobs.map((job) => loadImageData(job.url)))
  const nameTemplates = []
  nameJobs.forEach((job, index) => {
    const template = nameTemplateFromImage(nameImages[index], job)
    if (template) nameTemplates.push(template)
  })
  return { valueTemplates, nameTemplates }
}

/** 拖拽 / 粘贴 / 选择文件得到的 Blob → RGBA 像素 */
export const imageDataFromBlob = async (blob) => {
  const bitmap = await createImageBitmap(blob)
  try {
    return imageDataFromBitmap(bitmap)
  } finally {
    bitmap.close()
  }
}

/** 浏览器是否支持屏幕抓帧 */
export const isScreenCaptureSupported = () => Boolean(navigator.mediaDevices?.getDisplayMedia)

/**
 * 抓一帧“用户选中的屏幕/窗口”（getDisplayMedia），抓完立即停止共享
 * 用户在系统弹窗里取消选择时抛 NotAllowedError（上层按“已取消”处理）
 * 诊断：一并返回实际捕获源信息（displaySurface 等）与整帧 PNG dataUrl，用于核对“抓到的到底是什么画面”
 */
export const captureScreenFrame = async () => {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
  let stoppedByUs = false
  try {
    const track = stream.getVideoTracks()[0]
    const settings = track?.getSettings?.() || {}
    const meta = {
      displaySurface: settings.displaySurface || 'unknown',
      logicalSurface: settings.logicalSurface ?? null,
      width: settings.width ?? null,
      height: settings.height ?? null,
      frameRate: settings.frameRate ?? null,
    }
    // 诊断日志：window=单个窗口 / monitor=整个显示器 / browser=浏览器标签页
    console.info('[OCR 抓帧] track settings:', settings)
    track?.addEventListener('ended', () => {
      if (!stoppedByUs) console.info('[OCR 抓帧] 捕获轨道被外部结束')
    })

    const video = document.createElement('video')
    video.srcObject = stream
    video.muted = true
    await video.play()
    await new Promise((resolve) => {
      if (typeof video.requestVideoFrameCallback === 'function') {
        video.requestVideoFrameCallback(() => resolve())
      } else {
        setTimeout(resolve, 250)
      }
    })
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const context = canvas.getContext('2d', { willReadFrequently: true })
    context.drawImage(video, 0, 0)
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height)
    return { imageData, meta, dataUrl: canvas.toDataURL('image/png') }
  } finally {
    stoppedByUs = true
    for (const track of stream.getTracks()) track.stop()
  }
}