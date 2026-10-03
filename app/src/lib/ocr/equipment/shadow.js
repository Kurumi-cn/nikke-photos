// SPDX-License-Identifier: GPL-3.0-or-later
// 影子模式（规格 §8.4）：新旧两个引擎跑同一张图，只比对、只记录，**不影响 UI**
//
// 为什么需要它：本重构要治的缺陷（第一行词条整行静默消失）是**偶发**的。20~30 张样本只能
// 证明"结构改善了"，证明不了"偶发已消除" —— 影子模式让真实使用中的每一次识别都留下一份
// 新旧对照，是唯一能把"偶发"量出来的办法。
//
// 开关默认关闭，且**不给普通用户暴露**：
//   控制台 `__nikkeOcrShadow.on()` 打开 / `.off()` 关闭 / `.dump()` 看记录 / `.clear()` 清空
//   也可以直接写 `localStorage['nikke-photos/ocr-shadow/v1'] = '1'`
//
// 关闭时（OFF）本模块**不做任何事**，耗时口径仍以 OFF 为准（§8.5 第 5 条）。

import { recognizeEquipment } from './engine.js'

const ENABLED_KEY = 'nikke-photos/ocr-shadow/v1'
const LOG_KEY = 'nikke-photos/ocr-shadow-log/v1'
/** 记录条数上限：够复盘最近的偶发即可，避免 localStorage 被慢慢撑爆 */
const LOG_LIMIT = 20

// ---- 开关 ----

export const isShadowEnabled = () => {
  try {
    return localStorage.getItem(ENABLED_KEY) === '1'
  } catch {
    return false // 隐私模式等场景下拿不到 localStorage，按关闭处理
  }
}

export const setShadowEnabled = (on) => {
  try {
    if (on) localStorage.setItem(ENABLED_KEY, '1')
    else localStorage.removeItem(ENABLED_KEY)
  } catch {
    // 忽略：写不进去时开关停留在原状态，不影响识别
  }
  return isShadowEnabled()
}

// ---- 记录 ----

export const readShadowLog = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(LOG_KEY) || '[]')
    return Array.isArray(raw) ? raw : []
  } catch {
    return []
  }
}

export const clearShadowLog = () => {
  try {
    localStorage.removeItem(LOG_KEY)
  } catch {
    // 忽略
  }
}

const appendShadowRecord = (record) => {
  try {
    const log = readShadowLog()
    log.push(record)
    while (log.length > LOG_LIMIT) log.shift()
    localStorage.setItem(LOG_KEY, JSON.stringify(log))
  } catch {
    // 写不进去不影响识别 —— 控制台里已经有一份
  }
}

// ---- 比对 ----

/** 行 → 可比的摘要（只留会进指标的字段，evidence/box 这类不进记录，避免记录体积失控） */
const rowBrief = (row) => ({
  position: row.position,
  status: row.status ?? null,
  name: row.functionType ?? null,
  value: row.value ?? null,
  tier: row.tier ?? null,
  confidence: row.confidence ?? null,
  needsConfirm: Boolean(row.needsConfirm),
})

/** 行内容是否一致：名称与数值都相同才算（status 参与，空行 vs 空行算一致） */
const rowsEqual = (a, b) => Boolean(a && b)
  && a.functionType === b.functionType
  && (a.value ?? null) === (b.value ?? null)

/**
 * 两个引擎的结果逐行对照
 *
 * `v2Missing` 是重点：**旧版认出来、v2 没认出来**的行 —— 这正是 §8.5 第 2 条「漏行数 = 0」
 * 要在真实使用中盯的信号（样本集只能测"v2 补回了旧版漏掉的行"，测不到反方向）。
 */
export const compareEngines = (v2Result, legacyResult) => {
  const v2Rows = new Map((v2Result?.rows || []).map((row) => [row.position, row]))
  const legacyRows = new Map((legacyResult?.rows || []).map((row) => [row.position, row]))
  const positions = [1, 2, 3]
  const rows = positions.map((position) => {
    const a = v2Rows.get(position) ?? null
    const b = legacyRows.get(position) ?? null
    return {
      position,
      same: rowsEqual(a, b),
      v2: a ? rowBrief(a) : null,
      legacy: b ? rowBrief(b) : null,
    }
  })
  // "对不上"的定义统一为 functionType 不同（空 vs 非空也算不同）
  const nameMismatch = rows.filter((row) => row.v2 && row.legacy && row.v2.name !== row.legacy.name).map((row) => row.position)
  const valueMismatch = rows.filter((row) => row.v2 && row.legacy && row.v2.value !== row.legacy.value).map((row) => row.position)
  return {
    rows,
    nameMismatch,
    valueMismatch,
    // 旧版认出来、v2 没认出来 → v2 的漏行
    v2Missing: rows.filter((row) => row.legacy?.name && !row.v2?.name).map((row) => row.position),
    // v2 认出来、旧版没认出来 → v2 补回的行
    legacyMissing: rows.filter((row) => row.v2?.name && !row.legacy?.name).map((row) => row.position),
    allSame: rows.every((row) => row.same),
  }
}

// ---- 输出 ----

const formatMs = (ms) => (typeof ms === 'number' ? `${Math.round(ms)}ms` : '—')

const logShadowRecord = (record) => {
  if (typeof console === 'undefined') return
  const { diff, v2, legacy } = record
  const same = diff.rows.filter((row) => row.same).length
  console.groupCollapsed(
    `[OCR 影子] ${same}/${diff.rows.length} 行一致 · v2 ${formatMs(v2.totalMs)} / legacy ${formatMs(legacy.totalMs)}`,
  )
  console.table(diff.rows.map((row) => ({
    行: row.position,
    一致: row.same ? '✓' : '✗',
    'v2 名称': row.v2?.name ?? '—',
    'v2 数值': row.v2?.value ?? '—',
    '旧版 名称': row.legacy?.name ?? '—',
    '旧版 数值': row.legacy?.value ?? '—',
  })))
  if (diff.v2Missing.length) console.warn(`× 旧版认得出、v2 没认出：第 ${diff.v2Missing.join(' / ')} 行`)
  if (diff.legacyMissing.length) console.info(`+ v2 认得出、旧版没认出：第 ${diff.legacyMissing.join(' / ')} 行`)
  console.info(`${LOG_KEY}（用 __nikkeOcrShadow.dump() 看最近 ${LOG_LIMIT} 条）`)
  console.groupEnd()
}

// ---- 入口 ----

/**
 * 跑一次影子对照（开关关闭时立刻返回 null，等于没有调用）
 *
 * @param {{data,width,height}} image 同一次识别的 RGBA 像素（与 v2 用的是同一张图）
 * @param {object} assets `loadOcrAssets()` 的返回值（旧引擎要 valueTemplates / nameTemplates）
 * @param {object} v2Result 已经跑完的 v2 结果
 * @returns {Promise<object|null>} 本次对照记录；未开启 / 跳过时返回 null
 */
export const runShadowComparison = async (image, assets, v2Result) => {
  if (!isShadowEnabled()) return null
  // v2 自己降级到旧算法时，两边本来就是同一条链路，比了没有意义，还会把降级次数伪装成"完全一致"
  if (v2Result?.engine !== 'v2' || v2Result?.engineError) {
    if (typeof console !== 'undefined') console.info('[OCR 影子] 本次 v2 走了降级 / 引擎出错，跳过对照')
    return null
  }

  // 旧实现自己不报耗时，只能由这里夹表量（口径与 CLI --diff 的改写一致）
  const startedAt = Date.now()
  let legacyResult = null
  let legacyError = null
  try {
    legacyResult = await recognizeEquipment(image, { ...assets, engine: 'legacy' })
  } catch (error) {
    legacyError = error?.message || String(error)
  }
  const legacyMs = Date.now() - startedAt

  const record = {
    at: new Date().toISOString(),
    image: { width: image?.width ?? null, height: image?.height ?? null },
    v2: {
      warnings: v2Result.warnings || [],
      totalMs: v2Result.timing?.totalMs ?? null,
      rows: (v2Result.rows || []).map(rowBrief),
    },
    legacy: legacyResult
      ? { totalMs: legacyMs, rows: (legacyResult.rows || []).map(rowBrief) }
      : null,
    legacyError,
    diff: legacyError ? null : compareEngines(v2Result, legacyResult),
  }
  appendShadowRecord(record)
  if (!legacyError) logShadowRecord(record)
  else if (typeof console !== 'undefined') console.warn(`[OCR 影子] 旧引擎本次出错：${legacyError}`)
  return record
}

// 开发者入口（控制台用）。普通用户看不到，也不需要知道它存在。
if (typeof window !== 'undefined') {
  window.__nikkeOcrShadow = {
    on: () => setShadowEnabled(true),
    off: () => setShadowEnabled(false),
    status: isShadowEnabled,
    dump: readShadowLog,
    clear: clearShadowLog,
  }
}
