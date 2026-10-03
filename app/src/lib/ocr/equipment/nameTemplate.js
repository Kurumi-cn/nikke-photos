// SPDX-License-Identifier: GPL-3.0-or-later
// 词条名称识别：label 子区域的墨迹 → 与 9 词条 × 2 态模板比对（纯函数，无 DOM / Node 依赖）
//
// 分段 IoU 与整串比对思路取自本项目的旧实现（src/lib/ocr/equipment.js 的 segmentSimilarity /
// matchNameGlyph），本项目内复用；本模块的差别是**输入不再由值串反推簇**，而是直接对
// label 子区域取墨迹（规格 §5.5）—— 去掉"值串锚点"这一环就同时去掉了它的失败模式。
//
// 关键设计：分段 IoU（沿 x 分 3 段取平均）对小字（字高约 14px）必要 —— 整串 IoU 区分度不足，
// 【命中率增加】与【攻击力增加】整串只差 0.007，分段后局部字形差异才能拉开。

import { cropMask, maskSimilarity, resizeMask, stripThinRules, tightBox } from '../core.js'

/** label 区左侧需要跳过的"边框带"宽度比例（胶囊左竖边框落在这里） */
const LABEL_BORDER_INSET_RATIO = 0.15
/** label 文字墨迹的两种判据：普通行取暗字，深底行取亮字（Workshop 的 180 / 128） */
const LABEL_DARK_TEXT_THRESHOLD = 180
const LABEL_LIGHT_TEXT_THRESHOLD = 128

const luminance = (red, green, blue) => (red * 0.299) + (green * 0.587) + (blue * 0.114)

/**
 * 从 label 子区域取"名称字形"掩码并紧裁
 *
 * 处理顺序：跳左侧边框带 → 取墨迹（暗字 / 亮字）→ 删通长线 → 取**墨迹最多的那一段连续列**
 * → 纵向紧裁。中间那一步是有必要的：label 区里可能混入胶囊边框之类的孤立笔画，
 * 直接对整块做紧裁会把它们并进"名称字符串"，凭空多出几个字形段。
 *
 * @returns {{ mask, width, height, box } | null} box 为绝对坐标，便于排查
 */
export const nameGlyphFromRegion = (image, region, {
  darkRow = false,
  insetRatio = LABEL_BORDER_INSET_RATIO,
  gapRatio = 0.6,
} = {}) => {
  const inset = Math.round((region.x1 - region.x0 + 1) * insetRatio)
  const x0 = Math.max(0, Math.round(region.x0) + inset)
  const y0 = Math.max(0, Math.round(region.y0))
  const x1 = Math.min(image.width - 1, Math.round(region.x1))
  const y1 = Math.min(image.height - 1, Math.round(region.y1))
  const width = x1 - x0 + 1
  const height = y1 - y0 + 1
  if (width < 8 || height < 6) return null

  const mask = new Uint8Array(width * height)
  const threshold = darkRow ? LABEL_LIGHT_TEXT_THRESHOLD : LABEL_DARK_TEXT_THRESHOLD
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (((y0 + y) * image.width) + x0 + x) * 4
      const value = luminance(image.data[offset], image.data[offset + 1], image.data[offset + 2])
      mask[(y * width) + x] = (darkRow ? value >= threshold : value < threshold) ? 1 : 0
    }
  }
  stripThinRules(mask, width, height)

  // 取墨迹最多的连续列段（允许字间小间隙），把孤立笔画挡在外面
  const columnInk = new Array(width).fill(0)
  for (let x = 0; x < width; x += 1) {
    let count = 0
    for (let y = 0; y < height; y += 1) count += mask[(y * width) + x]
    columnInk[x] = count
  }
  const maximumGap = Math.max(2, Math.round(height * gapRatio))
  let bestRun = null
  let run = null
  for (let x = 0; x <= width; x += 1) {
    const inked = x < width && columnInk[x] > 0
    if (inked) {
      if (!run) run = { start: x, end: x, ink: 0 }
      run.end = x
      run.ink += columnInk[x]
    } else if (run) {
      let gap = 0
      let probe = x
      while (probe < width && columnInk[probe] === 0 && gap < maximumGap) {
        gap += 1
        probe += 1
      }
      if (gap < maximumGap && probe < width && columnInk[probe] > 0) continue
      if (!bestRun || run.ink > bestRun.ink) bestRun = run
      run = null
    }
  }
  if (run && (!bestRun || run.ink > bestRun.ink)) bestRun = run
  if (!bestRun) return null

  const clipped = new Uint8Array((bestRun.end - bestRun.start + 1) * height)
  for (let y = 0; y < height; y += 1) {
    for (let x = bestRun.start; x <= bestRun.end; x += 1) {
      clipped[(y * (bestRun.end - bestRun.start + 1)) + (x - bestRun.start)] = mask[(y * width) + x]
    }
  }
  const box = tightBox(clipped, bestRun.end - bestRun.start + 1, height)
  if (!box) return null
  return {
    ...cropMask(clipped, bestRun.end - bestRun.start + 1, box),
    box: {
      x0: x0 + bestRun.start + box.x0,
      y0: y0 + box.y0,
      x1: x0 + bestRun.start + box.x1,
      y1: y0 + box.y1,
    },
  }
}

/**
 * 分段 IoU：把模板双轴归一化到观测字形同一框后，按宽度分 N 段逐段算 IoU 取平均
 * （尺度无关；模板按观测字形框缩放）
 */
export const segmentSimilarity = (glyph, template, segments = 3) => {
  const scaled = resizeMask(template, glyph.width, glyph.height)
  let total = 0
  for (let index = 0; index < segments; index += 1) {
    const x0 = Math.floor((glyph.width * index) / segments)
    const x1 = Math.floor((glyph.width * (index + 1)) / segments) - 1
    if (x1 < x0) return 0
    const left = cropMask(glyph.mask, glyph.width, { x0, y0: 0, x1, y1: glyph.height - 1 })
    const right = cropMask(scaled.mask, scaled.width, { x0, y0: 0, x1, y1: scaled.height - 1 })
    total += maskSimilarity(left, right)
  }
  return total / segments
}

/**
 * 与全部名称模板逐一比对，返回排名
 *
 * **必须按极性过滤模板族**：`light/` 是"深字浅底"（普通行），`dark/` 是"亮字深底"（深底行）。
 * 不过滤时会冒出物理上说不通的匹配——实测普通行上 `StatChargeDamage` 的 **dark 族**模板拿到
 * 0.651，压过正确答案 `StatCriticalDamage` 的 light 族 0.646（两者档位表都含 12.52%，
 * 值证据救不了），而它本该用 light 族。按极性过滤后该假阳性消失。
 *
 * @param {{ family?: 'light'|'dark' }} options 期望的字色极性；不传则不过滤
 * @returns {{ ranked: {functionType, score, family}[], functionType, score, margin, family } | null}
 */
export const matchNameGlyph = (glyph, nameTemplates, { family = '' } = {}) => {
  if (!glyph || glyph.width <= 1 || glyph.height <= 1) return null
  const pool = family ? nameTemplates.filter((template) => template.family === family) : nameTemplates
  if (pool.length === 0) return null
  const perFunction = new Map()
  for (const template of pool) {
    const score = segmentSimilarity(glyph, template, 3)
    const existing = perFunction.get(template.char)
    if (!existing || score > existing.score) {
      perFunction.set(template.char, { score, family: template.family })
    }
  }
  const ranked = [...perFunction.entries()]
    .map(([functionType, item]) => ({ functionType, ...item }))
    .sort((left, right) => right.score - left.score)
  if (ranked.length === 0) return null
  return {
    ranked,
    functionType: ranked[0].functionType,
    score: Number(ranked[0].score.toFixed(3)),
    margin: Number((ranked[0].score - (ranked[1]?.score ?? 0)).toFixed(3)),
    family: ranked[0].family,
  }
}

/** 该行的名称模板族：普通行深字浅底用 light，深底行亮字用 dark */
export const nameFamilyForRow = (darkRow) => (darkRow ? 'dark' : 'light')

export { LABEL_BORDER_INSET_RATIO, LABEL_DARK_TEXT_THRESHOLD, LABEL_LIGHT_TEXT_THRESHOLD }
