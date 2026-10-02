// 装备改造词条识别器（CLI 薄壳）：读图 / 读模板 / 打印结果，识别逻辑在 src/lib/ocr/equipment.js（与网页共用）
// 用法：
//   node scripts/ocr-equipment.mjs --image <面板图> [--report <json>]
//   node scripts/ocr-equipment.mjs --samples [--report <json>]     // 样本回归（对比 truth.json）
import { readFileSync, writeFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { PNG } from 'pngjs'
import {
  OCR_TUNING,
  charOfTemplateFile,
  nameTemplateFromImage,
  recognizeEquipment,
  valueTemplateFromImage,
} from '../src/lib/ocr/equipment.js'
import { affixValueFromText } from '../src/data/affixTiers.js'

const APP_DIR = path.resolve(import.meta.dirname, '..')
const PROJECT_DIR = path.resolve(APP_DIR, '..')
const OCR_DIR = path.join(APP_DIR, 'public', 'ocr')
const TRUTH_FILE = path.join(PROJECT_DIR, '文档', 'ocr_samples', 'equipment', 'truth.json')

const parseArgs = (argv) => {
  const options = {
    image: '',
    samples: false,
    report: '',
    valueDir: path.join(OCR_DIR, 'font-templates', 'Azonix-game'),
    labelDir: path.join(OCR_DIR, 'affix-labels'),
    minScore: OCR_TUNING.minScore,
  }
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--image') options.image = argv[++index]
    else if (argv[index] === '--samples') options.samples = true
    else if (argv[index] === '--report') options.report = argv[++index]
    else if (argv[index] === '--value-dir') options.valueDir = argv[++index]
    else if (argv[index] === '--label-dir') options.labelDir = argv[++index]
    else if (argv[index] === '--min-score') options.minScore = Number(argv[++index])
  }
  return options
}

const readPng = (file) => {
  const png = PNG.sync.read(readFileSync(file))
  return { data: png.data, width: png.width, height: png.height }
}

const loadValueTemplates = async (dir) => {
  const templates = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.png')) continue
    const template = valueTemplateFromImage(readPng(path.join(dir, entry.name)), charOfTemplateFile(entry.name))
    if (template) templates.push(template)
  }
  return templates
}

const loadNameTemplates = async (dir) => {
  const templates = []
  for (const family of ['light', 'dark']) {
    for (const entry of await readdir(path.join(dir, family), { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.png')) continue
      const functionType = entry.name.replace(/\.png$/i, '')
      const template = nameTemplateFromImage(readPng(path.join(dir, family, entry.name)), { functionType, family })
      if (template) templates.push(template)
    }
  }
  return templates
}

/** 回归对比：真值 vs 识别，打印逐行对照 */
const printSample = (sample, result) => {
  console.log(`\n===== ${sample.file} =====`)
  const panelText = result.panel
    ? `面板 ${result.panel.x0},${result.panel.y0} → ${result.panel.x1},${result.panel.y1}`
    : '未定位到面板'
  console.log(`  [${panelText}]`)
  const statistics = { nameOk: 0, nameTotal: 0, valueOk: 0, valueTotal: 0, emptyOk: 0, emptyTotal: 0 }
  for (const truth of sample.rows) {
    const row = result.rows.find((item) => item.position === truth.position) || null
    if (truth.empty) {
      statistics.emptyTotal += 1
      const ok = row?.empty === true
      if (ok) statistics.emptyOk += 1
      console.log(`  r${truth.position} 真值 未获得效果        识别 ${row?.empty ? '空行' : `!! ${row?.name || '?'} ${row?.rawText || ''}`} ${ok ? '✓' : '✗'}`)
      continue
    }
    statistics.nameTotal += 1
    statistics.valueTotal += 1
    const nameOk = row && !row.empty && row.functionType === truth.functionType
    const valueOk = row && !row.empty && Math.abs((row.value ?? NaN) - affixValueFromText(truth.valueText)) < 1e-9
    if (nameOk) statistics.nameOk += 1
    if (valueOk) statistics.valueOk += 1
    console.log(`  r${truth.position} 真值 ${truth.name} ${truth.valueText}   识别 ${row?.empty ? '空行' : `${row?.name ?? '?'} ${row?.rawText ?? '?'}→${row?.value ?? '?'}`} [${row?.confidence ?? '-'}] ${nameOk ? '✓' : '✗'}${valueOk ? '✓' : '✗'}  名称分 ${row?.nameScore ?? 0}/${row?.nameMargin ?? 0}`)
  }
  if (result.warnings.length > 0) console.log(`  警示：${result.warnings.join('；')}`)
  return statistics
}

const main = async () => {
  const options = parseArgs(process.argv.slice(2))
  const context = {
    valueTemplates: await loadValueTemplates(options.valueDir),
    nameTemplates: await loadNameTemplates(options.labelDir),
    tuning: { minScore: options.minScore },
  }
  console.log(`值字模 ${context.valueTemplates.length} 个；名称模板 ${context.nameTemplates.length} 个；块分类阈值 ${options.minScore}`)

  if (options.samples) {
    const truth = JSON.parse(readFileSync(TRUTH_FILE, 'utf8'))
    const totals = { nameOk: 0, nameTotal: 0, valueOk: 0, valueTotal: 0, emptyOk: 0, emptyTotal: 0 }
    const report = { generatedAt: new Date().toISOString(), samples: [] }
    for (const sample of truth.samples) {
      const started = Date.now()
      const result = recognizeEquipment(readPng(path.join(PROJECT_DIR, '文档', 'ocr_samples', sample.file)), context)
      const statistics = printSample(sample, result)
      for (const key of Object.keys(totals)) totals[key] += statistics[key]
      report.samples.push({ file: sample.file, elapsedMs: Date.now() - started, truth: sample.rows, result })
    }
    console.log('\n== 回归汇总 ==')
    console.log(`  名称：${totals.nameOk}/${totals.nameTotal}   数值：${totals.valueOk}/${totals.valueTotal}   空行：${totals.emptyOk}/${totals.emptyTotal}`)
    if (options.report) {
      writeFileSync(options.report, JSON.stringify(report, null, 2))
      console.log(`  报告已写入：${options.report}`)
    }
  } else if (options.image) {
    const result = recognizeEquipment(readPng(options.image), context)
    console.log(JSON.stringify({ image: options.image, ...result }, null, 2))
    if (options.report) writeFileSync(options.report, JSON.stringify(result, null, 2))
  } else {
    console.log('用法：node scripts/ocr-equipment.mjs --image <面板图> [--report <json>] | --samples [--report <json>]')
  }
}

main()