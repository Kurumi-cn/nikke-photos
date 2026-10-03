// OCR 核心（纯函数，无 DOM 依赖）：灰度 → 二值化 → 连通域 → 模板分类 / 模板匹配
// 之所以用模板而不是通用 OCR：妮姬 UI 是艺术化描边字体，通用 OCR 会把 8/6/0 认错；
// 模板来自游戏内切图（public/ocr），按位图形状比对，并且与文字颜色无关（只取墨迹形状）。

/** RGBA 图像 → 灰度数组 */
export function rgbaToGray(image) {
  const { data, width, height } = image
  const gray = new Uint8Array(width * height)
  for (let index = 0; index < width * height; index += 1) {
    const r = data[index * 4]
    const g = data[index * 4 + 1]
    const b = data[index * 4 + 2]
    gray[index] = Math.round((r * 299 + g * 587 + b * 114) / 1000)
  }
  return gray
}

/**
 * RGBA 图像 → { gray, chroma }（可选按盒裁剪，坐标含端点）
 * chroma 为像素彩度（max-min 通道差）：妮姬的橙色数值与灰白背景仅色相不同，靠它分离
 */
export function analyzeColor(image, box) {
  const { data, width } = image
  const x0 = box ? box.x0 : 0
  const y0 = box ? box.y0 : 0
  const boxWidth = box ? box.x1 - box.x0 + 1 : width
  const boxHeight = box ? box.y1 - box.y0 + 1 : Math.floor(data.length / (width * 4))
  const gray = new Uint8Array(boxWidth * boxHeight)
  const chroma = new Uint8Array(boxWidth * boxHeight)
  for (let y = 0; y < boxHeight; y += 1) {
    for (let x = 0; x < boxWidth; x += 1) {
      const index = (y0 + y) * width + (x0 + x)
      const r = data[index * 4]
      const g = data[index * 4 + 1]
      const b = data[index * 4 + 2]
      gray[y * boxWidth + x] = Math.round((r * 299 + g * 587 + b * 114) / 1000)
      chroma[y * boxWidth + x] = Math.max(r, g, b) - Math.min(r, g, b)
    }
  }
  return { gray, chroma, width: boxWidth, height: boxHeight }
}

/** Otsu 全局阈值 */
export function otsuThreshold(gray) {
  const histogram = new Array(256).fill(0)
  for (let index = 0; index < gray.length; index += 1) histogram[gray[index]] += 1
  const total = gray.length
  let sum = 0
  for (let level = 0; level < 256; level += 1) sum += level * histogram[level]
  let sumBackground = 0
  let weightBackground = 0
  let best = 0
  let threshold = 127
  for (let level = 0; level < 256; level += 1) {
    weightBackground += histogram[level]
    if (weightBackground === 0) continue
    const weightForeground = total - weightBackground
    if (weightForeground === 0) break
    sumBackground += level * histogram[level]
    const meanBackground = sumBackground / weightBackground
    const meanForeground = (sum - sumBackground) / weightForeground
    const between = weightBackground * weightForeground * (meanBackground - meanForeground) ** 2
    if (between > best) {
      best = between
      threshold = level
    }
  }
  return threshold
}

/** 背景亮度估计：取灰度直方图众数（妮姬面板以大面积均匀浅色底为主） */
export function backgroundLevel(gray) {
  const histogram = new Array(256).fill(0)
  for (let index = 0; index < gray.length; index += 1) histogram[gray[index]] += 1
  let best = 0
  let level = 255
  for (let value = 0; value < 256; value += 1) {
    if (histogram[value] > best) {
      best = histogram[value]
      level = value
    }
  }
  return level
}

/**
 * 按妮姬 UI 的三种文字样式生成墨迹掩码（1 = 墨迹）：
 *   dark   深色字（浅底上的数值/标签，如战斗力）
 *   light  亮色字（深底/彩底上的白字，如等级上限、好感、装备等级）
 *   chroma 彩字（橙色数值——与背景只差色相，灰度阈值分不出来）
 */
export function buildInkMasks(gray, chroma, width, height) {
  const background = backgroundLevel(gray)
  const threshold = otsuThreshold(gray)
  const lightThreshold = Math.max(threshold + 40, background - 20)
  const dark = binarize(gray, width, height, { mode: 'dark', threshold }).mask
  const light = binarize(gray, width, height, { mode: 'light', threshold: lightThreshold }).mask
  // 彩度阈值取高一点：只保留橙字“核心”，避免浅色泛光把相邻数字桥接成一块
  const chromaMask = new Uint8Array(width * height)
  const badgeMask = new Uint8Array(width * height)
  const paleMask = new Uint8Array(width * height)
  for (let index = 0; index < gray.length; index += 1) {
    const backgrounded = gray[index] < background
    chromaMask[index] = chroma[index] > 96 && backgrounded ? 1 : 0
    // badge：彩度放宽，让“带镂空数字的彩色徽章”（如红心好感徽章）成为完整实体，镂空数字才会成为洞
    badgeMask[index] = chroma[index] > 36 && backgrounded ? 1 : 0
    // pale：中低彩度带——彩色徽章上用“低饱和浅色描边”画出来的字（如红心上的好感数字）
    paleMask[index] = chroma[index] > 20 && chroma[index] < 120 && backgrounded ? 1 : 0
  }
  return [
    { name: 'dark', mask: dark, threshold },
    { name: 'light', mask: light, threshold: lightThreshold },
    { name: 'chroma', mask: chromaMask, threshold: background },
    { name: 'badge', mask: badgeMask, threshold: background },
    { name: 'pale', mask: paleMask, threshold: background },
  ]
}

/**
 * 二值化为墨迹掩码（1 = 墨迹）
 * mode: 'dark' = 深色文字（浅底），'light' = 浅色文字（深底）
 */
export function binarize(gray, width, height, { mode = 'dark', threshold } = {}) {
  const level = threshold ?? otsuThreshold(gray)
  const mask = new Uint8Array(width * height)
  for (let index = 0; index < mask.length; index += 1) {
    mask[index] = mode === 'dark'
      ? (gray[index] < level ? 1 : 0)
      : (gray[index] >= level ? 1 : 0)
  }
  return { mask, threshold: level }
}

/** 从带透明通道的图像取墨迹（模板用：alpha > 128） */
export function alphaToMask(image) {
  const { data, width, height } = image
  const mask = new Uint8Array(width * height)
  for (let index = 0; index < mask.length; index += 1) {
    mask[index] = data[index * 4 + 3] > 128 ? 1 : 0
  }
  return mask
}

/** 连通域（4 邻域），返回包围盒与墨迹像素数 */
export function findComponents(mask, width, height, { minPixels = 5, minHeight = 5, maxHeight = 0 } = {}) {
  const visited = new Uint8Array(mask.length)
  const components = []
  const stack = []
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || visited[start]) continue
    stack.length = 0
    stack.push(start)
    visited[start] = 1
    let count = 0
    let x0 = width
    let y0 = height
    let x1 = -1
    let y1 = -1
    while (stack.length > 0) {
      const index = stack.pop()
      const x = index % width
      const y = (index - x) / width
      count += 1
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
      if (x > 0 && mask[index - 1] && !visited[index - 1]) { visited[index - 1] = 1; stack.push(index - 1) }
      if (x < width - 1 && mask[index + 1] && !visited[index + 1]) { visited[index + 1] = 1; stack.push(index + 1) }
      if (y > 0 && mask[index - width] && !visited[index - width]) { visited[index - width] = 1; stack.push(index - width) }
      if (y < height - 1 && mask[index + width] && !visited[index + width]) { visited[index + width] = 1; stack.push(index + width) }
    }
    const boxHeight = y1 - y0 + 1
    if (count < minPixels) continue
    if (boxHeight < minHeight) continue
    if (maxHeight > 0 && boxHeight > maxHeight) continue
    components.push({ x0, y0, x1, y1, width: x1 - x0 + 1, height: boxHeight, pixels: count })
  }
  return components
}

/**
 * 组件内部的“镂空字”（如红心徽章里镂空出的好感数字）：包围盒内、不与盒外连通的背景像素
 * 返回 [{ x0, y0, x1, y1, width, height, pixels, glyph: { mask, width, height } }]（坐标为掩码坐标系）
 */
export function findHoles(mask, width, box) {
  const boxWidth = box.x1 - box.x0 + 1
  const boxHeight = box.y1 - box.y0 + 1
  const outside = new Uint8Array(boxWidth * boxHeight)
  const stack = []
  const flood = (x, y) => {
    if (x < 0 || y < 0 || x >= boxWidth || y >= boxHeight) return
    const index = y * boxWidth + x
    if (outside[index]) return
    if (mask[(box.y0 + y) * width + (box.x0 + x)]) return
    outside[index] = 1
    stack.push(index)
  }
  for (let x = 0; x < boxWidth; x += 1) {
    flood(x, 0)
    flood(x, boxHeight - 1)
  }
  for (let y = 0; y < boxHeight; y += 1) {
    flood(0, y)
    flood(boxWidth - 1, y)
  }
  while (stack.length > 0) {
    const index = stack.pop()
    const x = index % boxWidth
    const y = (index - x) / boxWidth
    flood(x - 1, y)
    flood(x + 1, y)
    flood(x, y - 1)
    flood(x, y + 1)
  }
  const holes = []
  const visited = new Uint8Array(boxWidth * boxHeight)
  for (let start = 0; start < boxWidth * boxHeight; start += 1) {
    if (visited[start] || outside[start]) continue
    const startX = start % boxWidth
    const startY = (start - startX) / boxWidth
    if (mask[(box.y0 + startY) * width + box.x0 + startX]) {
      visited[start] = 1
      continue
    }
    const cells = []
    const queue = [start]
    visited[start] = 1
    let x0 = startX
    let y0 = startY
    let x1 = startX
    let y1 = startY
    while (queue.length > 0) {
      const index = queue.pop()
      const x = index % boxWidth
      const y = (index - x) / boxWidth
      cells.push(index)
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
      const neighbors = [
        x > 0 ? index - 1 : -1,
        x < boxWidth - 1 ? index + 1 : -1,
        y > 0 ? index - boxWidth : -1,
        y < boxHeight - 1 ? index + boxWidth : -1,
      ]
      for (const neighbor of neighbors) {
        if (neighbor < 0 || visited[neighbor] || outside[neighbor]) continue
        const neighborX = neighbor % boxWidth
        const neighborY = (neighbor - neighborX) / boxWidth
        if (mask[(box.y0 + neighborY) * width + box.x0 + neighborX]) continue
        visited[neighbor] = 1
        queue.push(neighbor)
      }
    }
    const holeWidth = x1 - x0 + 1
    const holeHeight = y1 - y0 + 1
    const glyph = new Uint8Array(holeWidth * holeHeight)
    for (const index of cells) {
      const x = index % boxWidth
      const y = (index - x) / boxWidth
      glyph[(y - y0) * holeWidth + (x - x0)] = 1
    }
    holes.push({
      x0: box.x0 + x0,
      y0: box.y0 + y0,
      x1: box.x0 + x1,
      y1: box.y0 + y1,
      width: holeWidth,
      height: holeHeight,
      pixels: cells.length,
      glyph: { mask: glyph, width: holeWidth, height: holeHeight },
    })
  }
  return holes
}

/**
 * 从 RGBA 图像取“模板墨迹掩码”
 *  - 有透明通道 → 直接取 alpha（Workshop 部分模板是透明底）
 *  - 否则按“白底黑字（深色墨迹）”处理
 * 注意：不要按“边缘像素”或灰度众数判断方向——紧裁的字模墨迹会贴到画布边缘、甚至占多数，会被误判成反色
 */
export function templateMask(image) {
  const { data } = image
  for (let index = 3; index < data.length; index += 4) {
    if (data[index] < 250) return alphaToMask(image)
  }
  // 其余按“白底黑字（深色墨迹）”处理，用固定中灰阈值：
  // 纯黑白 PNG 上 Otsu 会返回 0（退化为空掩码），而紧裁字模又无法靠明暗统计判方向
  return binarize(rgbaToGray(image), image.width, image.height, { mode: 'dark', threshold: 128 }).mask
}

/**
 * 组件 + 其内部镂空 = 实心字形
 * 用于“描边型”字形（如红心徽章上用浅色描边画出的好感数字）：描边围出的内部也要算作墨迹
 */
export function solidGlyph(mask, width, component) {
  const glyph = cropMask(mask, width, component)
  for (const hole of findHoles(mask, width, component)) {
    for (let y = 0; y < hole.height; y += 1) {
      for (let x = 0; x < hole.width; x += 1) {
        if (!hole.glyph.mask[y * hole.width + x]) continue
        glyph.mask[(hole.y0 - component.y0 + y) * glyph.width + (hole.x0 - component.x0 + x)] = 1
      }
    }
  }
  return glyph
}

/** 整体墨迹的紧致包围盒（模板裁剪用） */
export function tightBox(mask, width, height) {
  let x0 = width
  let y0 = height
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!mask[y * width + x]) continue
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 }
}

/** 抠出一块掩码 */
export function cropMask(mask, width, box) {
  const boxWidth = box.x1 - box.x0 + 1
  const boxHeight = box.y1 - box.y0 + 1
  const out = new Uint8Array(boxWidth * boxHeight)
  for (let y = 0; y < boxHeight; y += 1) {
    for (let x = 0; x < boxWidth; x += 1) {
      out[y * boxWidth + x] = mask[(box.y0 + y) * width + (box.x0 + x)]
    }
  }
  return { mask: out, width: boxWidth, height: boxHeight }
}

/** 最近邻缩放到指定宽高（双轴独立，允许纵向/横向比例不同） */
export function resizeMask(source, targetWidth, targetHeight) {
  const width = Math.max(1, Math.round(targetWidth))
  const height = Math.max(1, Math.round(targetHeight))
  const out = new Uint8Array(width * height)
  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(source.height - 1, Math.floor((y * source.height) / height))
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(source.width - 1, Math.floor((x * source.width) / width))
      out[y * width + x] = source.mask[sourceY * source.width + sourceX]
    }
  }
  return { mask: out, width, height }
}

/** 最近邻缩放到指定高度（保持宽高比） */
export function normalizeToHeight(source, targetHeight) {
  const ratio = targetHeight / source.height
  const targetWidth = Math.max(1, Math.round(source.width * ratio))
  const out = new Uint8Array(targetWidth * targetHeight)
  for (let y = 0; y < targetHeight; y += 1) {
    const sourceY = Math.min(source.height - 1, Math.floor(y / ratio))
    for (let x = 0; x < targetWidth; x += 1) {
      const sourceX = Math.min(source.width - 1, Math.floor(x / ratio))
      out[y * targetWidth + x] = source.mask[sourceY * source.width + sourceX]
    }
  }
  return { mask: out, width: targetWidth, height: targetHeight }
}

/** 两份掩码的相似度：IoU 与“包含度”(交/较小者) 各占一半，兼容笔画粗细差异 */
function jaccard(left, right, offsetX = 0, offsetY = 0) {
  const width = Math.max(left.width, right.width + Math.abs(offsetX))
  const height = Math.max(left.height, right.height + Math.abs(offsetY))
  let intersection = 0
  let union = 0
  let leftCount = 0
  let rightCount = 0
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const leftInk = x < left.width && y < left.height ? left.mask[y * left.width + x] : 0
      const rightX = x - offsetX
      const rightY = y - offsetY
      const rightInk = rightX >= 0 && rightX < right.width && rightY >= 0 && rightY < right.height
        ? right.mask[rightY * right.width + rightX]
        : 0
      if (leftInk) leftCount += 1
      if (rightInk) rightCount += 1
      if (leftInk && rightInk) intersection += 1
      if (leftInk || rightInk) union += 1
    }
  }
  if (union === 0 || intersection === 0) return 0
  // 纯 IoU 形状重叠：对"填充型"异物最不宽容，实测区分度最好（几何平均会让 '8' 变成万能匹配）
  return intersection / union
}

/** 两份掩码的相似度（供外部比对“整段文本模板”用，如词条名称整串） */
export function maskSimilarity(left, right, offsetX = 0, offsetY = 0) {
  return jaccard(left, right, offsetX, offsetY)
}

/** 归一化高度（匹配时统一比较尺度） */
const NORM_HEIGHT = 32

/** 模板预处理：保留原始掩码即可（匹配时按目标字高缩放） */
export function prepareTemplate(template) {
  return { ...template }
}

const SHIFT_CANDIDATES = [[0, 0], [1, 0], [0, 1], [2, 0], [0, 2]]
const HEIGHT_SCALE_CANDIDATES = [0.96, 1, 1.04]
const WIDTH_SCALE_CANDIDATES = [0.9, 0.96, 1, 1.05, 1.12]

/** 模板候选缩放：把模板缩到目标字框（宽高独立），兼容不同字体/字号的纵横比差异 */
const scaledCandidates = (target, template) => {
  const list = []
  for (const heightScale of HEIGHT_SCALE_CANDIDATES) {
    for (const widthScale of WIDTH_SCALE_CANDIDATES) {
      const height = Math.max(3, Math.round(target.height * heightScale))
      const width = Math.max(2, Math.round(target.width * widthScale))
      list.push(resizeMask(template, width, height))
    }
  }
  return list
}

/**
 * 单个连通域与模板集比较，返回最佳字符与分数
 * 关键点：模板按目标字框双轴缩放，避免纵横比不同（游戏大号数字更窄更高）导致误判
 */
export function classifyComponent(target, templates, { minScore = 0 } = {}) {
  let best = { char: '', score: 0 }
  for (const template of templates) {
    for (const scaled of scaledCandidates(target, template)) {
      for (const [offsetX, offsetY] of SHIFT_CANDIDATES) {
        const score = jaccard(target, scaled, offsetX, offsetY)
        if (score > best.score) best = { char: template.char, score: Number(score.toFixed(3)) }
      }
    }
  }
  if (minScore > 0 && best.score < minScore) return { char: '', score: best.score }
  return best
}

/** 单个连通域的模板排名（调试用：返回前 N 个候选） */
export function rankTemplates(target, templates, { limit = 3 } = {}) {
  const scores = new Map()
  for (const template of templates) {
    for (const scaled of scaledCandidates(target, template)) {
      for (const [offsetX, offsetY] of SHIFT_CANDIDATES) {
        const score = jaccard(target, scaled, offsetX, offsetY)
        if (!scores.has(template.char) || score > scores.get(template.char)) {
          scores.set(template.char, Number(score.toFixed(3)))
        }
      }
    }
  }
  return [...scores.entries()]
    .map(([char, score]) => ({ char, score }))
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
}

/** 按纵向重叠 + 横向间距把连通域聚成文本行 */
export function groupComponentsIntoLines(components) {
  const sorted = [...components].sort((a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2 || a.x0 - b.x0)
  const lines = []
  for (const component of sorted) {
    const centerY = (component.y0 + component.y1) / 2
    const line = lines.find((item) => {
      const overlap = Math.min(item.y1, component.y1) - Math.max(item.y0, component.y0)
      const minHeight = Math.min(item.y1 - item.y0, component.y1 - component.y0)
      return overlap > minHeight * 0.4 && centerY >= item.y0 - item.height && centerY <= item.y1 + item.height
    })
    if (line) {
      line.components.push(component)
      line.y0 = Math.min(line.y0, component.y0)
      line.y1 = Math.max(line.y1, component.y1)
      line.x0 = Math.min(line.x0, component.x0)
      line.x1 = Math.max(line.x1, component.x1)
      line.height = Math.max(line.height, component.height)
    } else {
      lines.push({
        components: [component],
        x0: component.x0,
        x1: component.x1,
        y0: component.y0,
        y1: component.y1,
        height: component.height,
      })
    }
  }
  return lines
}

/**
 * 按“字高相近 + 中心线相近”把连通域聚成文本行
 * 比 y 区间重叠更稳健：大图标不会把上下两行桥接成一行，BATTLE 之类的小字也不会插进数字行里
 */
export function groupComponentsIntoRows(components) {
  const rows = []
  const sorted = [...components].sort((a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2)
  for (const component of sorted) {
    const centerY = (component.y0 + component.y1) / 2
    const row = rows.find((item) => {
      const maxHeight = Math.max(item.height, component.height)
      const minHeight = Math.min(item.height, component.height)
      if (minHeight / maxHeight < 0.7) return false
      return Math.abs(item.centerY - centerY) <= maxHeight * 0.4
    })
    if (row) {
      row.centerY = (row.centerY * row.components.length + centerY) / (row.components.length + 1)
      row.components.push(component)
      if (component.height > row.height) row.height = component.height
    } else {
      rows.push({ components: [component], centerY, height: component.height })
    }
  }
  return rows
}

/**
 * 扫描整张图里的数字串：逐字分类后，从文本行里切出连续的“数字段”（'?' 为分隔）
 * 返回 [{ text, box, score, chars }]，按阅读顺序排列
 */
export function scanNumbers(mask, width, height, { digitTemplates, minScore = 0.6, minHeight = 4, minPixels = 4, keepAll = false, detectHoles = false, fillGlyphs = false } = {}) {
  const components = findComponents(mask, width, height, { minHeight, minPixels, maxHeight: 120 })
  // detectHoles：把组件内部的镂空（如红心徽章里的好感数字）也作为候选字形
  // 只从“宽高比 ≥0.85 的大块”取洞——数字自身的字内孔（如 0 的中间）是窄长条，会搅乱数字行
  // fillGlyphs：描边型掩码（pale），字形取“描边 + 描边围出的内部”
  const items = []
  for (const component of components) {
    items.push(component)
    if (detectHoles && !fillGlyphs && component.pixels >= 60 && component.width >= component.height * 0.85 && component.height <= 96) {
      for (const hole of findHoles(mask, width, component)) {
        if (hole.pixels < minPixels || hole.height < minHeight) continue
        items.push(hole)
      }
    }
  }
  const lines = groupComponentsIntoRows(items)
  const results = []
  for (const line of lines) {
    const ordered = [...line.components].sort((a, b) => a.x0 - b.x0)
    if (ordered.length === 0) continue
    const chars = ordered.map((component) => {
      const glyph = component.glyph || (fillGlyphs ? solidGlyph(mask, width, component) : cropMask(mask, width, component))
      const match = classifyComponent(glyph, digitTemplates, { minScore })
      return { char: match.char, score: match.score, box: component }
    })

    let current = []
    const flush = () => {
      if (!current.length) return
      const text = current.map((item) => item.char).join('').replace(/\.+$/, '')
      const score = current.reduce((sum, item) => sum + item.score, 0) / current.length
      if (/[0-9]/.test(text) && (text.length >= 2 || score >= 0.8)) {
        results.push({
          text,
          box: {
            x0: Math.min(...current.map((item) => item.box.x0)),
            y0: Math.min(...current.map((item) => item.box.y0)),
            x1: Math.max(...current.map((item) => item.box.x1)),
            y1: Math.max(...current.map((item) => item.box.y1)),
            width: Math.max(...current.map((item) => item.box.x1)) - Math.min(...current.map((item) => item.box.x0)) + 1,
            height: Math.max(...current.map((item) => item.box.height)),
          },
          score: Number(score.toFixed(3)),
          chars: [...current],
        })
      }
      current = []
    }
    for (const item of chars) {
      if (!item.char) flush()
      else current.push(item)
    }
    flush()
  }
  return keepAll ? results : results.filter((item) => item.score >= minScore)
}

/**
 * 在指定区域内滑动匹配整块模板（用于词条名 / 整值模板）
 * 返回 { score, x, y, scale }
 */
export function matchTemplateInRegion(mask, width, template, { search, stride = 2, scales = [1] } = {}) {
  const region = search ?? { x0: 0, y0: 0, x1: width - 1, y1: Math.floor(mask.length / width) - 1 }
  let best = { score: 0, x: 0, y: 0, scale: 1 }
  for (const scale of scales) {
    const scaled = normalizeToHeight(template, Math.max(4, Math.round(template.height * scale * (NORM_HEIGHT / NORM_HEIGHT))))
    const targetHeight = scaled.height
    const targetWidth = scaled.width
    if (targetHeight > region.y1 - region.y0 + 1 || targetWidth > region.x1 - region.x0 + 1) continue
    for (let y = region.y0; y <= region.y1 - targetHeight; y += stride) {
      for (let x = region.x0; x <= region.x1 - targetWidth; x += stride) {
        const window = cropMask(mask, width, { x0: x, y0: y, x1: x + targetWidth - 1, y1: y + targetHeight - 1 })
        const score = jaccard(window, scaled)
        if (score > best.score) best = { score: Number(score.toFixed(3)), x, y, scale }
      }
    }
  }
  return best
}

/**
 * 原地删除"通长线"所在的整行 / 整列（就地清零 mask）
 *
 * 用途：游戏 UI 的效果条、卡片、面板都带边框。这些细线会在掩码里连成一条贯穿的墨迹，
 * 把紧包围盒撑到区域全宽（或全高），并让"墨迹占比"之类的统计完全失真。
 *
 * 判据是**该行（列）最长连续墨迹段**，不是整行墨迹比例 —— 紧裁后的数字本身也可能
 * 占该行大部分宽度，用比例会把正常字行误删。长度阈值同时给出绝对值下限与相对比例下限。
 */
export function stripThinRules(mask, width, height, { minimum = 24, ratio = 0.72 } = {}) {
  const horizontalLimit = Math.max(minimum, Math.round(width * ratio))
  for (let y = 0; y < height; y += 1) {
    let run = 0
    let longest = 0
    for (let x = 0; x < width; x += 1) {
      if (mask[(y * width) + x]) {
        run += 1
        if (run > longest) longest = run
      } else {
        run = 0
      }
    }
    if (longest >= horizontalLimit) mask.fill(0, y * width, (y + 1) * width)
  }
  const verticalLimit = Math.max(minimum, Math.round(height * ratio))
  for (let x = 0; x < width; x += 1) {
    let run = 0
    let longest = 0
    for (let y = 0; y < height; y += 1) {
      if (mask[(y * width) + x]) {
        run += 1
        if (run > longest) longest = run
      } else {
        run = 0
      }
    }
    if (longest >= verticalLimit) {
      for (let y = 0; y < height; y += 1) mask[(y * width) + x] = 0
    }
  }
  return mask
}