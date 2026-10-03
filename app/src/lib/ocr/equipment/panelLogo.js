// SPDX-License-Identifier: GPL-3.0-or-later
// 装备面板定位：OVERLOAD 标识检测 + 面板几何投影（纯函数，无 DOM / Node 依赖）
//
// 移植自 NIKKE Workshop（GPL-3.0-or-later）：
//   src/domain/equipmentScreenshotTemplate.js
//     - locateOverloadLogoFromRgba            （原 L209-367）
//     - projectEquipmentPanelFromOverload     （原 L92-142）
//     - maskRatio / visibleRectArea / measureProjectedPanelNeutrality
//     - locateLargestEquipmentPanel           （原 L624-695）
//   src/services/localScreenshotOcr.js
//     - locateEquipmentPanel 的降采样与三级降级链（原 L71-144）
//
// 改动说明：
//   1) 包围盒在本项目统一用 { x0, y0, x1, y1 }（含端点）；模块内部仍按 Workshop 的
//      left/top/width/height 计算，仅在出入口做一次转换，减少移植时的换算错误
//   2) 降采样由 canvas drawImage 换成本模块的 area-average 实现（无 DOM 依赖）
//   3) 逻辑未改：判据、阈值、打分权重、三级降级顺序与原实现一致

export const OVERLOAD_PANEL_GEOMETRY = Object.freeze({
  version: 1,
  overloadWidthRatio: 0.2114,
  overloadCenterXRatio: 0.4977,
  overloadTopOffsetRatio: 0.0394,
  panelAspectRatio: 1.688,
})

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value))

/** { x0, y0, x1, y1 }（含端点）→ { left, top, width, height }；不取整，便于保留缩放后的浮点值 */
const rectFromBox = (box) => ({
  left: box.x0,
  top: box.y0,
  width: box.x1 - box.x0 + 1,
  height: box.y1 - box.y0 + 1,
})

const boxFromRect = (rect) => ({
  x0: rect.left,
  y0: rect.top,
  x1: rect.left + rect.width - 1,
  y1: rect.top + rect.height - 1,
})

/** 与 Workshop normalizeBounds 一致：全部四舍五入，宽高至少为 1 */
const normalizeRect = (rect) => ({
  left: Math.round(Number(rect?.left) || 0),
  top: Math.round(Number(rect?.top) || 0),
  width: Math.max(1, Math.round(Number(rect?.width) || 1)),
  height: Math.max(1, Math.round(Number(rect?.height) || 1)),
})

/** RGBA 图按面积平均降采样（替代 canvas drawImage 的缩放质量） */
export const downsampleRgba = (image, targetWidth) => {
  const width = Math.max(1, Math.round(targetWidth))
  if (width >= image.width) return image
  const scale = width / image.width
  const height = Math.max(1, Math.round(image.height * scale))
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    const sourceY0 = Math.floor(y / scale)
    const sourceY1 = Math.max(sourceY0 + 1, Math.min(image.height, Math.ceil((y + 1) / scale)))
    for (let x = 0; x < width; x += 1) {
      const sourceX0 = Math.floor(x / scale)
      const sourceX1 = Math.max(sourceX0 + 1, Math.min(image.width, Math.ceil((x + 1) / scale)))
      let red = 0
      let green = 0
      let blue = 0
      let alpha = 0
      let count = 0
      for (let sourceY = sourceY0; sourceY < sourceY1; sourceY += 1) {
        for (let sourceX = sourceX0; sourceX < sourceX1; sourceX += 1) {
          const index = ((sourceY * image.width) + sourceX) * 4
          red += image.data[index]
          green += image.data[index + 1]
          blue += image.data[index + 2]
          alpha += image.data[index + 3]
          count += 1
        }
      }
      const target = ((y * width) + x) * 4
      data[target] = red / count
      data[target + 1] = green / count
      data[target + 2] = blue / count
      data[target + 3] = alpha / count
    }
  }
  return { data, width, height }
}

/** 裁剪后的可见矩形与可见覆盖率（rect 可越界，返回的是与图片求交后的矩形） */
const clipRectToImage = (rect, imageWidth, imageHeight) => {
  const width = Math.max(1, Math.round(Number(imageWidth) || 1))
  const height = Math.max(1, Math.round(Number(imageHeight) || 1))
  const right = rect.left + rect.width
  const bottom = rect.top + rect.height
  const visibleLeft = clamp(rect.left, 0, width)
  const visibleTop = clamp(rect.top, 0, height)
  const visibleRight = clamp(right, 0, width)
  const visibleBottom = clamp(bottom, 0, height)
  const clippedEdges = {
    left: rect.left < 0,
    top: rect.top < 0,
    right: right > width,
    bottom: bottom > height,
  }
  if (visibleRight <= visibleLeft || visibleBottom <= visibleTop) {
    return { rect: null, clippedEdges, visibleCoverage: 0 }
  }
  const clipped = {
    left: visibleLeft,
    top: visibleTop,
    width: visibleRight - visibleLeft,
    height: visibleBottom - visibleTop,
  }
  return {
    rect: clipped,
    clippedEdges,
    visibleCoverage: (clipped.width * clipped.height) / (rect.width * rect.height),
  }
}

/**
 * 由已确认的 OVERLOAD logo 包围盒投影外层白色装备面板
 *
 * `panelBox` 是未受截图边缘影响的理论面板；`visibleBox` 是限制到图片内的可见区域。
 * 调用方依据 `clippedEdges` / `visibleCoverage` 决定是否需要用户确认——
 * 被裁掉的内容不得视作已识别。
 */
export const projectEquipmentPanelFromOverload = (
  logoBox,
  { imageWidth, imageHeight, geometry = OVERLOAD_PANEL_GEOMETRY } = {},
) => {
  const raw = rectFromBox(logoBox)
  if (!Number.isFinite(Number(raw.width)) || Number(raw.width) <= 0) return null
  if (!Number.isFinite(Number(raw.height)) || Number(raw.height) <= 0) return null
  const overload = normalizeRect(raw)
  const {
    overloadWidthRatio, overloadCenterXRatio, overloadTopOffsetRatio, panelAspectRatio,
  } = geometry
  if (!Number.isFinite(overloadWidthRatio) || overloadWidthRatio <= 0) return null
  if (!Number.isFinite(overloadCenterXRatio) || !Number.isFinite(overloadTopOffsetRatio)) return null
  if (!Number.isFinite(panelAspectRatio) || panelAspectRatio <= 0) return null

  const panelWidth = overload.width / overloadWidthRatio
  const panelRect = normalizeRect({
    left: overload.left + (overload.width / 2) - (panelWidth * overloadCenterXRatio),
    top: overload.top - (panelWidth * overloadTopOffsetRatio),
    width: panelWidth,
    height: panelWidth * panelAspectRatio,
  })
  const hasImageBounds = Number.isFinite(Number(imageWidth)) && Number(imageWidth) > 0
    && Number.isFinite(Number(imageHeight)) && Number(imageHeight) > 0
  const visible = hasImageBounds
    ? clipRectToImage(panelRect, imageWidth, imageHeight)
    : {
      rect: panelRect,
      clippedEdges: { left: false, top: false, right: false, bottom: false },
      visibleCoverage: 1,
    }

  return {
    modelVersion: Number(geometry?.version) || 1,
    panelBox: boxFromRect(panelRect),
    visibleBox: visible.rect ? boxFromRect(visible.rect) : null,
    clippedEdges: visible.clippedEdges,
    visibleCoverage: visible.visibleCoverage,
  }
}

/** 指定矩形内掩码为 1 的比例；excludedRect 用于从分母里剔除（如 logo 自身） */
const maskRatio = (mask, width, height, rawRect, excludedRect = null) => {
  const left = clamp(Math.floor(rawRect.left), 0, width)
  const top = clamp(Math.floor(rawRect.top), 0, height)
  const right = clamp(Math.ceil(rawRect.left + rawRect.width), 0, width)
  const bottom = clamp(Math.ceil(rawRect.top + rawRect.height), 0, height)
  let matched = 0
  let total = 0
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      if (
        excludedRect
        && x >= excludedRect.left
        && x < excludedRect.left + excludedRect.width
        && y >= excludedRect.top
        && y < excludedRect.top + excludedRect.height
      ) {
        continue
      }
      matched += mask[(y * width) + x] ? 1 : 0
      total += 1
    }
  }
  return total > 0 ? matched / total : 0
}

/** 矩形在图片内的可见面积（用于按面积加权两侧中性带） */
const visibleRectArea = (rect, width, height) => {
  const left = clamp(Math.floor(rect.left), 0, width)
  const top = clamp(Math.floor(rect.top), 0, height)
  const right = clamp(Math.ceil(rect.left + rect.width), 0, width)
  const bottom = clamp(Math.ceil(rect.top + rect.height), 0, height)
  return Math.max(0, right - left) * Math.max(0, bottom - top)
}

/** 投影面板左右两条“侧栏”的中性（浅色低饱和）比例，用于排除角色立绘/红色按钮 */
const measureProjectedPanelNeutrality = (neutralMask, width, height, panel) => {
  const unit = panel.width
  const railTop = panel.top + (unit * 0.11)
  const railHeight = panel.height - (unit * 0.16)
  const leftRailRect = {
    left: panel.left + (unit * 0.025),
    top: railTop,
    width: unit * 0.055,
    height: railHeight,
  }
  const rightRailRect = {
    left: panel.left + (unit * 0.92),
    top: railTop,
    width: unit * 0.055,
    height: railHeight,
  }
  const leftArea = visibleRectArea(leftRailRect, width, height)
  const rightArea = visibleRectArea(rightRailRect, width, height)
  const visibleArea = leftArea + rightArea
  if (visibleArea === 0) return 0
  const leftRatio = maskRatio(neutralMask, width, height, leftRailRect)
  const rightRatio = maskRatio(neutralMask, width, height, rightRailRect)
  return ((leftRatio * leftArea) + (rightRatio * rightArea)) / visibleArea
}

/**
 * 从 RGBA 像素中确认红色 OVERLOAD 标识
 *
 * 主证据是固定的横向字形比例和红色像素密度；白色邻域与几何投影出的面板两侧亮度
 * 用于排除角色立绘、红色按钮和装备图标。返回中等置信候选，只有满足全部证据的
 * 候选才标 `high`。
 *
 * @param {{ data: Uint8ClampedArray|Uint8Array, width: number, height: number }} image
 * @returns {{ box, score, confidence, evidence, projection } | null}
 */
export const locateOverloadLogo = (image) => {
  const imageWidth = Math.round(Number(image?.width) || 0)
  const imageHeight = Math.round(Number(image?.height) || 0)
  const rgba = image?.data
  if (!rgba || imageWidth < 2 || imageHeight < 2 || rgba.length !== imageWidth * imageHeight * 4) {
    return null
  }

  const pixelCount = imageWidth * imageHeight
  const redMask = new Uint8Array(pixelCount)
  const neutralMask = new Uint8Array(pixelCount)
  for (let pixel = 0, offset = 0; pixel < pixelCount; pixel += 1, offset += 4) {
    const red = rgba[offset]
    const green = rgba[offset + 1]
    const blue = rgba[offset + 2]
    const maximum = Math.max(red, green, blue)
    const minimum = Math.min(red, green, blue)
    const luminance = (red * 0.299) + (green * 0.587) + (blue * 0.114)
    redMask[pixel] = red >= 165 && red - green >= 55 && red - blue >= 30 ? 1 : 0
    neutralMask[pixel] = luminance >= 175 && maximum - minimum <= 70 ? 1 : 0
  }

  // 字母之间存在窄缝。只做横向连接，避免把下方装备图标并入 logo
  const joinedMask = new Uint8Array(redMask)
  const horizontalJoin = Math.max(1, Math.min(3, Math.round(imageWidth / 400)))
  for (let y = 0; y < imageHeight; y += 1) {
    const rowStart = y * imageWidth
    for (let x = 0; x < imageWidth; x += 1) {
      const index = rowStart + x
      if (!redMask[index]) continue
      for (let gap = 1; gap <= horizontalJoin; gap += 1) {
        if (x >= gap) joinedMask[index - gap] = 1
        if (x + gap < imageWidth) joinedMask[index + gap] = 1
      }
    }
  }

  const visited = new Uint8Array(pixelCount)
  const queue = new Int32Array(pixelCount)
  const minimumRedPixels = Math.max(18, Math.round(pixelCount * 0.000025))
  const minimumLogoWidth = Math.max(12, Math.round(imageWidth * 0.012))
  let best = null

  for (let start = 0; start < pixelCount; start += 1) {
    if (!joinedMask[start] || visited[start]) continue
    let head = 0
    let tail = 0
    let redPixels = 0
    let minX = imageWidth
    let maxX = -1
    let minY = imageHeight
    let maxY = -1
    queue[tail++] = start
    visited[start] = 1

    while (head < tail) {
      const current = queue[head++]
      const x = current % imageWidth
      const y = Math.floor(current / imageWidth)
      if (redMask[current]) {
        redPixels += 1
        minX = Math.min(minX, x)
        maxX = Math.max(maxX, x)
        minY = Math.min(minY, y)
        maxY = Math.max(maxY, y)
      }
      if (x > 0 && joinedMask[current - 1] && !visited[current - 1]) {
        visited[current - 1] = 1
        queue[tail++] = current - 1
      }
      if (x + 1 < imageWidth && joinedMask[current + 1] && !visited[current + 1]) {
        visited[current + 1] = 1
        queue[tail++] = current + 1
      }
      if (y > 0 && joinedMask[current - imageWidth] && !visited[current - imageWidth]) {
        visited[current - imageWidth] = 1
        queue[tail++] = current - imageWidth
      }
      if (
        y + 1 < imageHeight
        && joinedMask[current + imageWidth]
        && !visited[current + imageWidth]
      ) {
        visited[current + imageWidth] = 1
        queue[tail++] = current + imageWidth
      }
    }

    if (redPixels < minimumRedPixels || maxX < minX || maxY < minY) continue
    const bounds = {
      left: minX,
      top: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
    }
    const aspectRatio = bounds.width / bounds.height
    if (bounds.width < minimumLogoWidth || bounds.height < 4) continue
    if (aspectRatio < 2.3 || aspectRatio > 4.8) continue
    const redFillRatio = redPixels / (bounds.width * bounds.height)
    if (redFillRatio < 0.28) continue
    const whiteHaloRatio = maskRatio(neutralMask, imageWidth, imageHeight, {
      left: bounds.left - (bounds.width * 0.35),
      top: bounds.top - (bounds.height * 0.5),
      width: bounds.width * 1.7,
      height: bounds.height * 1.75,
    }, bounds)
    if (whiteHaloRatio < 0.55) continue
    const projection = projectEquipmentPanelFromOverload(boxFromRect(bounds), {
      imageWidth,
      imageHeight,
    })
    if (!projection?.visibleBox) continue
    const panelNeutralRatio = measureProjectedPanelNeutrality(
      neutralMask,
      imageWidth,
      imageHeight,
      rectFromBox(projection.panelBox),
    )
    const aspectScore = clamp(1 - (Math.abs(aspectRatio - 3.35) / 1.45), 0, 1)
    const fillScore = clamp(1 - (Math.abs(redFillRatio - 0.75) / 0.42), 0, 1)
    const score = (aspectScore * 0.32)
      + (fillScore * 0.26)
      + (whiteHaloRatio * 0.22)
      + (panelNeutralRatio * 0.2)
    if (!best || score > best.score) {
      best = {
        box: boxFromRect(bounds),
        score,
        projection,
        evidence: {
          aspectRatio,
          redFillRatio,
          whiteHaloRatio,
          panelNeutralRatio,
        },
      }
    }
  }

  if (!best || best.score < 0.68) return null
  return {
    ...best,
    confidence: best.score >= 0.88
      && best.evidence.whiteHaloRatio >= 0.78
      && best.evidence.panelNeutralRatio >= 0.72
      ? 'high'
      : 'medium',
  }
}

/**
 * 在“亮、低饱和”布尔掩码里找最大的白色装备面板
 *
 * 完整 16:9 截图里装备弹窗宽度通常只占 28% 左右，所以下限取得较低，
 * 后续再由面积与形状评分挑最可信的候选。
 */
export const locateLargestEquipmentPanel = (mask, width, height) => {
  if (!mask || mask.length !== width * height || width < 2 || height < 2) return null
  const visited = new Uint8Array(mask.length)
  const queue = new Int32Array(mask.length)
  const minimumWidth = Math.max(32, width * 0.16)
  const minimumHeight = Math.max(48, height * 0.38)
  let best = null

  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || visited[start]) continue
    let head = 0
    let tail = 0
    queue[tail++] = start
    visited[start] = 1
    let count = 0
    let minX = width
    let maxX = 0
    let minY = height
    let maxY = 0

    while (head < tail) {
      const current = queue[head++]
      const x = current % width
      const y = Math.floor(current / width)
      count += 1
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
      const neighbours = [
        x > 0 ? current - 1 : -1,
        x + 1 < width ? current + 1 : -1,
        y > 0 ? current - width : -1,
        y + 1 < height ? current + width : -1,
      ]
      for (const next of neighbours) {
        if (next >= 0 && mask[next] && !visited[next]) {
          visited[next] = 1
          queue[tail++] = next
        }
      }
    }

    const componentWidth = maxX - minX + 1
    const componentHeight = maxY - minY + 1
    if (componentWidth < minimumWidth || componentHeight < minimumHeight) continue
    const boundingArea = componentWidth * componentHeight
    const fillRatio = count / boundingArea
    const coverage = boundingArea / (width * height)
    if (fillRatio < 0.35 || coverage < 0.08) continue
    const score = count * (1 + coverage)
    if (!best || score > best.score) {
      best = {
        left: minX,
        top: minY,
        width: componentWidth,
        height: componentHeight,
        fillRatio,
        coverage,
        score,
      }
    }
  }

  return best
}

const LOGO_SAMPLE_WIDTH = 800

/**
 * 把 logo 投影得到的面板框**横向吸附到真实面板边缘**
 *
 * 为什么必须做这一步：logo 检测跑在 min(800, 原宽) 的降采样图上，logo 宽只有 ~46px，
 * 而 `面板宽 = logo宽 / 0.2114` 把它放大约 11.4 倍 —— 采样上 1px 的整数化差异
 * 就是面板宽 ~11px 的误差。实测同一批 1920×1080 截图得到 525，而真实面板是 539。
 *
 * ROI 比例对这种尺度误差极敏感：数值区左边界 `0.525 × 面板宽`，实测数值墨迹从 0.529
 * 开始 —— 基准偏小 2.6% 就够把首位数字切掉。所以宽度的精度不能交给投影。
 *
 * 做法：以投影框为中心，在左右各 15% 宽的窗口内逐列统计"亮像素占比"，
 * 取包含面板中心的那段连续亮列区间。找到的宽度与投影宽度相差超过 tolerance 时
 * 判定不可信，返回 null（由调用方保留投影结果并标 `PANEL_SUSPECT`）。
 *
 * @returns {{ x0, y0, x1, y1 } | null} 只改横向范围，纵向沿用入参
 */
export const refinePanelWidth = (
  image,
  seedBox,
  { tolerance = 0.06, brightLevel = 200, minColumnRatio = 0.45, searchRatio = 0.15 } = {},
) => {
  const seedWidth = seedBox.x1 - seedBox.x0 + 1
  const seedHeight = seedBox.y1 - seedBox.y0 + 1
  if (seedWidth < 8 || seedHeight < 8) return null
  const insetY = Math.round(seedHeight * 0.05)
  const top = Math.max(0, seedBox.y0 + insetY)
  const bottom = Math.min(image.height - 1, seedBox.y1 - insetY)
  const rows = bottom - top + 1
  if (rows < 4) return null

  const centreX = Math.round((seedBox.x0 + seedBox.x1) / 2)
  const searchLeft = Math.max(0, seedBox.x0 - Math.round(seedWidth * searchRatio))
  const searchRight = Math.min(image.width - 1, seedBox.x1 + Math.round(seedWidth * searchRatio))
  const span = searchRight - searchLeft + 1
  const inside = new Uint8Array(span)
  for (let index = 0; index < span; index += 1) {
    const x = searchLeft + index
    let bright = 0
    for (let y = top; y <= bottom; y += 1) {
      const offset = ((y * image.width) + x) * 4
      const value = (image.data[offset] * 0.299)
        + (image.data[offset + 1] * 0.587)
        + (image.data[offset + 2] * 0.114)
      if (value >= brightLevel) bright += 1
    }
    inside[index] = (bright / rows) >= minColumnRatio ? 1 : 0
  }

  const origin = centreX - searchLeft
  if (origin < 0 || origin >= span || !inside[origin]) return null
  let left = origin
  while (left > 0 && inside[left - 1]) left -= 1
  let right = origin
  while (right < span - 1 && inside[right + 1]) right += 1
  const width = right - left + 1
  if (Math.abs(width - seedWidth) > seedWidth * tolerance) return null
  return {
    x0: searchLeft + left,
    y0: seedBox.y0,
    x1: searchLeft + right,
    y1: seedBox.y1,
  }
}

/**
 * 面板定位主入口（三级降级）
 *
 *   ① logo 几何投影     → source 'overload-geometry'
 *   ② 亮/低饱和连通域   → source 'bright-panel-fallback'
 *   ③ 整图兜底          → source 'full-image-fallback'
 *
 * 后两级一律标 `needs_confirmation`；整图兜底不返回 null（由调用方决定是否放弃）。
 *
 * @param {{ data: Uint8ClampedArray|Uint8Array, width: number, height: number }} image
 */
export const locatePanelV2 = (image) => {
  const sampleWidth = Math.min(LOGO_SAMPLE_WIDTH, image.width)
  const scale = sampleWidth / image.width
  const sample = downsampleRgba(image, sampleWidth)
  const logo = locateOverloadLogo(sample)
  if (logo) {
    const logoBox = {
      x0: logo.box.x0 / scale,
      y0: logo.box.y0 / scale,
      x1: logo.box.x1 / scale,
      y1: logo.box.y1 / scale,
    }
    const projection = projectEquipmentPanelFromOverload(logoBox, {
      imageWidth: image.width,
      imageHeight: image.height,
    })
    if (projection?.visibleBox) {
      // 投影只当种子：宽度吸附到真实面板边缘后，再按几何关系重算左 / 上 / 高。
      // 吸附失败（宽度与投影相差过大）时退回投影结果并标 needs_confirmation。
      let panelBox = projection.panelBox
      let box = projection.visibleBox
      let coverage = projection.visibleCoverage
      const clippedEdges = { ...projection.clippedEdges }
      let refined = false
      const snapped = refinePanelWidth(image, projection.panelBox)
      if (snapped) {
        const width = snapped.x1 - snapped.x0 + 1
        const rebuilt = {
          x0: snapped.x0,
          y0: Math.round(logoBox.y0 - (width * OVERLOAD_PANEL_GEOMETRY.overloadTopOffsetRatio)),
          x1: snapped.x1,
          y1: 0,
        }
        rebuilt.y1 = rebuilt.y0 + Math.round(width * OVERLOAD_PANEL_GEOMETRY.panelAspectRatio) - 1
        const clipped = clipRectToImage(rectFromBox(rebuilt), image.width, image.height)
        if (clipped.rect) {
          panelBox = boxFromRect(rebuilt)
          box = boxFromRect(clipped.rect)
          coverage = clipped.visibleCoverage
          Object.assign(clippedEdges, clipped.clippedEdges)
          refined = true
        }
      }
      const fullyVisible = coverage >= 0.94
      return {
        box,
        panelBox,
        source: 'overload-geometry',
        confidence: logo.confidence === 'high' && fullyVisible && refined ? 'high' : 'needs_confirmation',
        coverage,
        clippedEdges,
        refined,
        logo: {
          box: logo.box,
          score: logo.score,
          confidence: logo.confidence,
          evidence: logo.evidence,
        },
      }
    }
  }

  const sampleMask = new Uint8Array(sample.width * sample.height)
  for (let pixel = 0, offset = 0; pixel < sampleMask.length; pixel += 1, offset += 4) {
    const red = sample.data[offset]
    const green = sample.data[offset + 1]
    const blue = sample.data[offset + 2]
    const luminance = (red * 0.299) + (green * 0.587) + (blue * 0.114)
    const chroma = Math.max(red, green, blue) - Math.min(red, green, blue)
    sampleMask[pixel] = luminance >= 178 && chroma <= 68 ? 1 : 0
  }
  const located = locateLargestEquipmentPanel(sampleMask, sample.width, sample.height)
  if (!located) {
    return {
      box: { x0: 0, y0: 0, x1: image.width - 1, y1: image.height - 1 },
      panelBox: { x0: 0, y0: 0, x1: image.width - 1, y1: image.height - 1 },
      source: 'full-image-fallback',
      confidence: 'fallback',
      coverage: 1,
      clippedEdges: { left: false, top: false, right: false, bottom: false },
      logo: null,
    }
  }
  const padding = Math.max(2, Math.round(2 / scale))
  const left = Math.max(0, Math.floor(located.left / scale) - padding)
  const top = Math.max(0, Math.floor(located.top / scale) - padding)
  const right = Math.min(image.width, Math.ceil((located.left + located.width) / scale) + padding)
  const bottom = Math.min(image.height, Math.ceil((located.top + located.height) / scale) + padding)
  const box = { x0: left, y0: top, x1: right - 1, y1: bottom - 1 }
  return {
    box,
    panelBox: box,
    source: 'bright-panel-fallback',
    confidence: 'needs_confirmation',
    coverage: located.coverage,
    clippedEdges: { left: false, top: false, right: false, bottom: false },
    logo: null,
  }
}
