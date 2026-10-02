// 按真值从游戏截图里自动切出“实拍字形”模板（无需手工标注）
// 用法：node scripts/extract-glyph-templates.mjs [--truth <truth.json>] [--out <目录>] [--base <基础字模目录>] [--max-variants 4]
// 流程：截图 →（按 region）裁剪 → 三路墨迹掩码（深字/亮字/彩字）→ 连通域按字高+中心线聚行
//       → 对每个真值数字串在行内找“等长窗口”（形状过滤 + 逐字分类一致率）
//       → 只切“分类与真值一致”的字形（存疑位一律跳过，避免标注污染）
//       → 掩码哈希去重 + 每字限量 → 输出字模目录（字体字模副本 + 实拍字形）
// 说明：
//   1) 三路掩码分别覆盖：深色数值（战斗力）、深底白字（等级/好感/装备等级）、橙色数值（属性）
//   2) 输出目录即“运行用字模集”：<字>_base.png 为字体渲染字模，<字>_<角色>_<n>.png 为游戏实拍字形
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
  findHoles,
  groupComponentsIntoRows,
  solidGlyph,
  templateMask,
  tightBox,
} from '../src/lib/ocr/core.js'

const APP_DIR = path.resolve(import.meta.dirname, '..')
const PROJECT_DIR = path.resolve(APP_DIR, '..')

const FIELD_LABELS = {
  level: '等级',
  levelCap: '等级上限',
  affection: '好感等级',
  combat: '战斗力',
  hp: '体力',
  atk: '攻击力',
  def: '防御力',
}

const parseArgs = (argv) => {
  const options = {
    truth: path.join(PROJECT_DIR, '文档', 'ocr_samples', 'truth.json'),
    out: path.join(APP_DIR, 'public', 'ocr', 'font-templates', 'Abolition-game'),
    base: path.join(APP_DIR, 'scripts', '_font_templates', 'Abolition-s3'),
    maxVariants: 4,
    lax: false,
    noClean: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--truth') options.truth = argv[++index]
    else if (argv[index] === '--out') options.out = argv[++index]
    else if (argv[index] === '--base') options.base = argv[++index]
    else if (argv[index] === '--max-variants') options.maxVariants = Number(argv[++index])
    else if (argv[index] === '--lax') options.lax = true
    else if (argv[index] === '--no-clean') options.noClean = true
  }
  return options
}

const readPng = (file) => {
  const png = PNG.sync.read(readFileSync(file))
  return { data: png.data, width: png.width, height: png.height }
}

/** 读字模目录（黑字白底 PNG → 墨迹掩码） */
const loadTemplates = async (dir) => {
  const templates = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.png')) continue
    const image = readPng(path.join(dir, entry.name))
    const mask = templateMask(image)
    const box = tightBox(mask, image.width, image.height)
    if (!box) continue
    templates.push({ char: charOf(entry.name), ...cropMask(mask, image.width, box) })
  }
  return templates
}

/** 文件名 → 字符（dot/percent 特殊，其余取首个数字） */
const charOf = (name) => {
  const base = name.replace(/\.png$/i, '')
  if (base.startsWith('dot')) return 'dot'
  if (base.startsWith('percent')) return 'percent'
  return base.match(/^(\d)/)?.[1] || base
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

const median = (values) => {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)]
}

/**
 * 窗口形状过滤：同一数字串应字号一致、字宽合理（排除图标/大色块）、
 * 墨迹填充率不过低（排除描边环/细线）、字距均匀（大间距排除“标签 → 数值”的空隙）
 */
const windowShapeOk = (window) => {
  const mid = median(window.map((item) => item.height))
  if (mid < 8) return false
  for (const item of window) {
    if (Math.abs(item.height - mid) > mid * 0.25) return false
    if (item.width > mid * 1.1) return false
    if (item.width < mid * 0.12) return false
    if (item.pixels < item.width * item.height * 0.3) return false
  }
  for (let index = 1; index < window.length; index += 1) {
    const gap = window[index].x0 - window[index - 1].x1 - 1
    if (gap > mid * 0.8 || gap < -mid * 0.3) return false
  }
  return true
}

/**
 * 为一个真值数字串收集候选窗口（一行内任意“等长连续片段”）
 * 候选只做发现，是否采用由 commit 阶段按一致率排序决定
 */
const discoverCandidates = (image, region, fields, baseTemplates, lax = false) => {
  const candidates = []
  const { gray, chroma, width, height } = analyzeColor(image, region)
  for (const pass of buildInkMasks(gray, chroma, width, height)) {
    const components = findComponents(pass.mask, width, height, { minHeight: 8, minPixels: 4, maxHeight: 120 })
    const items = []
    for (const component of components) {
      // pale 路是“浅色描边字”，字形要取描边 + 内部；其余路直接取墨迹
      const glyph = pass.name === 'pale' ? solidGlyph(pass.mask, width, component) : cropMask(pass.mask, width, component)
      items.push({ ...component, glyph, ...classifyComponent(glyph, baseTemplates, { minScore: 0.4 }) })
      // 镂空字（红心徽章里的好感数字、深底大块里的白字等）：洞本身就是要取的字形
      // 只从“宽高比 ≥0.85 的大块”取洞——数字自身的字内孔（如 0 的中间）是窄长条，会把数字行窗口搅乱
      if (pass.name !== 'pale' && component.pixels >= 60 && component.width >= component.height * 0.85 && component.height <= 96) {
        for (const hole of findHoles(pass.mask, width, component)) {
          if (hole.pixels < 8 || hole.height < 8) continue
          items.push({ ...hole, ...classifyComponent(hole.glyph, baseTemplates, { minScore: 0.4 }) })
        }
      }
    }
    for (const row of groupComponentsIntoRows(items)) {
      const ordered = [...row.components].sort((left, right) => left.x0 - right.x0)
      for (const [field, expected] of fields) {
        const minAgreement = lax ? 1 : Math.max(2, Math.ceil(expected.length * 0.6))
        for (let start = 0; start + expected.length <= ordered.length; start += 1) {
          const window = ordered.slice(start, start + expected.length)
          if (!windowShapeOk(window)) continue
          let agreement = 0
          let charScore = 0
          let classifiedText = ''
          for (let index = 0; index < expected.length; index += 1) {
            if (window[index].char === expected[index]) agreement += 1
            classifiedText += window[index].char || '·'
            charScore += window[index].score
          }
          if (agreement < minAgreement) continue
          candidates.push({
            field,
            expected,
            window,
            classifiedText,
            agreement,
            charScore,
            rank: agreement * 1000 + charScore,
            mode: pass.name,
            width,
            height,
          })
        }
      }
    }
  }
  return candidates
}

const main = async () => {
  const options = parseArgs(process.argv.slice(2))
  const truth = JSON.parse(readFileSync(options.truth, 'utf8'))
  const baseTemplates = await loadTemplates(options.base)

  mkdirSync(options.out, { recursive: true })
  // 清理旧字模，避免上次运行的残留影响结论（--no-clean 保留现有字形：用于 lax 追加采集）
  if (!options.noClean) {
    for (const entry of await readdir(options.out, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.png')) unlinkSync(path.join(options.out, entry.name))
    }
  }
  // 字体字模副本：<字>_base.png（与实拍字形同目录，运行时一次加载）
  const baseCopies = []
  for (const entry of await readdir(options.base, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.png')) continue
    const char = charOf(entry.name)
    copyFileSync(path.join(options.base, entry.name), path.join(options.out, `${char}_base.png`))
    baseCopies.push(char)
  }

  // PC 截图（分辨率高）优先处理，每字限量时优先保留 PC 渲染的字形
  const samples = []
  for (const sample of truth.samples) {
    const image = readPng(path.join(PROJECT_DIR, '文档', 'ocr_samples', sample.file))
    samples.push({ sample, image })
  }
  samples.sort((left, right) => right.image.width - left.image.width)

  const seen = new Map()
  // --no-clean 追加模式：预载磁盘上已有实拍字形的哈希，
  // 否则本次运行按空集合重建编号，会把同一字形以新文件名重复写一份
  if (options.noClean) {
    for (const entry of await readdir(options.out, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.png') || entry.name.includes('_base')) continue
      const image = readPng(path.join(options.out, entry.name))
      const mask = templateMask(image)
      const box = tightBox(mask, image.width, image.height)
      if (!box) continue
      const char = charOf(entry.name)
      if (!seen.has(char)) seen.set(char, new Set())
      seen.get(char).add(Buffer.from(cropMask(mask, image.width, box).mask).toString('base64').slice(0, 24))
    }
  }
  const report = []
  let cutIndex = 0

  for (const { sample, image } of samples) {
    const region = sample.region || { x0: 0, y0: 0, x1: image.width - 1, y1: image.height - 1 }
    // OCR 范围：等级 / 好感等级 / 战斗力（等级上限、体力/攻击力/防御力后续不再显示，不参与识别）
    const fields = Object.entries({
      level: sample.level,
      affection: sample.affection,
      combat: sample.combat,
    }).filter(([, value]) => typeof value === 'string' && /^\d+$/.test(value))

    const candidates = discoverCandidates(image, region, fields, baseTemplates, options.lax)
    candidates.sort((left, right) => right.rank - left.rank)

    const fieldDone = new Set()
    const usedBoxes = new Set()
    const matches = []
    for (const candidate of candidates) {
      if (fieldDone.has(candidate.field)) continue
      if (candidate.window.some((item) => usedBoxes.has(item))) continue
      fieldDone.add(candidate.field)
      const skipped = []
      let cut = 0
      candidate.window.forEach((item, index) => {
        usedBoxes.add(item)
        const expectedChar = candidate.expected[index]
        if (item.char !== expectedChar) {
          if (!options.lax) {
            skipped.push(`${index + 1}位读${item.char || '·'}`)
            return
          }
          // lax：窗口位置已按真值对齐，分类不符的位也按真值标注切（用于'6'被读成'8'等自锁场景）
          skipped.push(`${index + 1}位读${item.char || '·'}·lax`)
        }
        if (item.x0 <= 0 || item.y0 <= 0 || item.x1 >= candidate.width - 1 || item.y1 >= candidate.height - 1) {
          skipped.push(`${index + 1}位贴边`)
          return
        }
        const glyph = item.glyph
        const hash = Buffer.from(glyph.mask).toString('base64').slice(0, 24)
        if (!seen.has(expectedChar)) seen.set(expectedChar, new Set())
        const variants = seen.get(expectedChar)
        if (variants.has(hash) || variants.size >= options.maxVariants) return
        variants.add(hash)
        writeMaskPng(glyph.mask, glyph.width, glyph.height, path.join(options.out, `${expectedChar}_${sample.character}_${cutIndex}.png`))
        cutIndex += 1
        cut += 1
      })
      matches.push({
        field: candidate.field,
        expected: candidate.expected,
        classified: candidate.classifiedText,
        agreement: `${candidate.agreement}/${candidate.expected.length}`,
        mode: candidate.mode,
        cut,
        skipped,
      })
    }

    report.push({
      file: sample.file,
      character: sample.character,
      size: `${image.width}x${image.height}`,
      region,
      matched: matches,
      unmatched: fields.filter(([field]) => !fieldDone.has(field)).map(([field, value]) => `${FIELD_LABELS[field] || field}=${value}`),
    })
  }

  console.log(`=== 切字结果（字模集：${path.relative(APP_DIR, options.out)}）===`)
  for (const item of report) {
    console.log(`${item.character}  ${item.size}  命中 ${item.matched.length}/${item.matched.length + item.unmatched.length}`)
    for (const match of item.matched) {
      const label = FIELD_LABELS[match.field] || match.field
      const skipped = match.skipped.length ? `  跳过 ${match.skipped.join('、')}` : ''
      console.log(`    ${label} ${match.expected} → 读作 ${match.classified}（${match.agreement}，${match.mode}）切 ${match.cut}${skipped}`)
    }
    if (item.unmatched.length) console.log(`    未命中：${item.unmatched.join('  ')}`)
  }

  const lines = []
  for (const char of '0123456789') {
    const baseCount = baseCopies.includes(char) ? 1 : 0
    const gameCount = seen.get(char)?.size || 0
    lines.push(`${char}:${baseCount}+${gameCount}`)
  }
  console.log('=== 字模覆盖（字体 + 实拍）===')
  console.log(`  ${lines.join('  ')}`)
  const missing = [...'0123456789'].filter((char) => !baseCopies.includes(char) && !seen.get(char)?.size)
  console.log(missing.length ? `缺字：${missing.join(' ')}` : '0-9 全部有字模')

  writeFileSync(path.join(options.out, 'extract-report.json'), `${JSON.stringify({ base: path.basename(options.base), maxVariants: options.maxVariants, samples: report }, null, 2)}\n`, 'utf8')
  console.log(`报告：${path.relative(APP_DIR, path.join(options.out, 'extract-report.json'))}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})