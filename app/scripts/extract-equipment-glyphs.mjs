// 从“真图数值模板 + 装备面板截图”里自动切出游戏实拍字形，生成改造词条数值识别用的字模集
// 用法：node scripts/extract-equipment-glyphs.mjs [--out <目录>] [--max-variants 8] [--min-score 0.7]
//
// 素材 A：public/ocr/affix-value-templates/<FunctionType>/<tier>.png（135 张整值图，期望文本 = 档位表）
// 素材 B：文档/ocr_samples/equipment/*.png + truth.json（面板实拍，期望文本 = 各行 valueText）
//
// 切字流程：墨迹掩码 → 连通域（低阈值，保住小数点）→ 按“包围盒交叠”合并成字符块
//          （% 的左上圈/斜线/右下圈会并成一块；数字、小数点各自独立成块）→ 逐块分类
//          → 对期望字符串贪心对齐：分类与期望字符一致且分数达标的块才采集
//          → 贴边字形丢弃、掩码哈希去重、每字限量
// 说明：字模即掩码形状（与文字颜色无关）；面板需深字（dark）与蓝字（chroma）两路掩码分别处理
import { copyFileSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { PNG } from 'pngjs'
import {
  analyzeColor,
  buildInkMasks,
  classifyComponent,
  cropMask,
  findComponents,
  groupComponentsIntoRows,
  prepareTemplate,
  templateMask,
  tightBox,
} from '../src/lib/ocr/core.js'
import { AFFIX_TIER_VALUES, affixTierText } from '../src/data/affixTiers.js'

const APP_DIR = path.resolve(import.meta.dirname, '..')
const PROJECT_DIR = path.resolve(APP_DIR, '..')
const TIER_DIR = path.join(APP_DIR, 'public', 'ocr', 'affix-value-templates')
const FONT_ROOT = path.join(APP_DIR, 'scripts', '_font_templates')
// 基础字体：真图字形实测与 Azonix 家族最接近（探针对比过 8 种解包字体），三种渲染尺寸互补
const FONT_TAGS = { Azonix: 'azonix', 'Azonix-22': 'azonix22', 'Azonix-30': 'azonix30' }

const parseArgs = (argv) => {
  const options = {
    out: path.join(APP_DIR, 'public', 'ocr', 'font-templates', 'Azonix-game'),
    maxVariants: 8,
    minScore: 0.7,
  }
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--out') options.out = argv[++index]
    else if (argv[index] === '--max-variants') options.maxVariants = Number(argv[++index])
    else if (argv[index] === '--min-score') options.minScore = Number(argv[++index])
  }
  return options
}

const readPng = (file) => {
  const png = PNG.sync.read(readFileSync(file))
  return { data: png.data, width: png.width, height: png.height }
}

/** 文件名 → 字符（dot/percent 特殊，其余取首个数字） */
const charOf = (name) => {
  const base = name.replace(/\.png$/i, '')
  if (base.startsWith('dot')) return '.'
  if (base.startsWith('percent')) return '%'
  return base.match(/^(\d)/)?.[1] || base
}

/** 字符 → 文件名前缀 */
const fileCharOf = (char) => (char === '.' ? 'dot' : char === '%' ? 'percent' : char)

const loadFontTemplates = async (dir) => {
  const templates = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.png')) continue
    const image = readPng(path.join(dir, entry.name))
    const mask = templateMask(image)
    const box = tightBox(mask, image.width, image.height)
    if (!box) continue
    templates.push(prepareTemplate({ char: charOf(entry.name), ...cropMask(mask, image.width, box) }))
  }
  return templates
}

/** 写出黑字白底的 PNG */
const writeMaskPng = (mask, width, height, file) => {
  const png = new PNG({ width, height })
  for (let index = 0; index < width * height; index += 1) {
    const value = mask[index] ? 0 : 255
    png.data[index * 4] = value
    png.data[index * 4 + 1] = value
    png.data[index * 4 + 2] = value
    png.data[index * 4 + 3] = 255
  }
  writeFileSync(file, PNG.sync.write(png))
}

/**
 * 连通域 → 字符块：包围盒在 x 方向交叠/相接的域并成一块
 * （% 的左上圈/斜线/右下圈并成一块；数字、小数点各自独立成块）
 */
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
      last.pixels += component.pixels
    } else {
      blocks.push({ ...component })
    }
  }
  return blocks
}

/** 块分类：返回 { char, score, glyph }；char 为空表示不达标；结果缓存在块上（同一块只分类一次） */
const classifyBlock = (mask, width, block, templates, minScore) => {
  if (block._match) return block._match
  const glyph = cropMask(mask, width, block)
  const match = classifyComponent(glyph, templates, { minScore })
  block._match = { char: match.char, score: match.score, glyph }
  return block._match
}

/**
 * 对期望字符串贪心对齐：按顺序为每个期望字符找“分类一致且分数达标”的块
 * 找不到的字符直接跳过（不采也不阻塞后续字符）；图标/大色块/噪点不参与匹配
 */
const pickGlyphs = (mask, width, blocks, expected, templates, minScore) => {
  const picked = []
  let cursor = 0
  for (const char of expected) {
    for (let index = cursor; index < blocks.length; index += 1) {
      const block = blocks[index]
      if (block.width > 44 || block.height > 40 || block.height < 2) continue
      const guess = classifyBlock(mask, width, block, templates, minScore)
      if (guess.char !== char) continue
      picked.push({ char, block, score: guess.score, glyph: guess.glyph })
      cursor = index + 1
      break
    }
  }
  return picked
}

const main = async () => {
  const options = parseArgs(process.argv.slice(2))
  const truth = JSON.parse(readFileSync(path.join(PROJECT_DIR, '文档', 'ocr_samples', 'equipment', 'truth.json'), 'utf8'))

  // 字体字模：三个 Azonix 渲染尺寸合并成分类器（同名多变体，取最高分）
  const classifierTemplates = []
  for (const dir of Object.keys(FONT_TAGS)) {
    classifierTemplates.push(...(await loadFontTemplates(path.join(FONT_ROOT, dir))))
  }
  console.log(`分类器字模：${classifierTemplates.length} 个（${Object.keys(FONT_TAGS).join(' / ')}）`)

  // 输出目录：清空后写入字体字模副本 + 实拍字形
  mkdirSync(options.out, { recursive: true })
  for (const entry of await readdir(options.out, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.png')) unlinkSync(path.join(options.out, entry.name))
  }
  for (const [dir, tag] of Object.entries(FONT_TAGS)) {
    const source = path.join(FONT_ROOT, dir)
    for (const entry of await readdir(source, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.png')) continue
      copyFileSync(path.join(source, entry.name), path.join(options.out, `${fileCharOf(charOf(entry.name))}_font-${tag}.png`))
    }
  }

  const seenHashes = new Map()
  const counts = new Map()
  const skipped = { edge: 0, duplicate: 0, full: 0, partial: 0 }

  const collect = (char, picked) => {
    const { block, glyph, score } = picked
    const hash = Buffer.from(glyph.mask).toString('base64')
    const seen = seenHashes.get(char) || new Set()
    if (seen.size >= options.maxVariants) { skipped.full += 1; return }
    if (seen.has(hash)) { skipped.duplicate += 1; return }
    seen.add(hash)
    seenHashes.set(char, seen)
    const prior = counts.get(char) || 0
    counts.set(char, prior + 1)
    return { hash, score, seen }
  }

  const writeGlyph = (char, glyph, tag) => {
    writeMaskPng(glyph.mask, glyph.width, glyph.height, path.join(options.out, `${fileCharOf(char)}_${tag}.png`))
  }

  // 素材 B：面板实拍（更贴近实战环境，先采集）
  let panelNumber = 0
  for (const sample of truth.samples) {
    panelNumber += 1
    const image = readPng(path.join(PROJECT_DIR, '文档', 'ocr_samples', sample.file))
    const { gray, chroma, width, height } = analyzeColor(image)
    const expectedTexts = sample.rows.filter((row) => row.valueText).map((row) => row.valueText)
    let collected = 0
    for (const pass of buildInkMasks(gray, chroma, width, height)) {
      if (pass.name !== 'dark' && pass.name !== 'chroma') continue
      const components = findComponents(pass.mask, width, height, { minHeight: 2, minPixels: 2, maxHeight: 120 })
      for (const row of groupComponentsIntoRows(components)) {
        const blocks = buildCharBlocks(row.components)
        for (const text of expectedTexts) {
          for (const picked of pickGlyphs(pass.mask, width, blocks, [...text], classifierTemplates, options.minScore)) {
            if (picked.block.x0 <= 0 || picked.block.y0 <= 0 || picked.block.x1 >= width - 1 || picked.block.y1 >= height - 1) {
              skipped.edge += 1
              continue
            }
            const result = collect(picked.char, picked)
            if (!result) continue
            collected += 1
            writeGlyph(picked.char, picked.glyph, `panel${panelNumber}-${collected}`)
          }
        }
      }
    }
    console.log(`面板 ${sample.file}：采集 ${collected} 个字形（期望 ${expectedTexts.length} 串）`)
  }

  // 素材 A：档位整值图
  const tierEntries = []
  for (const functionType of Object.keys(AFFIX_TIER_VALUES)) {
    for (const entry of await readdir(path.join(TIER_DIR, functionType), { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.png')) tierEntries.push([functionType, entry.name])
    }
  }
  tierEntries.sort(([leftType, leftName], [rightType, rightName]) => leftType.localeCompare(rightType) || leftName.localeCompare(rightName))
  let tierNumber = 0
  let tierFull = 0
  for (const [functionType, name] of tierEntries) {
    tierNumber += 1
    const tier = Number(name.replace(/\.png$/i, ''))
    const expected = affixTierText(functionType, tier)
    if (!expected) continue
    const image = readPng(path.join(TIER_DIR, functionType, name))
    const mask = templateMask(image)
    const components = findComponents(mask, image.width, image.height, { minHeight: 2, minPixels: 2, maxHeight: 120 })
    const blocks = buildCharBlocks(components)
    const picks = pickGlyphs(mask, image.width, blocks, [...expected], classifierTemplates, options.minScore)
    let collected = 0
    for (const picked of picks) {
      if (picked.block.x0 <= 0 || picked.block.y0 <= 0 || picked.block.x1 >= image.width - 1 || picked.block.y1 >= image.height - 1) {
        skipped.edge += 1
        continue
      }
      const result = collect(picked.char, picked)
      if (!result) continue
      collected += 1
      writeGlyph(picked.char, picked.glyph, `tier-${functionType}-${tier}-${collected}`)
    }
    if (collected === expected.length) tierFull += 1
    else skipped.partial += expected.length - collected
    // 只把“不完整”的图打出来，完整图不刷屏
    if (collected !== expected.length) {
      console.log(`  [不完整] ${functionType}/${name} 期望 ${expected} 采到 ${picks.map((item) => item.char).join('')}`)
    }
  }
  console.log(`档位图：${tierEntries.length} 张，完整采集 ${tierFull} 张`)

  // 汇总
  console.log('\n== 采集报告 ==')
  for (const char of ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '%']) {
    const count = counts.get(char) || 0
    console.log(`  ${char}: ${count} 个实拍变体${count === 0 ? '  ← 缺字形！' : ''}`)
  }
  console.log(`跳过：贴边 ${skipped.edge} / 重复 ${skipped.duplicate} / 超限 ${skipped.full} / 未采到 ${skipped.partial}`)
  // 浏览器端无法列目录：扫目录输出清单（含字体副本与实拍字形）供前端加载
  const valueFiles = (await readdir(options.out, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.png'))
    .map((entry) => entry.name)
    .sort()
  writeFileSync(path.join(options.out, 'manifest.json'), JSON.stringify({
    generatedAt: new Date().toISOString(),
    valueFiles,
  }, null, 2))
  console.log(`输出目录：${path.relative(APP_DIR, options.out)}（manifest 列出 ${valueFiles.length} 个字模）`)
}

main()