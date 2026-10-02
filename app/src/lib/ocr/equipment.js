// 装备改造词条识别核心（纯函数，无 Node / DOM 依赖，CLI 与浏览器共用）
//
// 流程：面板定位 → 墨迹掩码（数值专用掩码优先）→ 字符块 → 值串重建（固定两位小数）
//      → 名称整串匹配（9 词条 × 2 态）→ 档位吸附 → 行号推断
//
// 设计要点：
//   1) 先定位面板再识别——全屏截图里桌面会污染全局背景亮度估计（背景众数取到桌面色），
//      掩码会整体失真；定位到面板后，背景估计回到面板自身，同时裁掉画面干扰、加快速度
//   2) 尺度相关阈值一律用“相对字高”表述，兼容 100%~200% 显示缩放下截的面板
//      （字模匹配本身是按目标字框缩放模板，天然尺度无关）
//   3) 数值专用掩码：实测面板上数值为蓝调（彩度中位 20~25），而名称/描述文字彩度与蓝偏为 0，
//      用“彩度 ≥12 且灰度低于背景”即可干净分离，分类分数从 0.6 提到 0.74~0.98
import {
  alphaToMask,
  analyzeColor,
  backgroundLevel,
  binarize,
  buildInkMasks,
  classifyComponent,
  cropMask,
  findComponents,
  findHoles,
  groupComponentsIntoRows,
  maskSimilarity,
  prepareTemplate,
  resizeMask,
  rgbaToGray,
  templateMask,
  tightBox,
} from './core.js'
import { AFFIX_TIER_VALUES, FUNCTION_LABELS, correctAffixValueByTiers, snapAffixValue } from '../../data/affixTiers.js'

export const OCR_TUNING = {
  minScore: 0.6,
  nameMinScore: 0.5,
  nameMinMargin: 0.03,
  valueMaskMinChroma: 12,
  valueMaskDarkMargin: 10,
  panelBrightLevel: 205,
  panelMinWidth: 220,
  panelMinHeight: 300,
}

/** 字模文件名 → 字符（dot/percent 特殊，其余取首个数字） */
export const charOfTemplateFile = (name) => {
  const base = name.replace(/\.png$/i, '')
  if (base.startsWith('dot')) return '.'
  if (base.startsWith('percent')) return '%'
  return base.match(/^(\d)/)?.[1] || base
}

const median = (values) => {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)]
}

/** RGBA 图 → 值字模（紧裁 + 预处理） */
export const valueTemplateFromImage = (image, char) => {
  const mask = templateMask(image)
  const box = tightBox(mask, image.width, image.height)
  if (!box) return null
  return prepareTemplate({ char, ...cropMask(mask, image.width, box) })
}

/**
 * 名称模板墨迹：有透明通道直接用 alpha；否则按四角亮度判断极性
 * （light/ 是深字浅底，dark/ 是亮字深底——后者按“白底黑字”取墨迹会取反）
 */
export const labelMask = (image) => {
  const { data, width, height } = image
  for (let index = 3; index < data.length; index += 4) {
    if (data[index] < 250) return alphaToMask(image)
  }
  const gray = rgbaToGray(image)
  const corners = [gray[0], gray[width - 1], gray[(height - 1) * width], gray[height * width - 1]]
  const background = corners.reduce((sum, value) => sum + value, 0) / corners.length
  return binarize(gray, width, height, { mode: background < 128 ? 'light' : 'dark', threshold: 128 }).mask
}

/** RGBA 图 → 名称字模（functionType + light/dark 态） */
export const nameTemplateFromImage = (image, { functionType, family }) => {
  const mask = labelMask(image)
  const box = tightBox(mask, image.width, image.height)
  if (!box) return null
  return prepareTemplate({ char: functionType, family, ...cropMask(mask, image.width, box) })
}

/** RGBA 裁剪（含端点）：返回新图，坐标相对裁剪框 */
export const cropImage = (image, box) => {
  const width = box.x1 - box.x0 + 1
  const height = box.y1 - box.y0 + 1
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    const sourceStart = ((box.y0 + y) * image.width + box.x0) * 4
    data.set(image.data.subarray(sourceStart, sourceStart + width * 4), y * width * 4)
  }
  return { data, width, height }
}

/**
 * 面板定位：取画面中最大的亮色连通区域（装备面板是大面积浅底 UI）
 * 其他亮组件若与主区域横向重叠超过一半，视为同一面板的碎片合并（面板可能被深色元素割断）
 * 找不到足够大的区域时返回 null
 */
export const locatePanel = (image, tuning = OCR_TUNING) => {
  const { width, height } = image
  const gray = rgbaToGray(image)
  const mask = new Uint8Array(width * height)
  for (let index = 0; index < gray.length; index += 1) {
    mask[index] = gray[index] >= tuning.panelBrightLevel ? 1 : 0
  }
  const components = findComponents(mask, width, height, { minHeight: 60, minPixels: 8000 })
  if (components.length === 0) return null
  const main = components.reduce((left, right) => (right.pixels > left.pixels ? right : left))
  if (main.width < tuning.panelMinWidth || main.height < tuning.panelMinHeight) return null
  const pieces = components.filter((component) => {
    if (component.pixels < main.pixels * 0.15) return false
    const overlap = Math.min(component.x1, main.x1) - Math.max(component.x0, main.x0)
    return overlap > Math.min(component.width, main.width) * 0.5
  })
  const box = pieces.reduce((accumulator, component) => ({
    x0: Math.min(accumulator.x0, component.x0),
    y0: Math.min(accumulator.y0, component.y0),
    x1: Math.max(accumulator.x1, component.x1),
    y1: Math.max(accumulator.y1, component.y1),
  }), { x0: main.x0, y0: main.y0, x1: main.x1, y1: main.y1 })
  const margin = 8
  return {
    x0: Math.max(0, box.x0 - margin),
    y0: Math.max(0, box.y0 - margin),
    x1: Math.min(width - 1, box.x1 + margin),
    y1: Math.min(height - 1, box.y1 + margin),
  }
}

/** 连通域 → 字符块：包围盒在 x 方向交叠/相接的域并成一块（% 并成一块；数字、小数点各自独立） */
const buildCharBlocks = (components) => {
  const blocks = []
  for (const component of [...components].sort((left, right) => left.x0 - right.x0)) {
    const last = blocks[blocks.length - 1]
    if (last && component.x0 <= last.x1) {
      last.x1 = Math.max(last.x1, component.x1)
      last.y0 = Math.min(last.y0, component.y0)
      last.y1 = Math.max(last.y1, component.y1)
      last.width = last.x1 - last.x0 + 1
      last.height = last.y1 - last.y0 + 1
    } else {
      blocks.push({ ...component })
    }
  }
  return blocks
}

/** 掩码哈希（同一形状只分类一次）；不用 Buffer，浏览器/Node 通用 */
const maskKey = (glyph) => {
  let first = 0x811c9dc5
  let second = 0x9e3779b9
  for (let index = 0; index < glyph.mask.length; index += 1) {
    const value = glyph.mask[index] ? 1 : 0
    first = Math.imul(first, 0x01000193) ^ value
    second = Math.imul(second ^ value, 0x85ebca6b)
  }
  return `${glyph.width}x${glyph.height}:${(first >>> 0).toString(36)}.${(second >>> 0).toString(36)}`
}

const classifyCached = (cache, glyph, templates, minScore) => {
  const key = maskKey(glyph)
  if (!cache.has(key)) cache.set(key, classifyComponent(glyph, templates, { minScore }))
  return cache.get(key)
}

/**
 * 行内值串检测：以 % 块为锚向左收集“数字/小数点”块
 * 值格式固定为「1~2 位整数 + 2 位小数 + %」，小数点丢失时按位数重建
 * 返回 [{ rawText, value, box, score, dotFound, blockChars }]
 */
/**
 * 粘连块拆分：字符块宽度明显超过单字（> 1.25×字高）时，在块内找“前景最少的竖缝”切成两块；
 * 两侧都能分类成功、且总分明显高于整块时才采用。
 * 用途：视频抓帧的轻微模糊会让相邻字符在掩码上粘连（实测「1%」粘成一块 → 丢失 % 锚 → 整串漏检）
 */
const trySplitBlock = (mask, width, block, templates, minScore, classifyCache) => {
  if (block.width < block.height * 1.25) return null
  const columns = new Array(block.width).fill(0)
  for (let y = block.y0; y <= block.y1; y += 1) {
    for (let x = block.x0; x <= block.x1; x += 1) {
      if (mask[y * width + x]) columns[x - block.x0] += 1
    }
  }
  // 在中间区间找“谷”（切缝）：两端留出字形自身边界，避免把字的收笔当作缝隙
  const from = Math.max(1, Math.floor(block.width * 0.25))
  const to = Math.min(block.width - 2, Math.floor(block.width * 0.78))
  let splitIndex = -1
  let minCount = Infinity
  for (let index = from; index <= to; index += 1) {
    if (columns[index] < minCount) {
      minCount = columns[index]
      splitIndex = index
    }
  }
  if (splitIndex < 0 || minCount > block.height * 0.5) return null // 没有明显间隙，不拆
  const side = (x0, x1) => {
    if (x1 - x0 + 1 < 3) return null
    const region = cropMask(mask, width, { x0, y0: block.y0, x1, y1: block.y1 })
    const box = tightBox(region.mask, region.width, region.height)
    if (!box) return null
    const sub = { x0: x0 + box.x0, y0: block.y0 + box.y0, x1: x0 + box.x1, y1: block.y0 + box.y1 }
    sub.width = sub.x1 - sub.x0 + 1
    sub.height = sub.y1 - sub.y0 + 1
    const glyph = cropMask(mask, width, sub)
    const match = classifyCached(classifyCache, glyph, templates, minScore)
    return { block: sub, glyph, char: match.char, score: match.score }
  }
  const left = side(block.x0, block.x0 + splitIndex - 1)
  const right = side(block.x0 + splitIndex + 1, block.x1)
  if (!left || !right || !left.char || !right.char) return null
  return [left, right]
}

const detectRowValueRuns = (mask, width, blocks, templates, minScore, classifyCache) => {
  const guesses = blocks.flatMap((block) => {
    // 尺寸过滤用“相对宽高比”表述（兼容缩放）：排除大色块/胶囊，保留窄的“1”与小数点
    if (block.height < 3 || block.height > 64 || block.width > block.height * 6 + 20) return [null]
    const glyph = cropMask(mask, width, block)
    const match = classifyCached(classifyCache, glyph, templates, minScore)
    const whole = { block, glyph, char: match.char, score: match.score }
    // 宽块先尝试拆分（模糊粘连）：拆出两块都成功、且总分明显高于整块时采用
    const split = trySplitBlock(mask, width, block, templates, minScore, classifyCache)
    if (split && (!match.char || split[0].score + split[1].score > match.score + 0.5)) return split
    return [whole]
  })
  const runs = []
  for (let index = 0; index < guesses.length; index += 1) {
    const anchor = guesses[index]
    if (!anchor || anchor.char !== '%') continue
    const digits = []
    let dot = null
    let cursor = index - 1
    let previous = anchor
    const blockChars = [anchor.char]
    while (cursor >= 0 && digits.length < 4) {
      const left = guesses[cursor]
      if (!left) break
      const gap = previous.block.x0 - left.block.x1 - 1
      if (gap < -2 || gap > Math.max(4, Math.round(previous.block.height * 0.45))) break
      const isDigit = left.char >= '0' && left.char <= '9'
      const isDot = left.char === '.' || (left.block.height <= previous.block.height * 0.55 && left.block.width <= previous.block.height * 0.6)
      if (isDigit) {
        digits.unshift(left)
        blockChars.unshift(left.char)
        previous = left
        cursor -= 1
        continue
      }
      if (isDot && !dot) {
        dot = left
        previous = left
        cursor -= 1
        continue
      }
      break
    }
    if (digits.length < 3 || digits.length > 4) continue
    // 形态一致性：字高接近；块宽不得超过字高的 ~1.7 倍（防两个数字粘连成一块）
    // 注意：不能用“宽度中位数”做基准——"11.81" 这类串里窄字符 '1' 占多数会把中位数拖低，
    // 正常宽度的 '8' 会被误判为粘连（实测护目镜样本即由此丢串）
    const heights = digits.map((item) => item.block.height)
    const medianHeight = median(heights)
    if (digits.some((item) => Math.abs(item.block.height - medianHeight) > medianHeight * 0.35)) continue
    if (digits.some((item) => item.block.width > medianHeight * 1.7)) continue
    const rawDigits = digits.map((item) => item.char).join('')
    const integerCount = rawDigits.length - 2
    if (integerCount < 1) continue
    const rawText = `${rawDigits.slice(0, integerCount)}.${rawDigits.slice(integerCount)}%`
    const parts = [...digits.map((item) => item.block), ...(dot ? [dot.block] : []), anchor.block]
    const box = {
      x0: Math.min(...parts.map((item) => item.x0)),
      y0: Math.min(...parts.map((item) => item.y0)),
      x1: Math.max(...parts.map((item) => item.x1)),
      y1: Math.max(...parts.map((item) => item.y1)),
    }
    const score = Number(((digits.reduce((sum, item) => sum + item.score, 0) + anchor.score) / (digits.length + 1)).toFixed(3))
    runs.push({ rawText, value: Number(rawText.replace('%', '')), box, score, dotFound: Boolean(dot), blockChars: blockChars.join('') })
  }
  return runs
}

/**
 * 分段 IoU：把模板双轴归一化到字形同一框后，按宽度分 N 段逐段算 IoU 取平均
 * 小字（字高 ~14px）上整串 IoU 区分度不足——【命中率增加】与【攻击力增加】整串只差 0.007，
 * 分段后局部字形差异（命 vs 攻）才能拉开差距
 */
const segmentSimilarity = (glyph, template, segments = 3) => {
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

/** 整串名称字形与 9×2 模板逐一比对，返回全部排名（供值兼容性消歧） */
const matchNameGlyph = (glyph, nameTemplates) => {
  const perFunction = new Map()
  for (const template of nameTemplates) {
    const score = segmentSimilarity(glyph, template, 3)
    const existing = perFunction.get(template.char)
    if (!existing || score > existing.score) perFunction.set(template.char, { score, family: template.family })
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

/** 数值是否落在该词条的档位表里（用于名称消歧：同宽度词条靠“值必须属于该词条档位”区分） */
const valueFitsFunction = (value, functionType, tolerance = 0.15) => {
  const tiers = AFFIX_TIER_VALUES[functionType]
  return Array.isArray(tiers) && tiers.some((tierValue) => Math.abs(tierValue - value) <= tolerance)
}

/** 取与指定中心线同行的“行内块”（不能用全图块：跨行的长条大块会按 x 交叠吞并整行字） */
const rowBlocksAt = (rows, centerY, height) => rows
  .filter((row) => Math.abs(row.centerY - centerY) <= height * 0.8)
  .flatMap((row) => row.blocks)

/**
 * 名称消歧：优先在“值兼容的词条”里取名称分最高者
 * 有词条长度相同、模板形状相近（如【命中率增加】与【暴击率增加】同为 96 宽），
 * 仅靠整串形状分不开；而值必落在该词条的档位表内，可用它把候选收窄
 */
const resolveName = (match, value) => {
  const compatible = match.ranked.filter((item) => valueFitsFunction(value, item.functionType))
  const pool = compatible.length > 0 ? compatible : match.ranked
  const best = pool[0]
  const second = pool[1]
  return {
    functionType: best.functionType,
    score: Number(best.score.toFixed(3)),
    margin: Number((best.score - (second?.score ?? 0)).toFixed(3)),
    family: best.family,
    scope: compatible.length > 0 ? 'value-compatible' : 'all',
    clusterBox: match.clusterBox,
  }
}

/**
 * 在值串左侧找名称整串：
 * 候选字形来自三处——dark 路深字块（普通行）、dark 路大块镂空字（高亮行白字）、light 路亮字块（兜底）
 * 取“右端最贴近值串”的连续簇（间距 ≤1.4 倍字高），拼成整串字形后与名称模板比对
 */
const findNameForRun = (run, passData, rowsByPass, nameTemplates) => {
  const runCenter = (run.box.y0 + run.box.y1) / 2
  const runHeight = run.box.y1 - run.box.y0 + 1
  const sources = []
  // 普通行：深色名称字（dark 路“行内块”——必须限制在同一行，否则胶囊底边横线会按 x 交叠把整行字吞并）
  for (const block of rowBlocksAt(rowsByPass.dark, runCenter, runHeight)) {
    sources.push({ ...block, mask: passData.dark.mask, maskWidth: passData.dark.width })
  }
  // 高亮行：深胶囊底色把白字包成实体，名称字形是它的“洞”
  for (const component of passData.dark.components) {
    if (component.pixels < 60 || component.height > runHeight * 7 || component.width < component.height * 0.85) continue
    if (Math.abs((component.y0 + component.y1) / 2 - runCenter) > runHeight * 1.5) continue
    for (const hole of findHoles(passData.dark.mask, passData.dark.width, component)) {
      if (hole.pixels < 6 || hole.height < Math.max(4, runHeight * 0.4)) continue
      sources.push({ ...hole, mask: null, maskWidth: 0 })
    }
  }
  // 兜底：亮字路（深底浅字）
  for (const block of rowBlocksAt(rowsByPass.light, runCenter, runHeight)) {
    sources.push({ ...block, mask: passData.light.mask, maskWidth: passData.light.width })
  }
  const candidates = sources.filter((item) =>
    item.x1 < run.box.x0 &&
    Math.abs((item.y0 + item.y1) / 2 - runCenter) <= runHeight * 0.8 &&
    item.height >= runHeight * 0.5 && item.height <= runHeight * 1.8 &&
    item.width <= runHeight * 2.5 && item.width >= 2)
  if (candidates.length < 2) return null
  candidates.sort((left, right) => left.x0 - right.x0)
  const clusters = []
  for (const item of candidates) {
    const last = clusters[clusters.length - 1]
    if (last && item.x0 - last.x1 <= runHeight * 1.4) {
      last.items.push(item)
      last.x1 = Math.max(last.x1, item.x1)
      last.y0 = Math.min(last.y0, item.y0)
      last.y1 = Math.max(last.y1, item.y1)
    } else {
      clusters.push({ items: [item], x0: item.x0, x1: item.x1, y0: item.y0, y1: item.y1 })
    }
  }
  // 取“右端最贴近值串”的簇（且右端在值串左侧）
  const usable = clusters.filter((cluster) => cluster.items.length >= 2 && cluster.x1 < run.box.x0)
    .sort((left, right) => (run.box.x0 - right.x1) - (run.box.x0 - left.x1))
  if (usable.length === 0) return null
  const cluster = usable[0]
  const canvasWidth = cluster.x1 - cluster.x0 + 1
  const canvasHeight = cluster.y1 - cluster.y0 + 1
  const canvas = { mask: new Uint8Array(canvasWidth * canvasHeight), width: canvasWidth, height: canvasHeight }
  for (const item of cluster.items) {
    const glyph = item.glyph || cropMask(item.mask, item.maskWidth, item)
    for (let y = 0; y < glyph.height; y += 1) {
      for (let x = 0; x < glyph.width; x += 1) {
        if (!glyph.mask[y * glyph.width + x]) continue
        const targetY = item.y0 - cluster.y0 + y
        const targetX = item.x0 - cluster.x0 + x
        if (targetX < 0 || targetY < 0 || targetX >= canvasWidth || targetY >= canvasHeight) continue
        canvas.mask[targetY * canvasWidth + targetX] = 1
      }
    }
  }
  const canvasBox = tightBox(canvas.mask, canvas.width, canvas.height)
  const glyph = canvasBox ? cropMask(canvas.mask, canvas.width, canvasBox) : canvas
  const match = matchNameGlyph(glyph, nameTemplates)
  return match ? { ...match, clusterBox: { x0: cluster.x0, y0: cluster.y0, x1: cluster.x1, y1: cluster.y1 } } : null
}

/** 目标 y 附近是否存在文本行（空行“未获得效果”佐证）；行高范围宽松以兼容缩放 */
const hasTextRowNear = (rowsByPass, centerY, pitch) => {
  for (const name of ['dark', 'light']) {
    for (const row of rowsByPass[name]) {
      if (row.height < 6 || row.height > 60) continue
      if (Math.abs(row.centerY - centerY) <= Math.max(8, pitch * 0.4)) return true
    }
  }
  return false
}

/** 行号推断：三行等距结构；2 个值串时按跨度判断缺中间还是缺末尾（跨度阈值用相对字高） */
const assignPositions = (runs, rowsByPass) => {
  const sorted = [...runs].sort((left, right) => left.centerY - right.centerY)
  const positions = new Map()
  const warnings = []
  if (sorted.length === 0) {
    warnings.push('未检测到任何值串')
  } else if (sorted.length === 1) {
    positions.set(sorted[0], 1)
    warnings.push('仅检测到 1 个值串，按第 1 行处理（空行位置未验证）')
  } else if (sorted.length === 2) {
    const [first, second] = sorted
    const gap = second.centerY - first.centerY
    const runHeight = ((first.box.y1 - first.box.y0 + 1) + (second.box.y1 - second.box.y0 + 1)) / 2
    if (gap > runHeight * 3.2) {
      positions.set(first, 1)
      positions.set(second, 3)
      if (!hasTextRowNear(rowsByPass, (first.centerY + second.centerY) / 2, gap / 2)) {
        warnings.push('中间空行无文字佐证（按“缺中间”处理）')
      }
    } else {
      positions.set(first, 1)
      positions.set(second, 2)
      if (!hasTextRowNear(rowsByPass, second.centerY + gap, gap)) {
        warnings.push('末尾空行无文字佐证（按“缺末尾”处理）')
      }
    }
  } else {
    sorted.forEach((run, index) => positions.set(run, index + 1))
    if (sorted.length > 3) warnings.push(`检测到 ${sorted.length} 个候选值串，仅采用前 3 个`)
  }
  return { positions, warnings }
}

/** 在裁剪后的面板图上跑完整识别管线 */
const runPipeline = (image, context) => {
  const tuning = context.tuning
  const { gray, chroma, width, height } = analyzeColor(image)
  const classifyCache = new Map()
  const background = backgroundLevel(gray)
  const passData = {}
  for (const pass of buildInkMasks(gray, chroma, width, height)) passData[pass.name] = { ...pass, width }
  // 数值专用掩码：只留蓝调数值（排除中性灰的名称与描述文字）
  const valueMask = new Uint8Array(width * height)
  for (let index = 0; index < gray.length; index += 1) {
    valueMask[index] = chroma[index] >= tuning.valueMaskMinChroma && gray[index] < background - tuning.valueMaskDarkMargin ? 1 : 0
  }
  passData.value = { name: 'value', mask: valueMask, width }
  const rowsByPass = {}
  for (const name of ['dark', 'chroma', 'light', 'value']) {
    const components = findComponents(passData[name].mask, width, height, { minHeight: 3, minPixels: 3, maxHeight: 200 })
    passData[name].components = components
    passData[name].blocks = buildCharBlocks(components)
    rowsByPass[name] = groupComponentsIntoRows(components).map((row) => ({ ...row, blocks: buildCharBlocks(row.components) }))
  }

  // 值串：数值专用掩码优先（最干净），chroma / dark 依次兜底
  const detections = []
  for (const name of ['value', 'chroma', 'dark']) {
    for (const row of rowsByPass[name]) {
      // 行高上限放宽以兼容放大截图（值串字高约 14px@100%）
      if (row.height < 8 || row.height > 64) continue
      for (const run of detectRowValueRuns(passData[name].mask, width, row.blocks, context.valueTemplates, tuning.minScore, classifyCache)) {
        detections.push({ ...run, pass: name, centerY: (run.box.y0 + run.box.y1) / 2 })
      }
    }
  }
  // 按“路优先级 + 分数”去重：同一位置只保留优先级更高（或同路分更高）的检测
  const runs = []
  for (const passName of ['value', 'chroma', 'dark']) {
    const candidates = detections.filter((item) => item.pass === passName).sort((left, right) => right.score - left.score)
    for (const candidate of candidates) {
      const overlap = runs.some((item) => {
        const xOverlap = Math.min(item.box.x1, candidate.box.x1) - Math.max(item.box.x0, candidate.box.x0)
        const yOverlap = Math.min(item.box.y1, candidate.box.y1) - Math.max(item.box.y0, candidate.box.y0)
        return xOverlap > 0 && yOverlap > (Math.min(item.box.y1 - item.box.y0, candidate.box.y1 - candidate.box.y0) * 0.5)
      })
      if (!overlap) runs.push(candidate)
    }
  }

  const { positions, warnings } = assignPositions(runs, rowsByPass)
  const rows = []
  for (const run of runs) {
    const position = positions.get(run)
    if (!position) continue
    const rawNameMatch = findNameForRun(run, passData, rowsByPass, context.nameTemplates)
    const nameMatch = rawNameMatch ? resolveName(rawNameMatch, run.value) : null
    const nameConfident = Boolean(nameMatch && nameMatch.score >= tuning.nameMinScore && nameMatch.margin >= tuning.nameMinMargin)
    const snap = snapAffixValue(run.value, { functionType: nameConfident ? nameMatch.functionType : undefined })
    // 吸附失败且词条可用：用档位表做“编辑距离 1”纠错（治模糊输入的单字符误判/漏检）
    // 名称门槛比 nameConfident 略宽（margin 0.01）：纠错自带“唯一命中档位”强约束，且结果标为 snapped 供用户核对
    const snapOk = Boolean(snap && (snap.reason === 'scoped' || snap.reason === 'unique-value'))
    const nameUsable = Boolean(nameMatch && nameMatch.score >= tuning.nameMinScore && nameMatch.margin >= 0.01)
    const corrected = !snapOk && nameUsable ? correctAffixValueByTiers(run.value, nameMatch.functionType) : null
    const finalSnap = corrected
      ? { functionType: nameMatch.functionType, tier: corrected.tier, tierValue: corrected.tierValue, distance: corrected.distance, reason: 'corrected' }
      : snap
    const snapped = finalSnap && (finalSnap.reason === 'scoped' || finalSnap.reason === 'unique-value' || finalSnap.reason === 'corrected')
    const value = snapped ? finalSnap.tierValue : run.value
    let confidence = 'low'
    if (snapped && nameConfident && finalSnap.reason === 'scoped') {
      confidence = Math.abs(run.value - finalSnap.tierValue) < 0.005 ? 'high' : 'snapped'
    } else if (snapped) {
      confidence = 'snapped'
    }
    rows.push({
      position,
      empty: false,
      name: nameMatch ? FUNCTION_LABELS[nameMatch.functionType] : null,
      functionType: nameMatch ? nameMatch.functionType : null,
      nameScore: nameMatch?.score ?? 0,
      nameMargin: nameMatch?.margin ?? 0,
      nameSource: nameMatch?.family ?? null,
      rawText: run.rawText,
      rawValue: run.value,
      value,
      tier: snapped ? finalSnap.tier : null,
      tierValue: snapped ? finalSnap.tierValue : null,
      tierDistance: snapped ? finalSnap.distance : null,
      confidence,
      box: run.box,
      evidence: {
        pass: run.pass,
        runScore: run.score,
        blockChars: run.blockChars,
        dotFound: run.dotFound,
        snapReason: finalSnap?.reason ?? 'none',
        nameScope: nameMatch?.scope ?? 'none',
        nameCluster: nameMatch?.clusterBox ?? null,
      },
    })
  }
  for (const position of [1, 2, 3]) {
    if (!rows.some((row) => row.position === position)) rows.push({ position, empty: true })
  }
  rows.sort((left, right) => left.position - right.position)
  return { rows, warnings }
}

/**
 * 识别入口：定位面板 → 裁剪 → 识别
 * 返回 { panel, rows, warnings }；panel 为 null 表示没找到装备面板（rows 全为空行）
 * 注意：rows[].box 坐标相对裁剪后的面板图
 */
export const recognizeEquipment = (image, { valueTemplates, nameTemplates, tuning } = {}) => {
  const config = { ...OCR_TUNING, ...(tuning || {}) }
  const panel = locatePanel(image, config)
  if (!panel) {
    return {
      panel: null,
      rows: [1, 2, 3].map((position) => ({ position, empty: true })),
      warnings: ['未检测到装备面板（画面中没有足够大的浅色面板区域）'],
    }
  }
  const result = runPipeline(cropImage(image, panel), { valueTemplates, nameTemplates, tuning: config })
  return { panel, rows: result.rows, warnings: result.warnings }
}