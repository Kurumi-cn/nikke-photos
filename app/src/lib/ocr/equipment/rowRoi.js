// SPDX-License-Identifier: GPL-3.0-or-later
// 行 ROI 切分与墨迹读取（纯函数，无 DOM / Node 依赖）
//
// 比例来源：NIKKE Workshop（GPL-3.0-or-later）src/domain/equipmentScreenshotTemplate.js
//   的 createEquipmentRecognitionRegions（原 L375-430）
//
// 本项目新增（Workshop 没有）：
//   1) 越界守卫：紧裁后墨迹若贴到 ROI 左右边界，外扩一次重试；仍贴边则标 ROI_CLIPPED
//      —— 实测 value ROI 左界与数值首位墨迹只有 2px 余量，这道守卫不能省（规格 §5.4）
//   2) 空行判据：**不按 value 区有无墨迹判定**（空行的「未获得效果」居中短文本会侵入
//      value ROI，实测横跨 0.427~0.560），改为「无锁图标 + label 文本居中偏右」两路互证

import { stripThinRules } from '../core.js'
import { ROW_HEIGHT_RATIO, ROW_STEP_RATIO } from './rowDetect.js'

/** 各子区域在面板内的横向比例（x 起点 + 宽度），纵向由行中心 ± 行高/2 决定 */
export const REGION_RATIOS = Object.freeze({
  full: { x: 0.075, width: 0.865 },
  // Workshop 原值 0.075 + 0.47（右界 0.545），但实测数值墨迹最左到 0.529 —— 0.545
  // 会把数值首位数字吃进 label 掩码。据实测（label 墨迹最右 0.505、数值墨迹最左 0.529），
  // 分隔线只能落在 0.505~0.529 之间，故取 value 的左界 0.525 作为分界，宽度收为 0.45。
  label: { x: 0.075, width: 0.45 },
  value: { x: 0.525, width: 0.285 },
  lock: { x: 0.815, width: 0.125 },
})

/** 行中心未知时的兜底：从面板底部锚定（0.405 个面板宽 = 第一行底边） */
const FIRST_ROW_BOTTOM_OFFSET = 0.405
/** 越界外扩比例：左右各扩 ROI 宽度的 25% */
const GUARD_EXPAND_RATIO = 0.25
/**
 * 空行判据阈值：label 文字左沿超过该比例即认为是居中的「未获得效果」
 *
 * 实测分布（21 张样本 × 3 行）：真值空行恒为 `0.353`，有值行 `0.067 ~ 0.260`。
 * 取 0.30 —— 两侧余量分别约 0.04 与 0.053，分布居中。
 */
const EMPTY_LABEL_LEFT_RATIO = 0.30
/** label 区左侧需要跳过的"边框带"宽度比例：胶囊左竖边框落在这里，正常文字不会出现在此 */
const LABEL_BORDER_INSET_RATIO = 0.15
/** 判定"有锁图标"：lock 区墨迹占该区面积的比例下限（正常行实测 ~0.42，空行 ~0.03） */
const LOCK_MIN_INK_RATIO = 0.15

const luminance = (red, green, blue) => (red * 0.299) + (green * 0.587) + (blue * 0.114)

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

const clampBox = (box, width, height) => ({
  x0: Math.max(0, Math.min(width - 1, Math.round(box.x0))),
  y0: Math.max(0, Math.min(height - 1, Math.round(box.y0))),
  x1: Math.max(0, Math.min(width - 1, Math.round(box.x1))),
  y1: Math.max(0, Math.min(height - 1, Math.round(box.y1))),
})

/**
 * 生成三行的 ROI
 *
 * @param {{ x0, y0, x1, y1 }} panelBox 面板包围盒（绝对坐标，由 panelLogo 吸附后给出）
 * @param {number[]} rowCenters 三条行中心 y（绝对坐标）；不是恰好三条时走底部兜底
 * @param {{ width: number, height: number }} imageSize 用于把 ROI 夹在图片内
 */
export const createEffectRowRegions = (panelBox, rowCenters = [], imageSize = {}) => {
  const panel = rectFromBox(panelBox)
  const unit = panel.width
  const rowHeight = unit * ROW_HEIGHT_RATIO
  const hasCenters = Array.isArray(rowCenters)
    && rowCenters.length === 3
    && rowCenters.every((center) => Number.isFinite(Number(center)))
  const width = Number(imageSize.width) || 1
  const height = Number(imageSize.height) || 1

  return Array.from({ length: 3 }, (_, index) => {
    const top = hasCenters
      ? Number(rowCenters[index]) - (rowHeight / 2)
      : panel.top + panel.height - (unit * (FIRST_ROW_BOTTOM_OFFSET - (ROW_STEP_RATIO * index)))
    const make = (spec) => clampBox(boxFromRect({
      left: panel.left + (unit * spec.x),
      top,
      width: unit * spec.width,
      height: rowHeight,
    }), width, height)
    return {
      position: index + 1,
      centered: hasCenters,
      panelWidth: unit,
      full: make(REGION_RATIOS.full),
      label: make(REGION_RATIOS.label),
      value: make(REGION_RATIOS.value),
      lock: make(REGION_RATIOS.lock),
    }
  })
}

/** 判断某像素是否属于墨迹：'dark' 深色文字 / 'blue' 蓝色数值字（含亮蓝与灰蓝） */
const isInkPixel = (data, offset, mode) => {
  const red = data[offset]
  const green = data[offset + 1]
  const blue = data[offset + 2]
  if (mode === 'blue') {
    return blue >= 105 && green >= 70 && blue - red >= 38 && green - red >= 18
  }
  return luminance(red, green, blue) < 178
}

/** 取区域内的墨迹掩码（1 = 墨迹），坐标相对区域左上角 */
const regionInkMask = (image, box, mode, { stripRules = true } = {}) => {
  const width = box.x1 - box.x0 + 1
  const height = box.y1 - box.y0 + 1
  const mask = new Uint8Array(Math.max(0, width * height))
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (((box.y0 + y) * image.width) + box.x0 + x) * 4
      if (isInkPixel(image.data, offset, mode)) mask[(y * width) + x] = 1
    }
  }
  if (stripRules) stripThinRules(mask, width, height)
  let pixels = 0
  for (let index = 0; index < mask.length; index += 1) pixels += mask[index]
  return { mask, width, height, pixels }
}

/** 掩码的紧包围盒（相对区域坐标）；无墨迹返回 null */
const tightInkBounds = (mask, width, height) => {
  let x0 = width
  let y0 = height
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!mask[(y * width) + x]) continue
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  return x1 < x0 ? null : { x0, y0, x1, y1 }
}

/**
 * 读取一个区域的墨迹，并对**横向**做越界守卫
 *
 *   紧裁 → 墨迹贴到左/右边界？ → 左右各外扩 25% 重试 → 仍贴边则 guardFailed
 *
 * 只横向外扩：纵向 ROI 本来就留了余量，且纵向扩会吃进相邻行。
 *
 * @returns {{
 *   box, mode, mask, maskWidth, maskHeight, pixels,
 *   inkBox: {x0,y0,x1,y1}|null,   // 绝对坐标
 *   expanded: boolean, guardFailed: boolean, isEmpty: boolean,
 * }}
 */
export const readRegionInk = (image, box, { mode = 'dark', guard = true } = {}) => {
  const read = (target) => {
    const local = regionInkMask(image, target, mode)
    const bounds = tightInkBounds(local.mask, local.width, local.height)
    return { target, local, bounds }
  }

  let { target, local, bounds } = read(box)
  let expanded = false
  let guardFailed = false
  if (guard && bounds && local.width > 4) {
    const touchesLeft = bounds.x0 === 0
    const touchesRight = bounds.x1 === local.width - 1
    if (touchesLeft || touchesRight) {
      const pad = Math.max(2, Math.round(local.width * GUARD_EXPAND_RATIO))
      const widened = clampBox({
        x0: target.x0 - pad,
        y0: target.y0,
        x1: target.x1 + pad,
        y1: target.y1,
      }, image.width, image.height)
      const retry = read(widened)
      expanded = true
      if (retry.bounds) {
        target = widened
        local = retry.local
        bounds = retry.bounds
        guardFailed = retry.bounds.x0 === 0 || retry.bounds.x1 === retry.local.width - 1
      } else {
        guardFailed = true
      }
    }
  }

  const inkBox = bounds
    ? { x0: target.x0 + bounds.x0, y0: target.y0 + bounds.y0, x1: target.x0 + bounds.x1, y1: target.y0 + bounds.y1 }
    : null
  return {
    box: target,
    mode,
    mask: local.mask,
    maskWidth: local.width,
    maskHeight: local.height,
    pixels: local.pixels,
    inkBox,
    expanded,
    guardFailed,
    isEmpty: !bounds,
  }
}

/**
 * 空行判定（两路互证）
 *
 * 「未获得效果」行有两个可观测特征，实测都成立：
 *   1) **没有锁图标** —— lock 区无墨迹（正常行都有锁）
 *   2) **文本居中偏右** —— 墨迹中心实测约 0.494，而正常词条名（含括号）中心约 0.377~0.393
 *
 * 两者必须同时成立才判空：漏判成有值的代价（静默出错）远大于误判成空（用户手动改一下）。
 *
 * @returns {{ unearned, noLock, lockPixels, labelCenterRatio, labelWidthRatio, flags }}
 */
export const judgeUnearnedRow = (image, regions, { panelWidth } = {}) => {
  const unit = Number(panelWidth) || regions.panelWidth
  const lock = readRegionInk(image, regions.lock, { mode: 'dark', guard: false })
  // label 读取有两个刻意选择：
  //   1) **不加越界守卫** —— 空行的「未获得效果」横跨分隔线、必然被右界裁到，
  //      一旦外扩就会把数值区一并吞进来。判空只需要文字**左沿**，右侧被裁不影响它。
  //   2) **跳过左侧边框带** —— 胶囊左竖边框是 1px 细线、暗像素不连续，删通长线的做法
  //      删不掉它，实测会把左沿信号钉死在 0.013，完全盖住「未获得效果」的左沿。
  const labelWidthPx = regions.label.x1 - regions.label.x0 + 1
  const textRegion = {
    ...regions.label,
    x0: regions.label.x0 + Math.round(labelWidthPx * LABEL_BORDER_INSET_RATIO),
  }
  const label = readRegionInk(image, textRegion, { mode: 'dark', guard: false })
  const lockArea = (regions.lock.x1 - regions.lock.x0 + 1) * (regions.lock.y1 - regions.lock.y0 + 1)
  const lockFillRatio = lockArea > 0 ? lock.pixels / lockArea : 0
  const noLock = lockFillRatio < LOCK_MIN_INK_RATIO
  const labelLeftRatio = label.inkBox
    ? (label.inkBox.x0 - regions.label.x0) / unit
    : null
  const labelWidthRatio = label.inkBox
    ? (label.inkBox.x1 - label.inkBox.x0 + 1) / unit
    : 0
  const shiftedRight = labelLeftRatio === null || labelLeftRatio > EMPTY_LABEL_LEFT_RATIO
  const unearned = noLock && shiftedRight
  return {
    unearned,
    noLock,
    lockPixels: lock.pixels,
    lockFillRatio,
    labelLeftRatio,
    labelWidthRatio,
    labelInkBox: label.inkBox,
    flags: [],
  }
}

export { GUARD_EXPAND_RATIO, EMPTY_LABEL_LEFT_RATIO, LOCK_MIN_INK_RATIO, LABEL_BORDER_INSET_RATIO }
