// 临时诊断：dump 抓帧图高亮行底条在 dark 掩码下的“洞”（白字镂空）结构，验证洞能否分离出值字形
// 用法：node scripts/_diag-holes.mjs <图片>
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { PNG } from 'pngjs'
import {
  analyzeColor,
  buildInkMasks,
  classifyComponent,
  findComponents,
  findHoles,
} from '../src/lib/ocr/core.js'
import { OCR_TUNING, charOfTemplateFile, valueTemplateFromImage } from '../src/lib/ocr/equipment.js'

const PANEL = { x0: 682, y0: 26, x1: 1237, y1: 997 }

const readPng = (file) => {
  const png = PNG.sync.read(readFileSync(file))
  return { data: png.data, width: png.width, height: png.height }
}

const tplDir = path.resolve(import.meta.dirname, '..', 'public', 'ocr', 'font-templates', 'Azonix-game')
const templates = []
for (const name of readdirSync(tplDir)) {
  if (!name.endsWith('.png')) continue
  const template = valueTemplateFromImage(readPng(path.join(tplDir, name)), charOfTemplateFile(name))
  if (template) templates.push(template)
}

const png = PNG.sync.read(readFileSync(process.argv[2]))
const { gray, chroma, width, height } = analyzeColor(
  { data: png.data, width: png.width, height: png.height },
  PANEL,
)
const passes = buildInkMasks(gray, chroma, width, height)
const dark = passes.find((pass) => pass.name === 'dark')
const components = findComponents(dark.mask, width, height, { minHeight: 3, minPixels: 3, maxHeight: 400 })
// 行3 区域（y 772-801）且宽度大的组件 = 高亮底条
const bars = components.filter((component) => component.y1 >= 770 && component.y0 <= 804 && component.x1 - component.x0 + 1 > 80)
console.log(`dark 掩码组件=${components.length}，行3 底条候选=${bars.length}`)
for (const bar of bars) {
  const box = { x0: bar.x0, y0: bar.y0, x1: bar.x1, y1: bar.y1 }
  const holes = findHoles(dark.mask, width, box)
  console.log(`\n底条 (${box.x0},${box.y0})-(${box.x1},${box.y1}) w=${box.x1 - box.x0 + 1} h=${box.y1 - box.y0 + 1} → 洞=${holes.length}`)
  for (const hole of holes) {
    const match = classifyComponent(hole.glyph, templates, { minScore: 0 })
    console.log(`  洞 (${hole.x0},${hole.y0})-(${hole.x1},${hole.y1}) w=${hole.width} h=${hole.height} pixels=${hole.pixels} → char=${JSON.stringify(match.char)} score=${match.score.toFixed(3)}`)
  }
}