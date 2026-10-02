// 角色字段级回归（CLI 薄壳）：读图/读字模/打印，识别逻辑在 src/lib/ocr/character.js（与网页共用）
// 用法：node scripts/ocr-regression.mjs [--digit-dir <字模目录>] [--truth <truth.json>] [--min-score 0.5] [--report <json 路径>]
import { readFileSync, writeFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { PNG } from 'pngjs'
import { cropMask, prepareTemplate, templateMask, tightBox } from '../src/lib/ocr/core.js'
import { CHARACTER_FIELDS, pickFieldRun, scanCharacterRuns } from '../src/lib/ocr/character.js'

const APP_DIR = path.resolve(import.meta.dirname, '..')
const PROJECT_DIR = path.resolve(APP_DIR, '..')
const OCR_DIR = path.join(APP_DIR, 'public', 'ocr')

const parseArgs = (argv) => {
  const options = {
    digitDir: path.join(OCR_DIR, 'font-templates', 'Abolition-game'),
    truth: path.join(PROJECT_DIR, '文档', 'ocr_samples', 'truth.json'),
    minScore: 0.5,
    report: '',
  }
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--digit-dir') options.digitDir = argv[++index]
    else if (argv[index] === '--truth') options.truth = argv[++index]
    else if (argv[index] === '--min-score') options.minScore = Number(argv[++index])
    else if (argv[index] === '--report') options.report = argv[++index]
  }
  return options
}

const readPng = (file) => {
  const png = PNG.sync.read(readFileSync(file))
  return { data: png.data, width: png.width, height: png.height }
}

/** 读字模目录（支持多变体命名：5.png / 5_base.png / 5_灰姑娘_3.png 都算 "5"） */
const loadTemplates = async (dir) => {
  const templates = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.png')) continue
    const image = readPng(path.join(dir, entry.name))
    const mask = templateMask(image)
    const box = tightBox(mask, image.width, image.height)
    if (!box) continue
    const base = entry.name.replace(/\.png$/i, '')
    const char = base.startsWith('dot') ? '.' : base.startsWith('percent') ? '%' : (base.match(/^(\d)/)?.[1] || base)
    templates.push(prepareTemplate({ char, ...cropMask(mask, image.width, box) }))
  }
  return templates
}

const main = async () => {
  const options = parseArgs(process.argv.slice(2))
  const truth = JSON.parse(readFileSync(options.truth, 'utf8'))
  const digitTemplates = await loadTemplates(options.digitDir)
  console.log(`=== 字段回归：${path.basename(options.digitDir)}（${digitTemplates.length} 个字模）===\n`)

  const report = []
  let totalHits = 0
  let totalSoftHits = 0
  let totalFields = 0
  for (const sample of truth.samples) {
    const image = readPng(path.join(PROJECT_DIR, '文档', 'ocr_samples', sample.file))
    const region = sample.region || { x0: 0, y0: 0, x1: image.width - 1, y1: image.height - 1 }
    const runs = scanCharacterRuns(image, { region, templates: digitTemplates, minScore: options.minScore })

    const fields = CHARACTER_FIELDS.map(({ key, label }) => {
      const value = sample[key]
      if (typeof value !== 'string') return null
      const best = pickFieldRun(runs, key, value)
      return {
        field: key,
        label,
        value,
        read: best ? best.text : '',
        mode: best ? best.run.mode : '',
        kind: best ? best.kind : '',
        exact: best ? best.kind === 'exact' : false,
        score: best ? Number(best.score.toFixed(3)) : 0,
        minCharScore: best && best.chars.length > 0 ? Math.min(...best.chars.map((char) => char.score)) : 0,
        chars: best ? best.chars.map((char) => `${char.char || '·'}:${char.score}`).join(' ') : '',
        trimmed: best && best.trimmedFrom ? `${best.trimmedFrom.char || '·'}:${best.trimmedFrom.score}` : '',
      }
    }).filter(Boolean)

    const equips = (sample.equipLevels || []).map((value, index) => {
      const best = pickFieldRun(runs, 'equip', value)
      return {
        label: `装备${index + 1}`,
        value,
        read: best ? best.text : '',
        exact: best ? best.kind === 'exact' : false,
      }
    })

    const hits = fields.filter((item) => item.exact).length
    const softHits = fields.filter((item) => !item.exact && item.kind === 'inside').length
    totalHits += hits
    totalSoftHits += softHits
    totalFields += fields.length

    console.log(`${sample.character}｜${sample.file}  ${image.width}x${image.height}  region ${region.x0},${region.y0}~${region.x1},${region.y1}`)
    for (const item of fields) {
      const mark = item.exact ? '✓' : item.kind === 'same-length' ? '≈' : '✗'
      const detail = item.exact
        ? `最低字置信 ${item.minCharScore.toFixed(2)}`
        : `${item.chars || '未识别'}`
      const trimNote = item.trimmed ? `  剪掉串首伪影 ${item.trimmed}` : ''
      console.log(`  ${mark} ${item.label}  ${item.value} → ${item.read || '未识别'}（${item.mode || '-'}，${item.score}）  ${detail}${trimNote}`)
    }
    const equipText = equips.map((item) => `${item.label}${item.value}→${item.read || '未识别'}${item.exact ? '✓' : '✗'}`).join('  ')
    console.log(`  · 装备等级（信息项）：${equipText}`)
    console.log(`  精确命中 ${hits}/${fields.length}${softHits ? `（另有 ${softHits} 项“包含命中”：识别串包含真值）` : ''}\n`)

    report.push({
      file: sample.file,
      character: sample.character,
      size: `${image.width}x${image.height}`,
      region,
      runs: runs.length,
      hits,
      total: fields.length,
      fields,
      equips,
    })
  }

  console.log(`=== 合计：主字段精确命中 ${totalHits}/${totalFields}，包含命中 ${totalSoftHits} 项 ===`)
  const reportFile = options.report || path.join(PROJECT_DIR, '文档', 'ocr_samples', `regression-report-${path.basename(options.digitDir)}.json`)
  writeFileSync(reportFile, `${JSON.stringify({ digitDir: options.digitDir, minScore: options.minScore, totalHits, totalSoftHits, totalFields, samples: report }, null, 2)}\n`, 'utf8')
  console.log(`报告：${reportFile}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})