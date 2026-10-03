// SPDX-License-Identifier: GPL-3.0-or-later
// 改造装备效果行的定位（纯函数，无 DOM / Node 依赖）
//
// 移植自 NIKKE Workshop（GPL-3.0-or-later）：
//   src/domain/equipmentScreenshotTemplate.js
//     - locateEquipmentEffectRowCentersFromBandScores  （原 L540-618）
//     - locateEquipmentEffectRowCenters                （原 L439-530）
//   src/services/localScreenshotOcr.js
//     - locateEffectRowCenters 的宽带/锁列扫描与两级降级（原 L147-216）
//
// 改动说明：
//   1) canvas 取像素换成本模块直接在 RGBA 上按行统计（无 DOM 依赖）
//   2) 包围盒统一用 { x0, y0, x1, y1 }（含端点）
//   3) 逻辑未改：两级顺序、判据、阈值、15 档色块分支、两枚锁不猜行的规则与原实现一致
//
// 关键点（原规格遗漏、也是满档行漏检的成因）：15 档满档行的整行深色背景会与底边
// 连成一个约 0.04~0.068 个面板宽的高色块；此时色块**下沿**才是那条固定底边。

const luminance = (red, green, blue) => (red * 0.299) + (green * 0.587) + (blue * 0.114)

const rectFromBox = (box) => ({
  left: box.x0,
  top: box.y0,
  width: box.x1 - box.x0 + 1,
  height: box.y1 - box.y0 + 1,
})

/** 词条宽带在面板内的比例（x 起止 × 面板宽，y 起止 × 面板高） */
const BAND = Object.freeze({ left: 0.075, right: 0.94, top: 0.45, bottom: 0.9 })
/** 锁图标列在面板内的比例 */
const LOCK_COLUMN = Object.freeze({ left: 0.86, right: 0.96, top: 0.45, bottom: 0.9 })

/** 相对行栏距：0.0645 个面板宽 */
export const ROW_STEP_RATIO = 0.0645
/** 行栏高：0.054 个面板宽 */
export const ROW_HEIGHT_RATIO = 0.054
/** 底边到行中心：行栏高的一半 */
export const ROW_EDGE_TO_CENTER_RATIO = ROW_HEIGHT_RATIO / 2

/** 连续高分区间并成 run（y 不连续即断开） */
const buildRuns = (rowScores, minimumScore) => {
  const runs = []
  let current = []
  for (const entry of rowScores) {
    const y = Number(entry?.y)
    const score = Number(entry?.score) || 0
    if (Number.isFinite(y) && score >= minimumScore) {
      if (current.length > 0 && y > current[current.length - 1].y + 1) {
        runs.push(current)
        current = []
      }
      current.push({ y, score })
    } else if (current.length > 0) {
      runs.push(current)
      current = []
    }
  }
  if (current.length > 0) runs.push(current)
  return runs
}

const weightedCenter = (run) => {
  const total = run.reduce((sum, entry) => sum + entry.score, 0)
  if (total <= 0) return run[0].y
  return run.reduce((sum, entry) => sum + (entry.y * entry.score), 0) / total
}

/**
 * 从词条卡片横向扫描分数定位三条效果栏（一级：胶囊横边）
 *
 * 每个物理词条位置（含"未获得效果"）都有一条横跨卡片的深色底边，因而它比可选的
 * 锁图标更适合作为几何锚点。只接受三条**短、强、等距**的横边，排除底部操作按钮
 * 与升级按钮（它们明显更高）。
 *
 * @param {{ y: number, score: number }[]} rowScores 每个 y 在词条宽带内的暗像素数
 * @returns {number[]} 行中心 y（绝对坐标）；不是恰好三个就返回 []
 */
export const locateRowCentersFromBandScores = (rowScores, { panelWidth, minimumScore = 1 } = {}) => {
  const width = Math.max(1, Number(panelWidth) || 1)
  if (!Array.isArray(rowScores) || rowScores.length === 0) return []

  const runs = buildRuns(rowScores, minimumScore)
  const maximumBorderHeight = Math.max(3, width * 0.022)
  const candidates = runs.flatMap((run) => {
    const total = run.reduce((sum, entry) => sum + entry.score, 0)
    const height = run[run.length - 1].y - run[0].y + 1
    if (height <= maximumBorderHeight) {
      return [{ center: weightedCenter(run), strength: total, height }]
    }
    // 15 档满档行：整行深底与底边连成高色块，取色块最末几行（即同一条底边）当锚点
    if (height >= width * 0.04 && height <= width * 0.068) {
      const edgeEntries = run.slice(-Math.max(1, Math.round(width * 0.004)))
      return [{
        center: run[run.length - 1].y,
        strength: edgeEntries.reduce((sum, entry) => sum + entry.score, 0),
        height,
      }]
    }
    return []
  }).sort((left, right) => left.center - right.center)

  const expectedStep = width * ROW_STEP_RATIO
  let best = null
  for (let first = 0; first < candidates.length - 2; first += 1) {
    for (let second = first + 1; second < candidates.length - 1; second += 1) {
      for (let third = second + 1; third < candidates.length; third += 1) {
        const selected = [candidates[first], candidates[second], candidates[third]]
        const firstGap = selected[1].center - selected[0].center
        const secondGap = selected[2].center - selected[1].center
        const deviations = [
          Math.abs(firstGap - expectedStep),
          Math.abs(secondGap - expectedStep),
          Math.abs(firstGap - secondGap),
        ]
        if (Math.max(...deviations) > expectedStep * 0.28) continue
        const spacingPenalty = deviations.reduce((sum, value) => sum + value, 0) / expectedStep
        const strengthBonus = Math.log1p(selected.reduce((sum, item) => sum + item.strength, 0))
        const score = spacingPenalty - (strengthBonus * 0.015)
        if (!best || score < best.score) best = { score, selected }
      }
    }
  }
  if (!best) return []
  const halfRowHeight = width * ROW_EDGE_TO_CENTER_RATIO
  return best.selected.map((candidate) => candidate.center - halfRowHeight)
}

/**
 * 从锁图标列的逐行暗像素分数定位三条效果栏（二级：回退）
 *
 * 锁图标与词条同行，且不受截图底部是否多出"LV 升级"等区域影响。满级装备有三枚锁；
 * "未获得效果"行没有锁图标，因此也支持用两枚锁加固定栏距补出缺失行——但只有两枚锁
 * 相隔约两个标准栏距时才能无歧义地判定缺的是**中间**行；相隔一个栏距时无法判断缺的是
 * 第一行还是第三行，此时不猜。
 *
 * @returns {number[]} 行中心 y（绝对坐标）；无法确定就返回 []
 */
export const locateRowCentersFromLocks = (rowScores, { panelWidth, minimumScore = 5 } = {}) => {
  const width = Math.max(1, Number(panelWidth) || 1)
  if (!Array.isArray(rowScores) || rowScores.length === 0) return []

  const runs = buildRuns(rowScores, minimumScore)
  const candidates = runs
    .filter((run) => run.length >= 2)
    .map((run) => ({
      center: weightedCenter(run),
      strength: run.reduce((sum, entry) => sum + entry.score, 0),
      height: run[run.length - 1].y - run[0].y + 1,
    }))
    .filter((candidate) => candidate.height <= width * 0.07)
    .sort((left, right) => left.center - right.center)

  const expectedStep = width * ROW_STEP_RATIO
  let best = null
  for (let first = 0; first < candidates.length - 2; first += 1) {
    for (let second = first + 1; second < candidates.length - 1; second += 1) {
      for (let third = second + 1; third < candidates.length; third += 1) {
        const selected = [candidates[first], candidates[second], candidates[third]]
        const firstGap = selected[1].center - selected[0].center
        const secondGap = selected[2].center - selected[1].center
        const maximumDeviation = Math.max(
          Math.abs(firstGap - expectedStep),
          Math.abs(secondGap - expectedStep),
        )
        if (maximumDeviation > expectedStep * 0.38) continue
        const spacingPenalty = (
          Math.abs(firstGap - expectedStep)
          + Math.abs(secondGap - expectedStep)
          + Math.abs(firstGap - secondGap)
        ) / expectedStep
        const strengthBonus = Math.log1p(selected.reduce((sum, item) => sum + item.strength, 0))
        const score = spacingPenalty - (strengthBonus * 0.02)
        if (!best || score < best.score) best = { score, selected }
      }
    }
  }
  if (best) return best.selected.map((candidate) => candidate.center)

  let bestPair = null
  for (let first = 0; first < candidates.length - 1; first += 1) {
    for (let second = first + 1; second < candidates.length; second += 1) {
      const firstCandidate = candidates[first]
      const secondCandidate = candidates[second]
      const gap = secondCandidate.center - firstCandidate.center
      const span = Math.abs(gap - (expectedStep * 2)) < Math.abs(gap - expectedStep) ? 2 : 1
      const deviation = Math.abs(gap - (expectedStep * span))
      if (deviation > expectedStep * 0.38) continue
      const strengthBonus = Math.log1p(firstCandidate.strength + secondCandidate.strength)
      const score = (deviation / expectedStep) - (strengthBonus * 0.02)
      if (!bestPair || score < bestPair.score) {
        bestPair = { score, firstCandidate, secondCandidate, gap, span }
      }
    }
  }
  if (!bestPair) return []
  if (bestPair.span === 2) {
    return [
      bestPair.firstCandidate.center,
      bestPair.firstCandidate.center + (bestPair.gap / 2),
      bestPair.secondCandidate.center,
    ]
  }
  return []
}

/** 按行统计指定矩形内亮度低于阈值的像素数（越界自动裁剪） */
const scanRowScores = (image, box, maximumLuminance) => {
  const left = Math.max(0, box.left)
  const top = Math.max(0, box.top)
  const right = Math.min(image.width, box.left + box.width)
  const bottom = Math.min(image.height, box.top + box.height)
  const rowScores = []
  for (let y = top; y < bottom; y += 1) {
    let score = 0
    for (let x = left; x < right; x += 1) {
      const index = ((y * image.width) + x) * 4
      if (luminance(image.data[index], image.data[index + 1], image.data[index + 2]) < maximumLuminance) {
        score += 1
      }
    }
    rowScores.push({ y, score })
  }
  return { rowScores, width: Math.max(1, right - left) }
}

/**
 * 行定位主入口（两级降级）
 *
 *   ① 胶囊横边（词条宽带内的暗像素扫描）
 *   ② 锁图标列
 *
 * 两级都要凑满三条：一级失败时若二级也只剩两枚锁且无法无歧义补行，则返回空——
 * **不返回推测行**（旧实现"按值串数量反推行号"正是本缺陷源头）。
 *
 * @param {{ data: Uint8ClampedArray|Uint8Array, width: number, height: number }} image
 * @param {{ x0, y0, x1, y1 }} panelBox 面板包围盒（绝对坐标）
 */
export const locateEffectRowCenters = (image, panelBox) => {
  const panel = rectFromBox(panelBox)
  const band = {
    left: Math.round(panel.left + (panel.width * BAND.left)),
    top: Math.round(panel.top + (panel.height * BAND.top)),
    width: Math.max(1, Math.round((panel.width * (BAND.right - BAND.left)))),
    height: Math.max(1, Math.round((panel.height * (BAND.bottom - BAND.top)))),
  }
  const bandScan = scanRowScores(image, band, 140)
  const structural = locateRowCentersFromBandScores(bandScan.rowScores, {
    panelWidth: panel.width,
    minimumScore: Math.max(8, Math.round(bandScan.width * 0.7)),
  })
  if (structural.length === 3) return { centers: structural, source: 'band', warnings: [] }

  const lockColumn = {
    left: Math.round(panel.left + (panel.width * LOCK_COLUMN.left)),
    top: Math.round(panel.top + (panel.height * LOCK_COLUMN.top)),
    width: Math.max(1, Math.round((panel.width * (LOCK_COLUMN.right - LOCK_COLUMN.left)))),
    height: Math.max(1, Math.round((panel.height * (LOCK_COLUMN.bottom - LOCK_COLUMN.top)))),
  }
  const lockScan = scanRowScores(image, lockColumn, 120)
  const fromLocks = locateRowCentersFromLocks(lockScan.rowScores, {
    panelWidth: panel.width,
    minimumScore: Math.max(5, Math.round(panel.width * 0.012)),
  })
  if (fromLocks.length === 3) return { centers: fromLocks, source: 'lock', warnings: [] }

  return { centers: [], source: null, warnings: ['ROW_DETECTION_FAILED'] }
}
