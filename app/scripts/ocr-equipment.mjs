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
  locatePanel,
  nameTemplateFromImage,
  valueTemplateFromImage,
} from '../src/lib/ocr/equipment.js'
import { locatePanelV2 } from '../src/lib/ocr/equipment/panelLogo.js'
import { locateEffectRowCenters, ROW_STEP_RATIO } from '../src/lib/ocr/equipment/rowDetect.js'
import { createEffectRowRegions, judgeUnearnedRow, readRegionInk } from '../src/lib/ocr/equipment/rowRoi.js'
import { createValueTemplateLoader } from '../src/lib/ocr/equipment/valueTemplateLoader.js'
import { matchEquipmentValueTemplate, valueMaskFromRegion } from '../src/lib/ocr/equipment/valueTemplate.js'
import { classifyValueStyle, isBlueTextStyle, isDarkEffectRow, isOcrValueStyleCompatible } from '../src/lib/ocr/equipment/valueStyle.js'
import { matchNameGlyph, nameFamilyForRow, nameGlyphFromRegion } from '../src/lib/ocr/equipment/nameTemplate.js'
import { recognizeEquipment, recognizeEquipmentV2 } from '../src/lib/ocr/equipment/engine.js'
import { AFFIX_TIER_VALUES, affixValueFromText } from '../src/data/affixTiers.js'

const APP_DIR = path.resolve(import.meta.dirname, '..')
const PROJECT_DIR = path.resolve(APP_DIR, '..')
const OCR_DIR = path.join(APP_DIR, 'public', 'ocr')
const TRUTH_FILE = path.join(PROJECT_DIR, '文档', 'ocr_samples', 'equipment', 'truth.json')

const parseArgs = (argv) => {
  const options = {
    image: '',
    samples: false,
    panel: false,
    rows: false,
    roi: false,
    value: false,
    name: false,
    v2: false,
    report: '',
    engine: 'legacy',
    diff: false,
    valueDir: path.join(OCR_DIR, 'font-templates', 'Azonix-game'),
    labelDir: path.join(OCR_DIR, 'affix-labels'),
    minScore: OCR_TUNING.minScore,
  }
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--image') options.image = argv[++index]
    else if (argv[index] === '--samples') options.samples = true
    else if (argv[index] === '--panel') options.panel = true
    else if (argv[index] === '--rows') options.rows = true
    else if (argv[index] === '--roi') options.roi = true
    else if (argv[index] === '--value') options.value = true
    else if (argv[index] === '--name') options.name = true
    else if (argv[index] === '--v2') options.v2 = true
    else if (argv[index] === '--diff') options.diff = true
    else if (argv[index] === '--engine') options.engine = argv[++index]
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

/**
 * 按引擎组装 `recognizeEquipment` 的上下文（规格 §2.4 / §8.3）
 *
 * 旧链路只需要内存里的模板数组；新链路还要**按需加载器**（整值模板 + 单字符字模），
 * CLI 侧用 pngjs 从 `public/ocr` 直接读。
 */
const buildEngineContext = async (engine, options) => {
  const context = {
    engine,
    valueTemplates: await loadValueTemplates(options.valueDir),
    nameTemplates: await loadNameTemplates(options.labelDir),
    tuning: { minScore: options.minScore },
  }
  if (engine !== 'legacy') {
    const loader = createValueTemplateLoader({
      loadImage: (relative) => Promise.resolve(readPng(path.join(OCR_DIR, relative))),
    })
    context.loadFullTemplate = loader.loadFullTemplate
    context.loadGlyph = loader.loadGlyph
    context.loader = loader
  }
  return context
}

/** 真值行 → 期望档位（由数值反查档位表；查不到返回 null，该行不计入档位指标） */
const truthTierOf = (truth) => {
  const tiers = AFFIX_TIER_VALUES[truth.functionType]
  if (!tiers) return null
  const value = affixValueFromText(truth.valueText)
  const index = tiers.findIndex((item) => Math.abs(item - value) < 1e-9)
  return index >= 0 ? index + 1 : null
}

/**
 * 回归对比：真值 vs 识别，打印逐行对照，并产出规格 §8.1 的 12 项指标
 *
 * 分母口径（**不要与 `--diff` 混用**，见 §8.3）：
 *   行召回率 / 漏行数 / 名称 / 数值 / 档位 / 整行完全正确 → 真值的 **ok 行**
 *   空槽识别准确率                                      → 真值的 **空行**
 *   needsConfirm / 双路冲突 / 三态分布                   → **识别出的全部行**（3 × 样本数）
 *   引擎错误数                                          → **样本**（行级另有 `OCR_ENGINE_ERROR` 计数）
 */
const printSample = (sample, result) => {
  console.log(`\n===== ${sample.file} =====`)
  const panelText = result.panel
    ? `面板 ${result.panel.x0},${result.panel.y0} → ${result.panel.x1},${result.panel.y1}`
    : '未定位到面板'
  console.log(`  [${panelText}]`)
  const statistics = { nameOk: 0, nameTotal: 0, valueOk: 0, valueTotal: 0, emptyOk: 0, emptyTotal: 0 }
  // §8.1 指标与逐行打印走同一次遍历 —— 不为汇总再跑一遍识别
  const metrics = {
    truthOkRows: 0,
    truthEmptyRows: 0,
    status: { ok: 0, empty: 0, unknown: 0 },
    recall: 0,
    missing: 0,
    nameOk: 0,
    valueOk: 0,
    tierOk: 0,
    emptySlotOk: 0,
    exactOk: 0,
    rows: 0,
    needsConfirm: 0,
    needsConfirmOnFilled: 0,
    conflict: 0,
    engineErrorRows: 0,
    engineErrorSample: Boolean(result.engineError),
    fallback: result.engine === 'legacy',
  }
  for (const truth of sample.rows) {
    const row = result.rows.find((item) => item.position === truth.position) || null
    const status = row ? (row.status ?? (row.empty ? 'empty' : 'ok')) : 'unknown'
    if (truth.empty) {
      statistics.emptyTotal += 1
      metrics.truthEmptyRows += 1
      const ok = row?.empty === true
      if (ok) statistics.emptyOk += 1
      if (ok) metrics.emptySlotOk += 1
      console.log(`  r${truth.position} 真值 未获得效果        识别 ${row?.empty ? '空行' : `!! ${row?.name || '?'} ${row?.rawText || ''}`} ${ok ? '✓' : '✗'}`)
    } else {
      statistics.nameTotal += 1
      statistics.valueTotal += 1
      metrics.truthOkRows += 1
      const nameOk = row && !row.empty && row.functionType === truth.functionType
      const expectedTier = truthTierOf(truth)
      const tierOk = Boolean(nameOk) && expectedTier !== null && row.tier === expectedTier
      const valueOk = row && !row.empty && Math.abs((row.value ?? NaN) - affixValueFromText(truth.valueText)) < 1e-9
      if (nameOk) statistics.nameOk += 1
      if (valueOk) statistics.valueOk += 1
      if (nameOk) metrics.nameOk += 1
      if (valueOk) metrics.valueOk += 1
      if (tierOk) metrics.tierOk += 1
      if (nameOk && valueOk && tierOk) metrics.exactOk += 1
      // 行召回率 / 漏行数：真值有词条但这一行没被认成 ok（判成空行或 unknown 都算漏）
      if (status === 'ok') metrics.recall += 1
      else metrics.missing += 1
      // evidence 只在 v2 行上有；旧链路把 nameScore/nameMargin 放在行顶层
      const nameScore = row?.evidence?.nameScore ?? row?.nameScore ?? 0
      const nameMargin = row?.evidence?.nameMargin ?? row?.nameMargin ?? 0
      console.log(`  r${truth.position} 真值 ${truth.name} ${truth.valueText}   识别 ${row?.empty ? '空行' : `${row?.name ?? '?'} ${row?.rawText ?? (row?.tier ? `第${row.tier}档` : '?')}→${row?.value ?? '?'}`} [${row?.confidence ?? '-'}] ${nameOk ? '✓' : '✗'}${valueOk ? '✓' : '✗'}  名称分 ${nameScore}/${nameMargin}${row?.needsConfirm ? `  ⚠需核对 ${(row?.flags ?? []).join(',')}` : ''}`)
    }
    // 以下三项对**所有行**统计（真值空行被误判也要计入，否则冲突与误检方向看不见）
    metrics.rows += 1
    metrics.status[status] = (metrics.status[status] ?? 0) + 1
    if (row?.needsConfirm) {
      metrics.needsConfirm += 1
      if (!truth.empty) metrics.needsConfirmOnFilled += 1
    }
    if ((row?.flags ?? []).some((flag) => flag === 'NAME_VALUE_CONFLICT' || flag === 'TIER_STYLE_MISMATCH')) metrics.conflict += 1
    if ((row?.flags ?? []).includes('OCR_ENGINE_ERROR')) metrics.engineErrorRows += 1
  }
  if (result.warnings.length > 0) console.log(`  警示：${result.warnings.join('；')}`)
  return { ...statistics, metrics }
}

/** §8.1 指标累加器（`--samples --engine legacy|v2` 两边同口径，summary 可直接对照） */
const createMetrics = () => ({
  samples: 0,
  truthOkRows: 0,
  truthEmptyRows: 0,
  status: { ok: 0, empty: 0, unknown: 0 },
  recall: 0,
  missing: 0,
  nameOk: 0,
  valueOk: 0,
  tierOk: 0,
  emptySlotOk: 0,
  exactOk: 0,
  rows: 0,
  needsConfirm: 0,
  needsConfirmOnFilled: 0,
  conflict: 0,
  engineErrorRows: 0,
  engineErrorSamples: 0,
  fallbackSamples: 0,
  elapsed: [],
  stageMs: { logoMs: [], rowMs: [], roiMs: [], valueMs: [], nameMs: [] },
})

const mergeMetrics = (totals, metrics, elapsedMs, timing) => {
  totals.samples += 1
  for (const key of ['truthOkRows', 'truthEmptyRows', 'recall', 'missing', 'nameOk', 'valueOk', 'tierOk', 'emptySlotOk', 'exactOk', 'rows', 'needsConfirm', 'needsConfirmOnFilled', 'conflict', 'engineErrorRows']) {
    totals[key] += metrics[key]
  }
  for (const state of ['ok', 'empty', 'unknown']) totals.status[state] += metrics.status[state]
  if (metrics.engineErrorSample) totals.engineErrorSamples += 1
  if (metrics.fallback) totals.fallbackSamples += 1
  totals.elapsed.push(elapsedMs)
  // 旧链路不报耗时结构，stageMs 会留空 —— 报告里如实留空，不拿总耗时冒充分阶段
  for (const stage of Object.keys(totals.stageMs)) {
    if (typeof timing?.stages?.[stage] === 'number') totals.stageMs[stage].push(timing.stages[stage])
  }
}

/** 一组毫秒值的 avg / P95（P95 取「升序后向上取整位」，样本少时不外插） */
const timeStats = (values) => {
  if (values.length === 0) return { avg: null, p95: null }
  const sorted = [...values].sort((left, right) => left - right)
  const avg = sorted.reduce((sum, value) => sum + value, 0) / sorted.length
  const p95 = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)]
  return { avg, p95 }
}

const formatRate = (hit, total) => (total === 0 ? '—' : `${hit}/${total}  (${((hit / total) * 100).toFixed(1)}%)`)

const formatMsOrDash = (ms) => (typeof ms === 'number' ? `${ms.toFixed(0)}ms` : '—')

/** 打印规格 §8.1 的指标表（`--samples` 收尾） */
const printMetrics = (totals) => {
  console.log('\n== 回归汇总（规格 §8.1）==')
  console.log(`  行召回率        ${formatRate(totals.recall, totals.truthOkRows)}`)
  console.log(`  漏行数          ${totals.missing}`)
  console.log(`  名称准确率      ${formatRate(totals.nameOk, totals.truthOkRows)}`)
  console.log(`  数值准确率      ${formatRate(totals.valueOk, totals.truthOkRows)}`)
  console.log(`  档位准确率      ${formatRate(totals.tierOk, totals.truthOkRows)}`)
  console.log(`  空槽识别准确率  ${formatRate(totals.emptySlotOk, totals.truthEmptyRows)}`)
  console.log(`  整行完全正确率  ${formatRate(totals.exactOk, totals.truthOkRows)}`)
  console.log(`  needsConfirm 率 ${formatRate(totals.needsConfirm, totals.rows)}   其中有值行 ${totals.needsConfirmOnFilled}/${totals.truthOkRows}`)
  console.log(`  双路冲突率      ${formatRate(totals.conflict, totals.rows)}`)
  console.log(`  三态分布        ok ${totals.status.ok} / empty ${totals.status.empty} / unknown ${totals.status.unknown}   合计 ${totals.rows}`)
  console.log(`  引擎错误数      样本 ${totals.engineErrorSamples}/${totals.samples}   行（OCR_ENGINE_ERROR）${totals.engineErrorRows}   降级样本 ${totals.fallbackSamples}`)
  const total = timeStats(totals.elapsed)
  const stages = Object.entries(totals.stageMs)
    .filter(([, values]) => values.length > 0)
    .map(([name, values]) => {
      const stats = timeStats(values)
      return `${name.replace(/Ms$/, '')} ${stats.avg.toFixed(1)}`
    })
    .join(' / ')
  console.log(`  耗时 avg/P95    ${formatMsOrDash(total.avg)} / ${formatMsOrDash(total.p95)}   分阶段 avg：${stages || '—'}（旧链路不报分阶段）`)
}

/**
 * 面板定位对照（§11 #9）：旧 locatePanel（含 margin = 8）vs v2 logo 几何
 * 看三件事：logo 命中率、降级来源分布、两个 bbox 的尺寸与位移差
 */
const printPanelComparison = (reportFile) => {
  const truth = JSON.parse(readFileSync(TRUTH_FILE, 'utf8'))
  const summary = { total: 0, logoHigh: 0, logoMedium: 0, geometry: 0, bright: 0, fullImage: 0 }
  const report = { generatedAt: new Date().toISOString(), samples: [] }
  console.log('\n== 面板定位对照（旧 locatePanel vs v2 logo 几何）==')
  for (const sample of truth.samples) {
    const image = readPng(path.join(PROJECT_DIR, '文档', 'ocr_samples', sample.file))
    const legacy = locatePanel(image, OCR_TUNING)
    const v2 = locatePanelV2(image)
    summary.total += 1
    summary.geometry += v2.source === 'overload-geometry' ? 1 : 0
    summary.bright += v2.source === 'bright-panel-fallback' ? 1 : 0
    summary.fullImage += v2.source === 'full-image-fallback' ? 1 : 0
    summary.logoHigh += v2.logo?.confidence === 'high' ? 1 : 0
    summary.logoMedium += v2.logo?.confidence === 'medium' ? 1 : 0
    report.samples.push({
      file: sample.file,
      image: { width: image.width, height: image.height },
      legacy,
      v2,
    })
    const size = (box) => `${box.x1 - box.x0 + 1}×${box.y1 - box.y0 + 1}`
    const delta = legacy
      ? `Δ位置 ${v2.box.x0 - legacy.x0},${v2.box.y0 - legacy.y0}   Δ尺寸 ${(v2.box.x1 - v2.box.x0) - (legacy.x1 - legacy.x0)},${(v2.box.y1 - v2.box.y0) - (legacy.y1 - legacy.y0)}`
      : '旧实现未定位到面板'
    const logoText = v2.logo
      ? `logo ${v2.logo.confidence} 分 ${v2.logo.score.toFixed(3)}${v2.refined ? ' 宽度已吸附' : ' 宽度未吸附'}`
      : 'logo 缺失'
    console.log(`  ${sample.file}`)
    console.log(`    旧 ${legacy ? `${legacy.x0},${legacy.y0} → ${legacy.x1},${legacy.y1}  (${size(legacy)})` : 'null'}`)
    console.log(`    v2 ${v2.box.x0},${v2.box.y0} → ${v2.box.x1},${v2.box.y1}  (${size(v2.box)})   ${v2.source} / ${v2.confidence}   覆盖率 ${v2.coverage.toFixed(3)}   ${logoText}`)
    console.log(`    ${delta}`)
  }
  console.log('\n== 面板定位汇总 ==')
  console.log(`  样本 ${summary.total}；logo high ${summary.logoHigh}、medium ${summary.logoMedium}、缺失 ${summary.total - summary.logoHigh - summary.logoMedium}`)
  console.log(`  来源：logo 几何 ${summary.geometry}、亮面板回退 ${summary.bright}、整图兜底 ${summary.fullImage}`)
  report.summary = summary
  if (reportFile) {
    writeFileSync(reportFile, JSON.stringify(report, null, 2))
    console.log(`  报告已写入：${reportFile}`)
  }
}

/**
 * 行定位验证（P4）：面板定位 → 行定位，打印来源、行中心与相邻间距
 * 间距应接近 panelWidth × 0.0645；三行等距是行检测成立的直接证据
 */
const printRowDetection = (reportFile) => {
  const truth = JSON.parse(readFileSync(TRUTH_FILE, 'utf8'))
  const summary = { total: 0, band: 0, lock: 0, failed: 0 }
  const report = { generatedAt: new Date().toISOString(), samples: [] }
  console.log('\n== 行定位（胶囊横边 → 锁图标回退）==')
  for (const sample of truth.samples) {
    const image = readPng(path.join(PROJECT_DIR, '文档', 'ocr_samples', sample.file))
    const panel = locatePanelV2(image)
    const rows = locateEffectRowCenters(image, panel.box)
    const panelWidth = panel.box.x1 - panel.box.x0 + 1
    const expectedStep = panelWidth * ROW_STEP_RATIO
    summary.total += 1
    summary.band += rows.source === 'band' ? 1 : 0
    summary.lock += rows.source === 'lock' ? 1 : 0
    summary.failed += rows.source === null ? 1 : 0
    report.samples.push({ file: sample.file, panelBox: panel.box, panelWidth, expectedStep, ...rows })
    const gaps = rows.centers.length === 3
      ? `${(rows.centers[1] - rows.centers[0]).toFixed(1)} / ${(rows.centers[2] - rows.centers[1]).toFixed(1)}`
      : '—'
    console.log(`  ${sample.file}`)
    console.log(`    面板宽 ${panelWidth}  期望间距 ${expectedStep.toFixed(1)}  来源 ${rows.source ?? '失败'}  中心 ${rows.centers.map((center) => center.toFixed(1)).join(', ') || '—'}  实际间距 ${gaps}`)
  }
  console.log('\n== 行定位汇总 ==')
  console.log(`  样本 ${summary.total}；胶囊横边 ${summary.band}、锁图标回退 ${summary.lock}、失败 ${summary.failed}`)
  report.summary = summary
  if (reportFile) {
    writeFileSync(reportFile, JSON.stringify(report, null, 2))
    console.log(`  报告已写入：${reportFile}`)
  }
}

/**
 * 行 ROI 与空行判定验证（P4）
 *
 * 判定基准：真值的 8 条空行必须全部判空；真值的有值行不得被判空。
 * 顺带统计 value/label ROI 的越界守卫触发情况。
 */
const printRowRoi = (reportFile) => {
  const truth = JSON.parse(readFileSync(TRUTH_FILE, 'utf8'))
  const summary = {
    samples: 0,
    emptyTotal: 0,
    emptyOk: 0,
    filledTotal: 0,
    filledOk: 0,
    valueGuardFailed: 0,
    valueExpanded: 0,
    labelClipped: 0,
  }
  const report = { generatedAt: new Date().toISOString(), samples: [] }
  console.log('\n== 行 ROI 与空行判定 ==')
  for (const sample of truth.samples) {
    const image = readPng(path.join(PROJECT_DIR, '文档', 'ocr_samples', sample.file))
    const panel = locatePanelV2(image)
    const rows = locateEffectRowCenters(image, panel.box)
    const regions = createEffectRowRegions(panel.box, rows.centers, image)
    const panelWidth = panel.box.x1 - panel.box.x0 + 1
    summary.samples += 1
    const entries = []
    console.log(`  ${sample.file}   面板宽 ${panelWidth}   行定位 ${rows.source ?? '失败'}`)
    for (const region of regions) {
      const judge = judgeUnearnedRow(image, region, { panelWidth })
      const value = readRegionInk(image, region.value, { mode: 'blue' })
      const truthRow = sample.rows.find((row) => row.position === region.position)
      const truthEmpty = Boolean(truthRow?.empty)
      const ok = truthEmpty === judge.unearned
      if (truthEmpty) {
        summary.emptyTotal += 1
        summary.emptyOk += ok ? 1 : 0
      } else {
        summary.filledTotal += 1
        summary.filledOk += judge.unearned ? 0 : 1
      }
      if (!truthEmpty && value.guardFailed) summary.valueGuardFailed += 1
      if (value.expanded) summary.valueExpanded += 1
      entries.push({ position: region.position, truthEmpty, truth: truthRow, judge, value: { inkBox: value.inkBox, pixels: value.pixels, expanded: value.expanded, guardFailed: value.guardFailed } })
      const left = judge.labelLeftRatio === null ? '无' : judge.labelLeftRatio.toFixed(3)
      const valueText = truthEmpty
        ? '—'
        : `value墨迹 ${value.inkBox ? `${value.inkBox.x0}~${value.inkBox.x1}(${value.inkBox.x1 - value.inkBox.x0 + 1}px)` : '无'}${value.guardFailed ? ' ⚠越界' : ''}`
      console.log(`    r${region.position} 真值 ${truthEmpty ? '空行' : (truthRow?.name ?? '?')}   判定 ${judge.unearned ? '空行' : '有值'} ${ok ? '✓' : '✗'}   label左沿 ${left} / 宽 ${judge.labelWidthRatio.toFixed(3)}   lock占比 ${judge.lockFillRatio.toFixed(3)}   ${valueText}`)
    }
    report.samples.push({ file: sample.file, panelBox: panel.box, rowCenters: rows.centers, rowSource: rows.source, entries })
  }
  console.log('\n== ROI 汇总 ==')
  console.log(`  样本 ${summary.samples}   空行判定 ${summary.emptyOk}/${summary.emptyTotal}   有值行未被误判为空 ${summary.filledOk}/${summary.filledTotal}`)
  console.log(`  value ROI 越界守卫：外扩 ${summary.valueExpanded} 次、仍贴边 ${summary.valueGuardFailed} 次`)
  report.summary = summary
  if (reportFile) {
    writeFileSync(reportFile, JSON.stringify(report, null, 2))
    console.log(`  报告已写入：${reportFile}`)
  }
}

/**
 * 数值模板匹配验证（P5）
 *
 * **用真值的 functionType 喂给匹配器**，把"名称识别"这一环排除在外 —— 这样测到的
 * 就是数值匹配本身的水平（否则名称错了会连坐，分不清是哪一环的问题）。
 * 判定标准：识别档位是否与真值档位一致。
 */
const printValueMatch = async (reportFile) => {
  const truth = JSON.parse(readFileSync(TRUTH_FILE, 'utf8'))
  const loader = createValueTemplateLoader({
    loadImage: (relative) => Promise.resolve(readPng(path.join(OCR_DIR, relative))),
  })
  const summary = {
    rows: 0,
    tierOk: 0,
    miss: 0,
    styleMismatch: 0,
    truthTierMissing: 0,
    methods: {},
    styles: {},
  }
  const report = { generatedAt: new Date().toISOString(), samples: [] }
  console.log('\n== 数值模板匹配（用真值 functionType 隔离名称环节）==')
  for (const sample of truth.samples) {
    const image = readPng(path.join(PROJECT_DIR, '文档', 'ocr_samples', sample.file))
    const panel = locatePanelV2(image)
    const rows = locateEffectRowCenters(image, panel.box)
    const regions = createEffectRowRegions(panel.box, rows.centers, image)
    console.log(`  ${sample.file}`)
    const entries = []
    for (const truthRow of sample.rows) {
      if (truthRow.empty) continue
      const region = regions.find((item) => item.position === truthRow.position)
      const expectedTiers = AFFIX_TIER_VALUES[truthRow.functionType] || []
      const expectedValue = affixValueFromText(truthRow.valueText)
      const expectedTier = expectedTiers.findIndex((value) => Math.abs(value - expectedValue) < 1e-9) + 1
      const darkBackground = isDarkEffectRow(image, region.full)
      const valueStyle = classifyValueStyle(image, region.value, { darkBackground })
      const observed = valueMaskFromRegion(image, region.value, { blueText: isBlueTextStyle(valueStyle) })
      const match = await matchEquipmentValueTemplate(observed, truthRow.functionType, {
        valueStyle,
        debug: true,
        loadFullTemplate: loader.loadFullTemplate,
        loadGlyph: loader.loadGlyph,
      })
      summary.rows += 1
      if (expectedTier === 0) summary.truthTierMissing += 1
      const styleKey = valueStyle || '(空)'
      summary.styles[styleKey] = (summary.styles[styleKey] || 0) + 1
      const methodKey = match?.method || '未匹配'
      summary.methods[methodKey] = (summary.methods[methodKey] || 0) + 1
      const tierOk = expectedTier > 0 && match?.level === expectedTier
      if (tierOk) summary.tierOk += 1
      if (!match?.method) summary.miss += 1
      const styleOk = !valueStyle || expectedTier === 0 || isOcrValueStyleCompatible(expectedTier, valueStyle)
      if (!styleOk) summary.styleMismatch += 1
      entries.push({
        position: truthRow.position,
        truth: truthRow,
        expectedTier,
        valueStyle,
        match,
        tierOk,
        styleOk,
        // 原始区域墨迹量（未做掩码归一化 / 紧裁）：用于判断掩码是否被阈值削得过稀
        rawRegionInk: {
          blue: readRegionInk(image, region.value, { mode: 'blue', guard: false }).pixels,
          dark: readRegionInk(image, region.value, { mode: 'dark', guard: false }).pixels,
        },
      })
      const detail = match?.method
        ? `${match.value}% (第 ${match.level} 档) ${match.method} 距离 ${match.score.toFixed(3)} margin ${match.margin.toFixed(3)}`
        : '未匹配'
      console.log(`    r${truthRow.position} ${truthRow.name} 真值第 ${expectedTier} 档 ${truthRow.valueText}   → ${detail}  [${tierOk ? '✓' : '✗'}]  样式 ${styleKey}`)
    }
    report.samples.push({ file: sample.file, entries })
  }
  console.log('\n== 数值匹配汇总 ==')
  console.log(`  总行数 ${summary.rows}   档位正确 ${summary.tierOk}/${summary.rows}   未匹配 ${summary.miss}`)
  console.log(`  方法分布 ${JSON.stringify(summary.methods)}`)
  console.log(`  样式判读分布 ${JSON.stringify(summary.styles)}   与真值档位不相容 ${summary.styleMismatch}   真值档位解析失败 ${summary.truthTierMissing}`)
  console.log(`  模板加载：整值请求 ${loader.stats.fullRequests} 解码 ${loader.stats.fullDecoded}；字模请求 ${loader.stats.glyphRequests} 解码 ${loader.stats.glyphDecoded}；失败 ${loader.stats.failures}`)
  if (loader.failures.length > 0) console.log(`  失败清单：${JSON.stringify(loader.failures.slice(0, 5))}`)
  report.summary = summary
  if (reportFile) {
    writeFileSync(reportFile, JSON.stringify(report, null, 2))
    console.log(`  报告已写入：${reportFile}`)
  }
}

/**
 * 名称识别验证（§11 #5：现有 18 张模板在**新 label ROI 裁法**下是否仍够用）
 *
 * 只看名称这一环：逐行对 label 子区域取墨迹 → 与 9×2 模板比对 → 真值词条排在几名。
 * top1 命中率决定"一步到位"的比例；top3 命中率决定"靠值证据往下走"能否救回来。
 */
const printNameMatch = async (reportFile) => {
  const truth = JSON.parse(readFileSync(TRUTH_FILE, 'utf8'))
  const nameTemplates = await loadNameTemplates(path.join(OCR_DIR, 'affix-labels'))
  const summary = { rows: 0, top1: 0, top3: 0, empty: 0, noGlyph: 0, ranks: {} }
  const report = { generatedAt: new Date().toISOString(), samples: [] }
  console.log(`\n== 名称识别（label 子区域直接取墨迹，模板 ${nameTemplates.length} 个）==`)
  for (const sample of truth.samples) {
    const image = readPng(path.join(PROJECT_DIR, '文档', 'ocr_samples', sample.file))
    const panel = locatePanelV2(image)
    const rows = locateEffectRowCenters(image, panel.box)
    const regions = createEffectRowRegions(panel.box, rows.centers, image)
    console.log(`  ${sample.file}`)
    const entries = []
    for (const truthRow of sample.rows) {
      if (truthRow.empty) continue
      const region = regions.find((item) => item.position === truthRow.position)
      const darkRow = isDarkEffectRow(image, region.full)
      const glyph = nameGlyphFromRegion(image, region.label, { darkRow })
      const match = glyph ? matchNameGlyph(glyph, nameTemplates, { family: nameFamilyForRow(darkRow) }) : null
      summary.rows += 1
      const rank = match ? match.ranked.findIndex((item) => item.functionType === truthRow.functionType) : -1
      const top1 = rank === 0
      const top3 = rank >= 0 && rank < 3
      if (top1) summary.top1 += 1
      if (top3) summary.top3 += 1
      if (!glyph) summary.noGlyph += 1
      const rankKey = rank < 0 ? '未上榜' : String(rank + 1)
      summary.ranks[rankKey] = (summary.ranks[rankKey] || 0) + 1
      entries.push({ position: truthRow.position, truth: truthRow, darkRow, rank: rank + 1, match })
      const top = match ? match.ranked.slice(0, 3).map((item) => `${item.functionType} ${item.score.toFixed(3)}`).join(' > ') : '无字形'
      console.log(`    r${truthRow.position} 真值 ${truthRow.name}(${truthRow.functionType})${darkRow ? ' [深底]' : ''}   排名 ${rank < 0 ? '未上榜' : rank + 1}  ${top1 ? '✓' : top3 ? '△' : '✗'}   字形 ${glyph ? `${glyph.width}×${glyph.height}` : '无'}\n        前3：${top}`)
    }
    report.samples.push({ file: sample.file, entries })
  }
  console.log('\n== 名称识别汇总 ==')
  console.log(`  总行数 ${summary.rows}   top1 命中 ${summary.top1}/${summary.rows}   top3 命中 ${summary.top3}/${summary.rows}   取不到字形 ${summary.noGlyph}`)
  console.log(`  真值词条排名分布 ${JSON.stringify(summary.ranks)}`)
  report.summary = summary
  if (reportFile) {
    writeFileSync(reportFile, JSON.stringify(report, null, 2))
    console.log(`  报告已写入：${reportFile}`)
  }
}

/**
 * 新链路端到端验证（P5 收尾）
 *
 * 统计口径与旧版 `--samples` 完全一致（名称 / 数值 / 空行），可直接与基线对照；
 * 另统计 needsConfirm 数、warnings 分布与耗时 avg/P95（§11 #6）。
 */
const printV2Run = async (reportFile) => {
  const truth = JSON.parse(readFileSync(TRUTH_FILE, 'utf8'))
  const nameTemplates = await loadNameTemplates(path.join(OCR_DIR, 'affix-labels'))
  const valueTemplates = await loadValueTemplates(path.join(OCR_DIR, 'font-templates', 'Azonix-game'))
  const loader = createValueTemplateLoader({
    loadImage: (relative) => Promise.resolve(readPng(path.join(OCR_DIR, relative))),
  })
  const totals = { nameOk: 0, nameTotal: 0, valueOk: 0, valueTotal: 0, emptyOk: 0, emptyTotal: 0 }
  const summary = { needsConfirm: 0, unknown: 0, fallback: 0, warnings: {}, elapsed: [] }
  const report = { generatedAt: new Date().toISOString(), samples: [] }
  console.log('\n== 新链路（v2）端到端 ==')
  for (const sample of truth.samples) {
    const started = Date.now()
    const result = await recognizeEquipmentV2(
      readPng(path.join(PROJECT_DIR, '文档', 'ocr_samples', sample.file)),
      {
        nameTemplates,
        valueTemplates,
        loadFullTemplate: loader.loadFullTemplate,
        loadGlyph: loader.loadGlyph,
      },
    )
    const elapsedMs = Date.now() - started
    const statistics = printSample(sample, result)
    for (const key of Object.keys(totals)) totals[key] += statistics[key]
    summary.elapsed.push(elapsedMs)
    if (result.engine === 'legacy') summary.fallback += 1
    for (const warning of result.warnings) {
      summary.warnings[warning] = (summary.warnings[warning] || 0) + 1
    }
    summary.needsConfirm += result.rows.filter((row) => row.needsConfirm).length
    summary.unknown += result.rows.filter((row) => row.status === 'unknown').length
    report.samples.push({ file: sample.file, elapsedMs, truth: sample.rows, result })
  }
  const sorted = [...summary.elapsed].sort((left, right) => left - right)
  const average = sorted.reduce((sum, value) => sum + value, 0) / Math.max(1, sorted.length)
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]
  console.log('\n== v2 汇总 ==')
  console.log(`  名称：${totals.nameOk}/${totals.nameTotal}   数值：${totals.valueOk}/${totals.valueTotal}   空行：${totals.emptyOk}/${totals.emptyTotal}`)
  console.log(`  needsConfirm 行 ${summary.needsConfirm}   status=unknown 行 ${summary.unknown}   降级到旧算法 ${summary.fallback}`)
  console.log(`  耗时 avg ${average.toFixed(0)}ms  P95 ${p95}ms`)
  console.log(`  warnings ${JSON.stringify(summary.warnings)}`)
  report.summary = { ...summary, totals, average, p95, loaderStats: loader.stats }
  if (reportFile) {
    writeFileSync(reportFile, JSON.stringify(report, null, 2))
    console.log(`  报告已写入：${reportFile}`)
  }
}

/**
 * 新旧引擎逐行 diff（规格 §8.2 / §8.3）
 *
 * 只看"新版比旧版好多少"是错的判据 —— 错误会**转移**（漏行变成错值）。所以这里逐行比对
 * 两个引擎的输出，并把两个方向分开计数：
 *   - `v2 有值 / legacy 漏`：新版补回来的行
 *   - `legacy 有值 / v2 漏`：新版**新引入**的漏行（Q12 硬门槛关心的是这个方向）
 * 另外按真值统计两侧的 名称/数值 正确数，便于直接对照代价。
 */
const printEngineDiff = async (reportFile, options) => {
  const truth = JSON.parse(readFileSync(TRUTH_FILE, 'utf8'))
  const legacyContext = await buildEngineContext('legacy', options)
  const v2Context = await buildEngineContext('v2', options)
  const summary = {
    samples: 0,
    rows: 0,
    identical: 0,
    nameDiffers: 0,
    valueDiffers: 0,
    tierDiffers: 0,
    confidenceDiffers: 0,
    v2Recovered: 0,
    v2Missing: 0,
    legacyNameOk: 0,
    legacyValueOk: 0,
    v2NameOk: 0,
    v2ValueOk: 0,
    legacyMs: 0,
    v2Ms: 0,
  }
  const report = { generatedAt: new Date().toISOString(), samples: [] }
  console.log('\n== 新旧引擎 diff ==')
  for (const sample of truth.samples) {
    summary.samples += 1
    const image = readPng(path.join(PROJECT_DIR, '文档', 'ocr_samples', sample.file))
    const legacyStart = Date.now()
    const legacy = await recognizeEquipment(image, legacyContext)
    const legacyMs = Date.now() - legacyStart
    const v2Start = Date.now()
    const v2 = await recognizeEquipment(image, v2Context)
    const v2Ms = Date.now() - v2Start
    summary.legacyMs += legacyMs
    summary.v2Ms += v2Ms

    const lines = []
    for (const truthRow of sample.rows) {
      const left = legacy.rows.find((row) => row.position === truthRow.position)
      const right = v2.rows.find((row) => row.position === truthRow.position)
      summary.rows += 1
      const leftValue = left?.empty ? null : (left?.value ?? null)
      const rightValue = right?.empty ? null : (right?.value ?? null)
      const leftName = left?.empty ? null : (left?.functionType ?? null)
      const rightName = right?.empty ? null : (right?.functionType ?? null)
      const sameRow = leftName === rightName && leftValue === rightValue
      if (sameRow) summary.identical += 1
      if (leftName !== rightName) {
        summary.nameDiffers += 1
        if (!leftName && rightName) summary.v2Recovered += 1
        if (leftName && !rightName) summary.v2Missing += 1
      }
      if (leftValue !== rightValue) summary.valueDiffers += 1
      if ((left?.tier ?? null) !== (right?.tier ?? null)) summary.tierDiffers += 1
      if ((left?.confidence ?? null) !== (right?.confidence ?? null)) summary.confidenceDiffers += 1

      const expectedValue = truthRow.empty ? null : affixValueFromText(truthRow.valueText)
      if (!truthRow.empty) {
        if (leftName === truthRow.functionType) summary.legacyNameOk += 1
        if (rightName === truthRow.functionType) summary.v2NameOk += 1
        if (leftValue !== null && Math.abs(leftValue - expectedValue) < 1e-9) summary.legacyValueOk += 1
        if (rightValue !== null && Math.abs(rightValue - expectedValue) < 1e-9) summary.v2ValueOk += 1
      }
      if (!sameRow) {
        lines.push(`    r${truthRow.position} 真值 ${truthRow.empty ? '未获得效果' : `${truthRow.name} ${truthRow.valueText}`}`
          + `  | legacy ${left?.empty ? '空行' : `${leftName ?? '?'} ${leftValue ?? '?'}`}`
          + `  | v2 ${right?.empty ? '空行' : `${rightName ?? '?'} ${rightValue ?? '?'}${right?.needsConfirm ? ' ⚠' : ''}`}`)
      }
    }
    if (lines.length > 0) {
      console.log(`\n  ${sample.file}`)
      for (const line of lines) console.log(line)
    }
    report.samples.push({ file: sample.file, legacyMs, v2Ms, legacyRows: legacy.rows, v2Rows: v2.rows })
  }
  console.log('\n== diff 汇总 ==')
  console.log(`  样本 ${summary.samples}   行 ${summary.rows}   完全一致 ${summary.identical}`)
  console.log(`  名称不同 ${summary.nameDiffers}   数值不同 ${summary.valueDiffers}   档位不同 ${summary.tierDiffers}   confidence 不同 ${summary.confidenceDiffers}`)
  console.log(`  v2 补回行 ${summary.v2Recovered}   v2 新漏行 ${summary.v2Missing}`)
  console.log(`  名称正确  legacy ${summary.legacyNameOk} → v2 ${summary.v2NameOk}`)
  console.log(`  数值正确  legacy ${summary.legacyValueOk} → v2 ${summary.v2ValueOk}`)
  console.log(`  耗时  legacy ${(summary.legacyMs / summary.samples).toFixed(0)}ms/张   v2 ${(summary.v2Ms / summary.samples).toFixed(0)}ms/张`)
  report.summary = summary
  if (reportFile) {
    writeFileSync(reportFile, JSON.stringify(report, null, 2))
    console.log(`  报告已写入：${reportFile}`)
  }
}

const main = async () => {
  const options = parseArgs(process.argv.slice(2))
  if (options.panel) {
    printPanelComparison(options.report)
    return
  }
  if (options.rows) {
    printRowDetection(options.report)
    return
  }
  if (options.roi) {
    printRowRoi(options.report)
    return
  }
  if (options.value) {
    await printValueMatch(options.report)
    return
  }
  if (options.name) {
    await printNameMatch(options.report)
    return
  }
  if (options.v2) {
    await printV2Run(options.report)
    return
  }
  if (options.diff) {
    await printEngineDiff(options.report, options)
    return
  }
  const context = await buildEngineContext(options.engine, options)
  console.log(`引擎 ${options.engine}；值字模 ${context.valueTemplates.length} 个；名称模板 ${context.nameTemplates.length} 个；块分类阈值 ${options.minScore}`)

  if (options.samples) {
    const truth = JSON.parse(readFileSync(TRUTH_FILE, 'utf8'))
    const metrics = createMetrics()
    const report = { generatedAt: new Date().toISOString(), engine: options.engine, samples: [] }
    for (const sample of truth.samples) {
      const started = Date.now()
      const result = await recognizeEquipment(readPng(path.join(PROJECT_DIR, '文档', 'ocr_samples', sample.file)), context)
      const elapsedMs = Date.now() - started
      const statistics = printSample(sample, result)
      mergeMetrics(metrics, statistics.metrics, elapsedMs, result.timing)
      report.samples.push({ file: sample.file, elapsedMs, truth: sample.rows, result })
    }
    printMetrics(metrics)
    // JSON 里 elapsed / stageMs 存的是明细数组，summary 只留统计量（供两边 summary 直接对照）
    const { elapsed, stageMs, ...counters } = metrics
    report.summary = {
      ...counters,
      totalMs: timeStats(elapsed),
      stageAvgMs: Object.fromEntries(Object.entries(stageMs).map(([stage, values]) => [stage, timeStats(values).avg])),
    }
    if (options.report) {
      writeFileSync(options.report, JSON.stringify(report, null, 2))
      console.log(`  报告已写入：${options.report}`)
    }
  } else if (options.image) {
    const result = await recognizeEquipment(readPng(options.image), context)
    console.log(JSON.stringify({ image: options.image, ...result }, null, 2))
    if (options.report) writeFileSync(options.report, JSON.stringify(result, null, 2))
  } else {
    console.log('用法：node scripts/ocr-equipment.mjs --image <面板图> [--report <json>] | --samples [--engine legacy|v2] [--report <json>] | --diff [--report <json>] | --panel | --rows | --roi | --value | --name | --v2')
  }
}

main()