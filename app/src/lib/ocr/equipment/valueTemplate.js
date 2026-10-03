// SPDX-License-Identifier: GPL-3.0-or-later
// 数值模板匹配：掩码归一化 + 整串 / 逐字符两条打分路径（纯函数，无 DOM / Node 依赖）
//
// 移植自 NIKKE Workshop（GPL-3.0-or-later）：
//   src/domain/equipmentValueTemplateMatch.js（原 L1-224，几乎逐函数对照）
//   src/services/equipmentValueTemplateMatcher.js 的 matchEquipmentValueTemplate（原 L88-139）
//
// 改动说明：
//   1) 模板与字模改为**注入式加载**（loadFullTemplate / loadGlyph），本文件不含任何 I/O，
//      浏览器与 CLI 各自提供适配器（见 valueTemplateLoader.js）
//   2) 候选档位按 Q18 **不做样式硬过滤**（Workshop 是 filter 掉不相容档位）；
//      样式改为**排序惩罚**（`styleRankPenalty`，P6 已落地）：只进 `rankScore` 不影响验收阈值，
//      命中档位与样式冲突时由裁决层落 `TIER_STYLE_MISMATCH` + `needsConfirm`（§5.7）
//   3) 其余判据、阈值、打分权重与原实现一致
//
// 关键：这里的 score 是**距离**（越小越像），不是相似度。

import { AFFIX_TIER_VALUES } from '../../../data/affixTiers.js'
import { OCR_VALUE_STYLES, expectedOcrValueStyle, isBlueTextStyle } from './valueStyle.js'

/**
 * 匹配阈值
 *
 * **已按我们自己的输入重新标定，不是 Workshop 原值**（原值 0.05 / 0.015 / 0.42）：
 * 我们喂给匹配器的是"已删边框、已按样式取墨迹"的干净 ROI，距与 Workshop 的噪输入
 * 不在同一尺度上。实测 55 行的分布：
 *   - 正确答案的 glyph 距离几乎全在 `0.000~0.030`，`9.00%` 的放大样本为 `0.051`
 *   - 正确答案的 full 距离 `0.028~0.076`；唯一一次 full 误配是 `0.226`
 * 因此：
 *   1) glyph 路新增"近乎完全重合即接受"——原门槛要求 `margin ≥ 0.015`，而两个相邻档位
 *      只差一个字模时 margin 天然只有 0.005，会把**距离 0.000 的正确答案**拒掉（实测 5 例）
 *   2) glyph 一般阈值放宽到 0.08（原 0.05 把 `9.00%` 的 0.051 挡在门外）
 *   3) full 阈值收紧到 0.10（原 0.42 会让 0.226 的明显误配通过）
 */
export const VALUE_MATCH_TUNING = Object.freeze({
  /** glyph-sequence：近乎完全重合即接受，不再比 margin */
  glyphExactScore: 0.01,
  /** glyph-sequence：一般接受阈值 */
  glyphMaxScore: 0.08,
  /** glyph-sequence：一般接受所需的最小 margin */
  glyphMinMargin: 0.015,
  /** full-value：只接受真正的拟合 */
  fullMaxScore: 0.1,
  /** full-value：最小 margin */
  fullMinMargin: 0.012,
  /** margin 达到该值即判 high */
  highConfidenceMargin: 0.04,
  /** 整串掩码归一化尺寸 */
  normalizedWidth: 160,
  normalizedHeight: 36,
  /** 逐字符分段归一化尺寸 */
  glyphWidth: 28,
  glyphHeight: 36,
  /** 拼串字间距 */
  glyphGap: 2,
  /**
   * 样式不相容的**排序惩罚**（P6，见 §5.7 / Q18）
   *
   * 规则「深底=15 / 浅底亮蓝=12-14 / 浅底灰蓝=1-11」已确认，但**我们对样式的判读不可靠**
   * （抓帧压缩会让颜色漂移），所以这里只把不相容的候选往后挪，**绝不丢弃**它们：
   * 距离真正的强者仍然能赢，赢了且与样式冲突时由 `TIER_STYLE_MISMATCH` + `needsConfirm` 兜住。
   *
   * 取值 0.02 的依据：本项目实测「读错一个数字」的距离差 ≥0.03（如 `4.04` 0.000 vs 次优 0.0855），
   * 而需要被这个先验解决的边界歧义（同 `functionType` 内 t11↔t12、t14↔t15）差距极小；
   * 0.02 足以翻越后者、又小于前者。**本样本集暂无该边界的直接样本**，见 §11 待实测。
   */
  styleRankPenalty: 0.02,
})

const EMPTY_MASK = Object.freeze({ data: new Uint8Array(1), width: 1, height: 1 })

const contiguousRuns = (flags) => {
  const runs = []
  let start = -1
  for (let index = 0; index <= flags.length; index += 1) {
    const active = index < flags.length && Boolean(flags[index])
    if (active && start < 0) start = index
    else if (!active && start >= 0) {
      runs.push([start, index])
      start = -1
    }
  }
  return runs
}

const foregroundBounds = (mask, width, height) => {
  let left = width
  let right = -1
  let top = height
  let bottom = -1
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!mask[(y * width) + x]) continue
      left = Math.min(left, x)
      right = Math.max(right, x)
      top = Math.min(top, y)
      bottom = Math.max(bottom, y)
    }
  }
  return right < left ? null : { left, top, width: right - left + 1, height: bottom - top + 1 }
}

const cropMaskData = (mask, sourceWidth, bounds) => {
  const output = new Uint8Array(bounds.width * bounds.height)
  for (let y = 0; y < bounds.height; y += 1) {
    for (let x = 0; x < bounds.width; x += 1) {
      output[(y * bounds.width) + x] = mask[((bounds.top + y) * sourceWidth) + bounds.left + x]
    }
  }
  return { data: output, width: bounds.width, height: bounds.height }
}

const luminance = (red, green, blue) => (red * 0.299) + (green * 0.587) + (blue * 0.114)

/**
 * RGBA → 数值墨迹掩码
 *
 * 先按样式选判据取墨迹，再删掉"通长线"所在的整行（效果条边框），最后紧裁。
 * 注意删边框用的是**该行最长连续段**判据，不是整行墨迹比例——紧裁后的数字本身
 * 也可能占该行大部分宽度。
 */
export const createValueGlyphMask = (rgba, width, height, { blueText = false } = {}) => {
  const mask = new Uint8Array(width * height)
  for (let pixel = 0, index = 0; pixel < mask.length; pixel += 1, index += 4) {
    const red = rgba[index]
    const green = rgba[index + 1]
    const blue = rgba[index + 2]
    mask[pixel] = blueText
      ? Number(blue >= 105 && green >= 70 && blue - red >= 38 && green - red >= 18)
      : Number(luminance(red, green, blue) < 178)
  }

  for (let y = 0; y < height; y += 1) {
    const flags = Array.from({ length: width }, (_, x) => mask[(y * width) + x])
    const longest = Math.max(0, ...contiguousRuns(flags).map(([start, end]) => end - start))
    if (longest >= Math.max(24, Math.round(width * 0.72))) {
      mask.fill(0, y * width, (y + 1) * width)
    }
  }

  const bounds = foregroundBounds(mask, width, height)
  return bounds ? cropMaskData(mask, width, bounds) : { ...EMPTY_MASK }
}

/** 从整图上截取一块区域并生成数值墨迹掩码 */
export const valueMaskFromRegion = (image, box, options = {}) => {
  const x0 = Math.max(0, Math.round(box.x0))
  const y0 = Math.max(0, Math.round(box.y0))
  const x1 = Math.min(image.width - 1, Math.round(box.x1))
  const y1 = Math.min(image.height - 1, Math.round(box.y1))
  const width = x1 - x0 + 1
  const height = y1 - y0 + 1
  if (width <= 0 || height <= 0) return { ...EMPTY_MASK }
  const rgba = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    const sourceStart = ((y0 + y) * image.width + x0) * 4
    rgba.set(image.data.subarray(sourceStart, sourceStart + (width * 4)), y * width * 4)
  }
  return createValueGlyphMask(rgba, width, height, options)
}

/** 最近邻缩放到固定尺寸（观测与模板必须走同一归一化，否则打分没有可比性） */
export const normalizeMask = (mask, width = 160, height = 36) => {
  const output = new Uint8Array(width * height)
  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(mask.height - 1, Math.floor((y * mask.height) / height))
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(mask.width - 1, Math.floor((x * mask.width) / width))
      output[(y * width) + x] = mask.data[(sourceY * mask.width) + sourceX]
    }
  }
  return { data: output, width, height }
}

export const resizeValueGlyphMask = (mask, width, height) => (
  normalizeMask(mask, Math.max(1, width), Math.max(1, height))
)

/**
 * 把单字符字模按档位值拼成一个合法百分比
 *
 * 候选文本**由档位表生成**，因此匹配器不可能产出表外数字，也不做任何 OCR 猜测或修复。
 */
export const composeValueGlyphMasks = (glyphs, { gap = VALUE_MATCH_TUNING.glyphGap } = {}) => {
  const parts = (glyphs || []).filter((glyph) => glyph?.width > 0 && glyph?.height > 0)
  if (parts.length === 0) return { ...EMPTY_MASK }
  const height = Math.max(...parts.map((part) => part.height))
  const width = parts.reduce((total, part) => total + part.width, 0) + (gap * (parts.length - 1))
  const data = new Uint8Array(width * height)
  let left = 0
  for (const part of parts) {
    const top = height - part.height // 底对齐
    for (let y = 0; y < part.height; y += 1) {
      for (let x = 0; x < part.width; x += 1) {
        data[((top + y) * width) + left + x] = part.data[(y * part.width) + x]
      }
    }
    left += part.width + gap
  }
  return { data, width, height }
}

const dilate = (mask, radius = 1) => {
  const output = new Uint8Array(mask.data.length)
  for (let y = 0; y < mask.height; y += 1) {
    for (let x = 0; x < mask.width; x += 1) {
      let active = 0
      for (let dy = -radius; dy <= radius && !active; dy += 1) {
        const sourceY = y + dy
        if (sourceY < 0 || sourceY >= mask.height) continue
        for (let dx = -radius; dx <= radius; dx += 1) {
          const sourceX = x + dx
          if (sourceX < 0 || sourceX >= mask.width) continue
          if (mask.data[(sourceY * mask.width) + sourceX]) {
            active = 1
            break
          }
        }
      }
      output[(y * mask.width) + x] = active
    }
  }
  return { ...mask, data: output }
}

const shiftMask = (mask, offsetX) => {
  const output = new Uint8Array(mask.data.length)
  for (let y = 0; y < mask.height; y += 1) {
    for (let x = 0; x < mask.width; x += 1) {
      const sourceX = x - offsetX
      if (sourceX >= 0 && sourceX < mask.width) {
        output[(y * mask.width) + x] = mask.data[(y * mask.width) + sourceX]
      }
    }
  }
  return { ...mask, data: output }
}

/**
 * 容错掩码距离（越小越像）
 *
 * 内部已在 ±2px 内取最优横向偏移，所以调用方不需要额外对齐；返回的是**距离**。
 */
const tolerantMaskScore = (left, right) => {
  const dilatedLeft = dilate(left)
  let best = 1
  for (let offset = -2; offset <= 2; offset += 1) {
    const shifted = shiftMask(right, offset)
    const dilatedRight = dilate(shifted)
    let leftInk = 0
    let rightInk = 0
    let leftMatched = 0
    let rightMatched = 0
    for (let index = 0; index < left.data.length; index += 1) {
      if (left.data[index]) {
        leftInk += 1
        if (dilatedRight.data[index]) leftMatched += 1
      }
      if (shifted.data[index]) {
        rightInk += 1
        if (dilatedLeft.data[index]) rightMatched += 1
      }
    }
    const similarity = ((leftMatched / Math.max(1, leftInk)) + (rightMatched / Math.max(1, rightInk))) / 2
    best = Math.min(best, 1 - similarity)
  }
  return best
}

const columnRuns = (mask) => {
  const flags = Array.from({ length: mask.width }, (_, x) => {
    for (let y = 0; y < mask.height; y += 1) {
      if (mask.data[(y * mask.width) + x]) return 1
    }
    return 0
  })
  return contiguousRuns(flags)
}

const glyphSlice = (mask, run) => cropMaskData(mask.data, mask.width, {
  left: run[0],
  top: 0,
  width: run[1] - run[0],
  height: mask.height,
})

/**
 * 整串 + 逐字符的加权距离
 *
 * 逐字符段数不一致时直接给重罚（`overall × 0.45 + 0.5 + 段数差 × 0.01`）——
 * 段数不同基本就说明不是同一个值，不必再细化比较。
 */
export const scoreValueGlyphMasks = (observed, template) => {
  const observedRuns = columnRuns(observed)
  const templateRuns = columnRuns(template)
  const overall = tolerantMaskScore(
    normalizeMask(observed, VALUE_MATCH_TUNING.normalizedWidth, VALUE_MATCH_TUNING.normalizedHeight),
    normalizeMask(template, VALUE_MATCH_TUNING.normalizedWidth, VALUE_MATCH_TUNING.normalizedHeight),
  )
  if (observedRuns.length !== templateRuns.length) {
    return (overall * 0.45) + 0.5 + (Math.abs(observedRuns.length - templateRuns.length) * 0.01)
  }
  const glyphScore = observedRuns.reduce((total, run, index) => {
    const left = normalizeMask(glyphSlice(observed, run), VALUE_MATCH_TUNING.glyphWidth, VALUE_MATCH_TUNING.glyphHeight)
    const right = normalizeMask(glyphSlice(template, templateRuns[index]), VALUE_MATCH_TUNING.glyphWidth, VALUE_MATCH_TUNING.glyphHeight)
    return total + tolerantMaskScore(left, right)
  }, 0) / Math.max(1, observedRuns.length)
  return (overall * 0.7) + (glyphScore * 0.3)
}

export const rankValueTemplateCandidates = (observed, candidates) => (candidates || [])
  .map((candidate) => ({ ...candidate, score: scoreValueGlyphMasks(observed, candidate.mask) }))
  .sort((left, right) => left.score - right.score || left.level - right.level)

export const scoreComposedValueGlyphMasks = (observed, candidate) => {
  if (!observed?.width || !observed?.height || !candidate?.width || !candidate?.height) return 1
  return tolerantMaskScore(observed, resizeValueGlyphMask(candidate, observed.width, observed.height))
}

export const rankComposedValueCandidates = (observed, candidates) => (candidates || [])
  .map((candidate) => ({ ...candidate, score: scoreComposedValueGlyphMasks(observed, candidate.mask) }))
  .sort((left, right) => left.score - right.score || left.level - right.level)

const glyphFileName = (character) => (
  character === '.' ? 'dot' : character === '%' ? 'percent' : character
)

/**
 * 把「样式先验」施加到候选排序上（§5.7 / Q18）
 *
 * 关键设计：**惩罚只进 `rankScore`，不改 `score`**。
 *   - `rankScore` 决定"选哪个候选"以及 margin（也就是这个选择的决定性有多大）
 *   - `score`（原始距离）仍然决定"这个候选够不够格"，即各种验收阈值
 *
 * 这样"样式判读失手"最多让我们在几个同样够格的候选里选错一个，而不会把一个
 * 本来够格的好拟合（如 t15 深底亮蓝被误判成浅底灰蓝）整体踢成"未匹配"。
 */
const applyStylePrior = (ranked, valueStyle) => ranked
  .map((item) => {
    const expected = valueStyle ? expectedOcrValueStyle(item.level) : ''
    const mismatched = Boolean(expected) && expected !== valueStyle
    return { ...item, rankScore: item.score + (mismatched ? VALUE_MATCH_TUNING.styleRankPenalty : 0) }
  })
  .sort((left, right) => left.rankScore - right.rankScore || left.level - right.level)

/**
 * 数值模板匹配主流程
 *
 * 先试 `glyph-sequence`（单字符模板拼串，在截图与素材字形高度一致时最可靠），
 * 证据不足时回退 `full-value`（整值模板，抗缩放/抗锯齿更好）；两者都不明确则返回 null
 * ——此时名称已知但值留空，交由裁决层标 `needsConfirm`。
 *
 * @param {{data,width,height}} observed 观测掩码（valueMaskFromRegion 的产物）
 * @param {string} functionType 名称识别给出的词条类型
 * @param {{
 *   valueStyle?: string,
 *   debug?: boolean,
 *   loadFullTemplate: (functionType: string, level: number) => Promise<{data,width,height}>,
 *   loadGlyph: (valueStyle: string, character: string) => Promise<{data,width,height}>,
 * }} deps
 */
export const matchEquipmentValueTemplate = async (observed, functionType, {
  valueStyle = '',
  debug = false,
  loadFullTemplate,
  loadGlyph,
} = {}) => {
  const legal = AFFIX_TIER_VALUES[functionType] || []
  if (legal.length === 0) return null
  if (!observed || observed.width <= 1 || observed.height <= 1) return null

  // 按 Q18：不按样式过滤候选，只记下样式供 P6 做排序加权 / 冲突标记
  const levels = legal.map((_, index) => index + 1)
  const effectiveStyle = valueStyle || OCR_VALUE_STYLES.LIGHT_BLACK
  const glyphBlueText = isBlueTextStyle(effectiveStyle)

  const glyphCandidates = await Promise.all(levels.map(async (level) => {
    const value = legal[level - 1]
    const text = `${Number(value).toFixed(2)}%`
    const glyphs = await Promise.all([...text].map((character) => (
      loadGlyph(glyphFileName(character), { valueStyle: effectiveStyle, blueText: glyphBlueText })
    )))
    return { level, value, mask: composeValueGlyphMasks(glyphs) }
  }))
  const glyphRanked = rankComposedValueCandidates(observed, glyphCandidates)
  const glyphOrdered = applyStylePrior(glyphRanked, valueStyle)
  const glyphBest = glyphOrdered[0]
  const glyphMargin = (glyphOrdered[1]?.rankScore ?? 1) - (glyphBest?.rankScore ?? 1)

  let best = null
  let margin = 0
  let method = ''
  let fullOrdered = null
  const glyphAccepted = Boolean(glyphBest) && (
    glyphBest.score <= VALUE_MATCH_TUNING.glyphExactScore
    || (glyphBest.score <= VALUE_MATCH_TUNING.glyphMaxScore
      && glyphMargin >= VALUE_MATCH_TUNING.glyphMinMargin)
  )
  if (glyphAccepted) {
    best = glyphBest
    margin = glyphMargin
    method = 'glyph-sequence'
  } else {
    const fullCandidates = await Promise.all(levels.map(async (level) => ({
      level,
      value: legal[level - 1],
      mask: await loadFullTemplate(functionType, level),
    })))
    fullOrdered = applyStylePrior(rankValueTemplateCandidates(observed, fullCandidates), valueStyle)
    const fullBest = fullOrdered[0]
    const fullMargin = (fullOrdered[1]?.rankScore ?? 1) - (fullBest?.rankScore ?? 1)
    if (fullBest && fullBest.score <= VALUE_MATCH_TUNING.fullMaxScore
      && fullMargin >= VALUE_MATCH_TUNING.fullMinMargin) {
      best = fullBest
      margin = fullMargin
      method = 'full-value'
    }
  }
  const summary = {
    level: best?.level ?? null,
    value: best?.value ?? null,
    score: best?.score ?? null,
    margin,
    method,
    confidence: best ? (margin >= VALUE_MATCH_TUNING.highConfidenceMargin ? 'high' : 'medium') : null,
    valueStyle: effectiveStyle,
  }
  if (!debug) return best ? summary : null
  // 诊断出口：把两条路的排名与观测掩码尺寸一并带出，便于定位是哪一环失手
  return {
    ...summary,
    debug: {
      observed: { width: observed.width, height: observed.height, pixels: observed.data.reduce((sum, value) => sum + value, 0) },
      glyphRanked: glyphOrdered.slice(0, 5).map((item) => ({ level: item.level, value: item.value, score: Number(item.score.toFixed(4)), rankScore: Number(item.rankScore.toFixed(4)) })),
      fullRanked: fullOrdered
        ? fullOrdered.slice(0, 5).map((item) => ({ level: item.level, value: item.value, score: Number(item.score.toFixed(4)), rankScore: Number(item.rankScore.toFixed(4)) }))
        : null,
    },
  }
}
