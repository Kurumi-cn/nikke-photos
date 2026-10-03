// SPDX-License-Identifier: GPL-3.0-or-later
// 数值样式（字色 / 底色）判定：档位 ↔ 样式表 + 像素判读（纯函数，无 DOM / Node 依赖）
//
// 档位表来源：NIKKE Workshop（GPL-3.0-or-later）src/domain/equipmentScreenshotOcr.js
//   - OCR_VALUE_STYLES / expectedOcrValueStyle / isOcrValueStyleCompatible
//   - classifyOcrValueStyleFromRgba
//   - isDarkEffectRow（在 localScreenshotOcr.js）
//
// 游戏规则（本项目已用样本独立复核，见规格 §5.7）：
//   档位 1~11  → 浅底 + 普通灰蓝字（light-black-text）
//   档位 12~14 → 浅底 + 亮蓝字（light-blue-text）
//   档位 15    → 深底 + 亮蓝字（dark-blue-text）
//
// 注意：**规则本身可信 ≠ 我们对样式的判读可信**（抓帧压缩会让颜色漂移）。因此本模块
// 只负责"判读并如实上报"；是否用样式去约束候选档位由裁决层决定，且按 Q18 只做排序
// 加权、不做硬过滤。

export const OCR_VALUE_STYLES = Object.freeze({
  LIGHT_BLACK: 'light-black-text',
  LIGHT_BLUE: 'light-blue-text',
  DARK_BLUE: 'dark-blue-text',
})

/** 档位 → 期望样式；越界返回空串 */
export const expectedOcrValueStyle = (level) => {
  const tier = Number(level)
  if (tier >= 1 && tier <= 11) return OCR_VALUE_STYLES.LIGHT_BLACK
  if (tier >= 12 && tier <= 14) return OCR_VALUE_STYLES.LIGHT_BLUE
  if (tier === 15) return OCR_VALUE_STYLES.DARK_BLUE
  return ''
}

/** 样式是否与档位相容；未给出样式时一律相容 */
export const isOcrValueStyleCompatible = (level, valueStyle) => (
  !valueStyle || expectedOcrValueStyle(level) === valueStyle
)

/** 该样式是否为"蓝字"（决定墨迹掩码用蓝字判据还是暗字判据） */
export const isBlueTextStyle = (valueStyle) => (
  valueStyle === OCR_VALUE_STYLES.LIGHT_BLUE || valueStyle === OCR_VALUE_STYLES.DARK_BLUE
)

const luminance = (red, green, blue) => (red * 0.299) + (green * 0.587) + (blue * 0.114)

/** 该区域是否为"整行深色底"（15 档满档行的判据）；取平均亮度 < 135 */
export const isDarkEffectRow = (image, box) => {
  const x0 = Math.max(0, Math.round(box.x0))
  const y0 = Math.max(0, Math.round(box.y0))
  const x1 = Math.min(image.width - 1, Math.round(box.x1))
  const y1 = Math.min(image.height - 1, Math.round(box.y1))
  let total = 0
  let count = 0
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const offset = ((y * image.width) + x) * 4
      total += luminance(image.data[offset], image.data[offset + 1], image.data[offset + 2])
      count += 1
    }
  }
  return count > 0 && (total / count) < 135
}

/** 蓝字像素判据（与数值掩码、字符模板生成共用同一套阈值） */
export const isBlueTextPixel = (red, green, blue) => (
  blue >= 105 && green >= 70 && blue - red >= 38 && green - red >= 18
)

/**
 * 像素判读该行数值的样式
 *
 * 深底行直接判 DARK_BLUE（游戏里只有 15 档是深底行）；浅底行按蓝字像素占比判定，
 * 阈值取 0.003（沿用 Workshop：刻意取得很松，因为只有少数像素是纯蓝）。
 */
export const classifyValueStyle = (image, box, { darkBackground = false } = {}) => {
  const x0 = Math.max(0, Math.round(box.x0))
  const y0 = Math.max(0, Math.round(box.y0))
  const x1 = Math.min(image.width - 1, Math.round(box.x1))
  const y1 = Math.min(image.height - 1, Math.round(box.y1))
  let opaque = 0
  let blueText = 0
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const offset = ((y * image.width) + x) * 4
      if (image.data[offset + 3] < 32) continue
      opaque += 1
      if (isBlueTextPixel(image.data[offset], image.data[offset + 1], image.data[offset + 2])) {
        blueText += 1
      }
    }
  }
  if (opaque === 0) return ''
  if (darkBackground) return OCR_VALUE_STYLES.DARK_BLUE
  return (blueText / opaque) >= 0.003 ? OCR_VALUE_STYLES.LIGHT_BLUE : OCR_VALUE_STYLES.LIGHT_BLACK
}
