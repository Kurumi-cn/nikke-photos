// SPDX-License-Identifier: GPL-3.0-or-later
// 数值模板的按需加载 + 会话缓存（规格 §6）
//
// 为什么按需：磁盘上 135 张整值模板 + 49 张字符字模，一次性全部解码既慢又占内存，
// 而一次识别只需要**当前词条的那 15 张整值模板**（名称先定 functionType，模板路才启动）。
//
// 本文件不做 I/O：图片解码由注入的 `loadImage(relativePath)` 适配器负责，
// 浏览器用 fetch + createImageBitmap，CLI 用 pngjs。relativePath 是相对 OCR 根目录的
// 路径，浏览器适配器需自行加上项目 base（禁止写死 `/ocr/...`，否则子路径部署会 404）。

import { createValueGlyphMask } from './valueTemplate.js'

const fullTemplatePath = (functionType, level) => `affix-value-templates/${functionType}/${level}.png`
const glyphPath = (valueStyle, file) => `affix-values/${valueStyle}/${file}.png`

/**
 * @param {{ loadImage: (relativePath: string) => Promise<{data,width,height}> }} deps
 */
export const createValueTemplateLoader = ({ loadImage } = {}) => {
  if (typeof loadImage !== 'function') throw new Error('createValueTemplateLoader 需要 loadImage 适配器')
  const fullCache = new Map()
  const glyphCache = new Map()
  const stats = { fullRequests: 0, fullDecoded: 0, glyphRequests: 0, glyphDecoded: 0, failures: 0 }
  const failures = []

  const cached = (cache, key, path, build) => {
    if (!cache.has(key)) {
      cache.set(key, Promise.resolve()
        .then(() => loadImage(path))
        .then(build)
        .catch((error) => {
          // 失败不留在缓存里，否则一次网络抖动会让该模板永久不可用
          cache.delete(key)
          stats.failures += 1
          failures.push({ path, message: error?.message || String(error) })
          throw error
        }))
    }
    return cache.get(key)
  }

  /** 整值模板：`affix-value-templates/{functionType}/{level}.png`（整串路径恒用暗字判据，与 Workshop 一致） */
  const loadFullTemplate = (functionType, level) => {
    stats.fullRequests += 1
    const key = `${functionType}:${level}`
    return cached(fullCache, key, fullTemplatePath(functionType, level), (image) => {
      stats.fullDecoded += 1
      return createValueGlyphMask(image.data, image.width, image.height)
    })
  }

  /** 单字符字模：`affix-values/{valueStyle}/{file}.png`；蓝字样式需用蓝字判据取墨迹 */
  const loadGlyph = (file, { valueStyle, blueText = false } = {}) => {
    stats.glyphRequests += 1
    const key = `${valueStyle}:${file}`
    return cached(glyphCache, key, glyphPath(valueStyle, file), (image) => {
      stats.glyphDecoded += 1
      return createValueGlyphMask(image.data, image.width, image.height, { blueText })
    })
  }

  return {
    loadFullTemplate,
    loadGlyph,
    stats,
    failures,
    clear: () => {
      fullCache.clear()
      glyphCache.clear()
    },
  }
}
