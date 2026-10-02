// OCR 扫描 CLI：用项目内的模板对截图做数字/词条识别（Node 端，无需浏览器）
// 用法：node scripts/ocr-scan.mjs "<图片路径>" [--ink dark|light] [--min-score 0.55] [--labels] [--json]
//      [--region x0,y0,x1,y1]（只扫描该区域）
import { readFileSync, writeFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { PNG } from 'pngjs'
import {
  binarize,
  classifyComponent,
  cropMask,
  findComponents,
  groupComponentsIntoLines,
  normalizeToHeight,
  otsuThreshold,
  prepareTemplate,
  rankTemplates,
  rgbaToGray,
  scanNumbers,
  templateMask,
  tightBox,
} from '../src/lib/ocr/core.js'

const APP_DIR = path.resolve(import.meta.dirname, '..')
const OCR_DIR = path.join(APP_DIR, 'public', 'ocr')

const parseArgs = (argv) => {
  const options = { image: '', ink: 'dark', minScore: 0.55, json: false, labels: false, all: false, components: false, dump: '', digitDir: '', minHeight: 4, minPixels: 4, threshold: null, region: null }
  const rest = []
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--ink') { options.ink = argv[++index] }
    else if (arg === '--min-score') { options.minScore = Number(argv[++index]) }
    else if (arg === '--min-height') { options.minHeight = Number(argv[++index]) }
    else if (arg === '--threshold') { options.threshold = Number(argv[++index]) }
    else if (arg === '--min-pixels') { options.minPixels = Number(argv[++index]) }
    else if (arg === '--json') { options.json = true }
    else if (arg === '--labels') { options.labels = true }
    else if (arg === '--all') { options.all = true }
    else if (arg === '--components') { options.components = true }
    else if (arg === '--dump') { options.dump = argv[++index] }
    else if (arg === '--digit-dir') { options.digitDir = argv[++index] }
    else if (arg === '--region') {
      const parts = String(argv[++index]).split(',').map(Number)
      if (parts.length === 4 && parts.every(Number.isFinite)) {
        options.region = { x0: parts[0], y0: parts[1], x1: parts[2], y1: parts[3] }
      }
    } else { rest.push(arg) }
  }
  options.image = rest[0] || ''
  return options
}

const readPng = (file) => {
  const png = PNG.sync.read(readFileSync(file))
  return { data: png.data, width: png.width, height: png.height }
}

const loadTemplates = async (dir, nameOf) => {
  const files = await readdir(dir, { withFileTypes: true })
  const templates = []
  for (const entry of files) {
    if (!entry.isFile() || !entry.name.endsWith('.png')) continue
    const image = readPng(path.join(dir, entry.name))
    const mask = templateMask(image)
    const box = tightBox(mask, image.width, image.height)
    if (!box) continue
    const cropped = cropMask(mask, image.width, box)
    templates.push(prepareTemplate({ char: nameOf(entry.name), ...cropped }))
  }
  return templates
}

const digitName = (name) => {
  const base = name.replace(/\.png$/i, '')
  if (base.startsWith('dot')) return '.'
  if (base.startsWith('percent')) return '%'
  // 允许多个变体：5.png / 5_a.png / 5-2.png 都算作 "5"
  const match = base.match(/^(\d)/)
  return match ? match[1] : base
}

const main = async () => {
  const options = parseArgs(process.argv.slice(2))
  if (!options.image) {
    console.error('用法：node scripts/ocr-scan.mjs "<图片路径>" [--ink dark|light] [--min-score 0.55] [--labels] [--json]')
    process.exitCode = 1
    return
  }

  const image = readPng(options.image)
  const gray = rgbaToGray(image)
  const threshold = options.threshold ?? otsuThreshold(gray)
  const { mask } = binarize(gray, image.width, image.height, { mode: options.ink, threshold })
  const searchMask = options.region
    ? cropMask(mask, image.width, options.region)
    : { mask, width: image.width, height: image.height }
  const offsetX = options.region ? options.region.x0 : 0
  const offsetY = options.region ? options.region.y0 : 0

  const digitDir = options.digitDir || path.join(OCR_DIR, 'affix-values', 'light-black-text')
  const digitTemplates = await loadTemplates(digitDir, digitName)
  const numbers = scanNumbers(searchMask.mask, searchMask.width, searchMask.height, {
    digitTemplates,
    minScore: options.minScore,
    minHeight: options.minHeight,
    minPixels: options.minPixels,
    keepAll: options.all,
  }).map((item) => ({
    ...item,
    box: {
      x0: item.box.x0 + offsetX,
      y0: item.box.y0 + offsetY,
      x1: item.box.x1 + offsetX,
      y1: item.box.y1 + offsetY,
      width: item.box.width,
      height: item.box.height,
    },
  }))

  const labelMatches = []
  if (options.dump) {
    const png = new PNG({ width: searchMask.width, height: searchMask.height })
    for (let index = 0; index < searchMask.width * searchMask.height; index += 1) {
      const value = searchMask.mask[index] ? 0 : 255
      png.data[index * 4] = value
      png.data[index * 4 + 1] = value
      png.data[index * 4 + 2] = value
      png.data[index * 4 + 3] = 255
    }
    writeFileSync(options.dump, PNG.sync.write(png))
    console.log(`已导出二值化裁剪：${options.dump}`)
  }
  if (options.components) {
    const components = findComponents(searchMask.mask, searchMask.width, searchMask.height, { minHeight: options.minHeight })
      .sort((a, b) => a.x0 - b.x0)
    console.log(`连通域：${components.length} 个`)
    for (const component of components) {
      const ranks = rankTemplates(cropMask(searchMask.mask, searchMask.width, component), digitTemplates, { limit: 4 })
      const ranked = ranks.map((item) => `${item.char}:${item.score}`).join(' ')
      console.log(`  (${component.x0 + offsetX},${component.y0 + offsetY}) ${component.width}x${component.height} 墨迹${component.pixels}  →  ${ranked}`)
    }
  }
  if (options.labels) {
    const labelTemplates = [
      ...await loadTemplates(path.join(OCR_DIR, 'affix-labels', 'light'), (name) => `light/${name.replace(/\.png$/i, '')}`),
      ...await loadTemplates(path.join(OCR_DIR, 'affix-labels', 'dark'), (name) => `dark/${name.replace(/\.png$/i, '')}`),
    ]
    const components = findComponents(searchMask.mask, searchMask.width, searchMask.height, { minHeight: 8 })
    const lines = groupComponentsIntoLines(components)
    for (const line of lines) {
      const cropped = cropMask(searchMask.mask, searchMask.width, {
        x0: line.x0, y0: line.y0, x1: line.x1, y1: line.y1,
      })
      const normalized = normalizeToHeight(cropped, 32)
      let best = { char: '', score: 0 }
      for (const template of labelTemplates) {
        const score = jaccardInline(normalized, template.normalized)
        if (score > best.score) best = { char: template.char, score }
      }
      if (best.score >= 0.45) {
        labelMatches.push({
          label: best.char,
          score: Number(best.score.toFixed(3)),
          box: {
            x0: line.x0 + offsetX, y0: line.y0 + offsetY, x1: line.x1 + offsetX, y1: line.y1 + offsetY,
            width: line.x1 - line.x0 + 1, height: line.height,
          },
        })
      }
    }
  }

  if (options.json) {
    console.log(JSON.stringify({ image: options.image, size: `${image.width}x${image.height}`, threshold, ink: options.ink, numbers, labels: labelMatches }, null, 2))
    return
  }

  console.log(`图片：${options.image}`)
  console.log(`尺寸：${image.width} × ${image.height} · Otsu 阈值 ${threshold} · 墨迹模式 ${options.ink}`)
  console.log(`数字串：${numbers.length} 个`)
  for (const item of numbers) {
    console.log(`  "${item.text}"  位置(${item.box.x0},${item.box.y0})  字高 ${item.box.height}px  置信 ${item.score}`)
  }
  if (options.labels) {
    console.log(`词条名匹配：${labelMatches.length} 个`)
    for (const item of labelMatches) {
      console.log(`  ${item.label}  位置(${item.box.x0},${item.box.y0})  置信 ${item.score}`)
    }
  }
}

// 行级整块模板比对（高度已归一化，直接算 Jaccard）
const jaccardInline = (left, right) => {
  const width = Math.max(left.width, right.width)
  const height = Math.max(left.height, right.height)
  let intersection = 0
  let union = 0
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const leftInk = x < left.width && y < left.height ? left.mask[y * left.width + x] : 0
      const rightInk = x < right.width && y < right.height ? right.mask[y * right.width + x] : 0
      if (leftInk && rightInk) intersection += 1
      if (leftInk || rightInk) union += 1
    }
  }
  return union === 0 ? 0 : intersection / union
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})