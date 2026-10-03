// SPDX-License-Identifier: GPL-3.0-or-later
// 装备识别新链路编排：面板定位 → 行定位 → ROI → 名称 / 数值 → 裁决
//
// 对应规格 §1 的目标架构。三条原则贯穿：
//   1) 行的存在性由**几何**决定（胶囊横边），不由"能不能组装出值串"决定
//   2) 不确定不得静默 —— 一切弱证据落 needsConfirm / flags
//   3) 降级必须显式：走出去旧算法的路要留下 LEGACY_FALLBACK_USED，不能悄悄发生
//
// 模板与字模由调用方注入（`loadFullTemplate` / `loadGlyph`），浏览器走 fetch、CLI 走 pngjs；
// `nameTemplates` / `valueTemplates` 与旧实现共用同一套资源（旧实现仅在 fallback 时需要）。

import { recognizeEquipmentLegacy } from '../equipment.js'
import { adjudicateRow } from './adjudicate.js'
import { matchNameGlyph, nameFamilyForRow, nameGlyphFromRegion } from './nameTemplate.js'
import { locatePanelV2 } from './panelLogo.js'
import { locateEffectRowCenters } from './rowDetect.js'
import { createEffectRowRegions, judgeUnearnedRow, readRegionInk } from './rowRoi.js'
import { classifyValueStyle, isBlueTextStyle, isDarkEffectRow } from './valueStyle.js'
import { matchEquipmentValueTemplate, valueMaskFromRegion } from './valueTemplate.js'

/** 面板锚定失败 / 行定位失败时的显式降级：交给旧算法，并留下痕迹 */
const legacyFallback = (image, panelInfo, warnings, timing, startedAt, context) => {
  const result = recognizeEquipmentLegacy(image, context)
  warnings.push('LEGACY_FALLBACK_USED')
  timing.totalMs = Date.now() - startedAt
  return {
    panel: panelInfo
      ? {
        x0: panelInfo.box.x0,
        y0: panelInfo.box.y0,
        x1: panelInfo.box.x1,
        y1: panelInfo.box.y1,
        logo: panelInfo.logo
          ? { found: true, score: panelInfo.logo.score, confidence: panelInfo.logo.confidence, box: panelInfo.logo.box }
          : { found: false, score: 0, confidence: null, box: null },
        complete: false,
      }
      : null,
    rows: result.rows,
    warnings: [...warnings, ...result.warnings],
    engineError: null,
    timing,
    engine: 'legacy',
  }
}

/**
 * 引擎级失败（规格 §4.3）：模板加载失败 / 解析失败 / 解码异常 / 掩码生成异常
 *
 * 契约：**不允许静默吞掉后当作普通的 unknown**。整行三行都置 `unknown` 并带
 * `OCR_ENGINE_ERROR`，顶层 `engineError` 非空、`warnings` 里也有同名 code ——
 * 因为"三行都识别不出来"和"引擎坏了"对用户是完全不同的事。
 */
const engineErrorRow = (position) => ({
  position,
  status: 'unknown',
  empty: false,
  name: null,
  functionType: null,
  value: null,
  tier: null,
  confidence: 'low',
  snapped: false,
  snapReason: 'none',
  needsConfirm: true,
  flags: ['OCR_ENGINE_ERROR'],
  method: null,
  engine: 'v2',
})

/**
 * 新链路识别入口
 *
 * @param {{data,width,height}} image RGBA 像素
 * @param {{
 *   nameTemplates: object[],
 *   valueTemplates?: object[],
 *   tuning?: object,
 *   loadFullTemplate: (functionType: string, level: number) => Promise<object>,
 *   loadGlyph: (file: string, options?: object) => Promise<object>,
 * }} options
 */
export const recognizeEquipmentV2 = async (image, options = {}) => {
  // warnings / timing / startedAt 在外层持有，这样异常出口也能带上已经耗掉的时间
  const warnings = []
  const timing = { totalMs: 0, stages: { logoMs: 0, rowMs: 0, roiMs: 0, nameMs: 0, valueMs: 0 } }
  const startedAt = Date.now()
  try {
    return await runV2(image, options, { warnings, timing, startedAt })
  } catch (error) {
    timing.totalMs = Date.now() - startedAt
    warnings.push('OCR_ENGINE_ERROR')
    return {
      panel: null,
      rows: [1, 2, 3].map((position) => engineErrorRow(position)),
      warnings,
      engineError: { message: error?.message || String(error) },
      timing,
      engine: 'v2',
    }
  }
}

const runV2 = async (image, {
  nameTemplates = [],
  valueTemplates = [],
  tuning = undefined,
  loadFullTemplate,
  loadGlyph,
} = {}, { warnings, timing, startedAt }) => {
  const logoStart = Date.now()
  const panelInfo = locatePanelV2(image)
  timing.stages.logoMs = Date.now() - logoStart

  // OVERLOAD 是必要地标：缺失即显式降级（§5.1）
  if (!panelInfo.logo) {
    warnings.push('PANEL_LOGO_MISSING')
    return legacyFallback(image, panelInfo, warnings, timing, startedAt, { valueTemplates, nameTemplates, tuning })
  }
  if (!panelInfo.refined || panelInfo.source !== 'overload-geometry') warnings.push('PANEL_SUSPECT')

  const rowStart = Date.now()
  const rowInfo = locateEffectRowCenters(image, panelInfo.box)
  timing.stages.rowMs = Date.now() - rowStart
  if (rowInfo.centers.length !== 3) {
    warnings.push('ROW_DETECTION_FAILED')
    return legacyFallback(image, panelInfo, warnings, timing, startedAt, { valueTemplates, nameTemplates, tuning })
  }

  const roiStart = Date.now()
  const regions = createEffectRowRegions(panelInfo.box, rowInfo.centers, image)
  timing.stages.roiMs = Date.now() - roiStart

  const rows = []
  let guardFailedAny = false
  for (const region of regions) {
    const judge = judgeUnearnedRow(image, region, { panelWidth: region.panelWidth })
    if (judge.unearned) {
      rows.push(await adjudicateRow({ position: region.position, nameMatch: null, unearned: true }))
      continue
    }

    const darkRow = isDarkEffectRow(image, region.full)

    const nameStart = Date.now()
    const glyph = nameGlyphFromRegion(image, region.label, { darkRow })
    const nameMatch = glyph ? matchNameGlyph(glyph, nameTemplates, { family: nameFamilyForRow(darkRow) }) : null
    timing.stages.nameMs += Date.now() - nameStart

    const valueStyle = classifyValueStyle(image, region.value, { darkBackground: darkRow })
    const observed = valueMaskFromRegion(image, region.value, { blueText: isBlueTextStyle(valueStyle) })
    const guard = readRegionInk(image, region.value, { mode: 'blue' })
    if (guard.guardFailed) guardFailedAny = true

    const valueStart = Date.now()
    const row = await adjudicateRow({
      position: region.position,
      nameMatch,
      unearned: false,
      valueStyle,
      darkRow,
      regionGuardFailed: guard.guardFailed,
      matchValue: (functionType) => matchEquipmentValueTemplate(observed, functionType, {
        valueStyle,
        loadFullTemplate,
        loadGlyph,
      }),
    })
    timing.stages.valueMs += Date.now() - valueStart
    rows.push(row)
  }

  rows.sort((left, right) => left.position - right.position)
  if (rows.some((row) => row.status === 'unknown')) warnings.push('ROW_VALUE_UNRESOLVED')
  if (guardFailedAny) warnings.push('ROI_CLIPPED')

  timing.totalMs = Date.now() - startedAt
  return {
    panel: {
      x0: panelInfo.box.x0,
      y0: panelInfo.box.y0,
      x1: panelInfo.box.x1,
      y1: panelInfo.box.y1,
      logo: {
        found: true,
        score: panelInfo.logo.score,
        confidence: panelInfo.logo.confidence,
        box: panelInfo.logo.box,
      },
      complete: !guardFailedAny && !panelInfo.clippedEdges.left && !panelInfo.clippedEdges.top
        && !panelInfo.clippedEdges.right && !panelInfo.clippedEdges.bottom,
    },
    rows,
    warnings,
    engineError: null,
    timing,
    engine: 'v2',
  }
}

/**
 * 对外统一入口（分发器，规格 §2.4）
 *
 * 两个引擎都在，按 `opts.engine` 显式选择：默认走新链路 `v2`，传 `'legacy'` 走旧实现。
 * 之所以**不按参数能力自动嗅探**（例如"有 loadFullTemplate 就走 v2"），是因为隐式分发会让
 * "为什么这次走了旧算法"变成一个查不出来的问题；显式字段 + 返回里的 `engine` 字段才可追踪。
 *
 * 放在本文件而不是 `../equipment.js`，是为了让依赖单向：本文件 → 旧实现，不出现循环 import。
 *
 * 注意：`v2` 是 **async**，返回值可能是 Promise —— 调用方必须 await。
 */
export const recognizeEquipment = (image, opts = {}) => (
  opts?.engine === 'legacy' ? recognizeEquipmentLegacy(image, opts) : recognizeEquipmentV2(image, opts)
)
