// 存档「读取时迁移」
//
// 策略（定稿）：
//   1) 输入校验只约束**新录入**的数据；历史存档由本模块在**读取时**迁移
//   2) 发现字段值不符合当前规格 → 替换为该字段的 fallback（默认值，无默认值则 min）
//   3) 符合规格的历史值原样保留，不做无必要的改动
//   4) 按存档版本逐级递进执行，迁移完成后以当前版本写回
//   5) 「未填」（null / undefined / ''）是合法状态，**不迁移** —— 空值不代表值错了
//
// 本模块只做**纯函数**迁移，不碰 localStorage：
// 备份、写回、失败保护都由 profileStore 负责（见那边的 readCharacters / readIndex）。
//
// 与「写入时兜底」的分工：profileStore.writeCharacters 也会过一次 sanitize —— 那是持久化
// 边界的保险（任何写入路径都跑不掉）；本模块的版本链负责**升级 + 留档**，两者职责不同。
//
// 版本历史：
//   v2  数值字段纳入 fieldRanges.js 统一真源。此前允许的 0 值现在越界：
//       战斗力 0 → 1、R/SR 收藏品等级 0 → 1；同步器 / 研究等级也一并纳入范围约束

import { fallbackOf, isOutOfSpec } from './fieldRanges.js'

/** 当前存档数据版本。改动数值字段规格时 +1，并在下面的 STEPS 表补一条 n → n+1 */
export const CURRENT_DATA_VERSION = 2
/** 没有 version 字段的老数据按它处理 */
const INITIAL_VERSION = 1

/** 从存档 blob / index 里取版本号 */
export const versionOf = (raw) => (Number.isInteger(raw?.version) ? raw.version : INITIAL_VERSION)

export const needsMigration = (fromVersion) => fromVersion < CURRENT_DATA_VERSION

// ---- 顶层字段：取值、判越界、非破坏性地替换 ----

/**
 * 非破坏性替换：只重建「变了的那一条路径」，未变更时返回原引用
 * （角色记录会被写进 localStorage，也可能来自 React state —— 绝不能原地改）
 */
const fixNested = (root, path, rangeKey, label, changes) => {
  const [group, key] = path
  if (key === undefined) {
    if (!isOutOfSpec(rangeKey, root[group])) return root
    const to = fallbackOf(rangeKey)
    changes.push({ field: label, from: root[group], to })
    return { ...root, [group]: to }
  }
  const container = root[group]
  if (!container || typeof container !== 'object') return root
  if (!isOutOfSpec(rangeKey, container[key])) return root
  const to = fallbackOf(rangeKey)
  changes.push({ field: label, from: container[key], to })
  return { ...root, [group]: { ...container, [key]: to } }
}

/** 角色记录里的数值字段：[路径, 范围键, 展示名] */
const CHARACTER_FIELDS = [
  [['limitBreak', 'grade'], 'grade', '突破（星）'],
  [['limitBreak', 'core'], 'core', '核心'],
  [['affection'], 'affection', '好感度'],
  [['combat'], 'combat', '战斗力'],
  [['skills', 'skill1'], 'skill', '技能 1'],
  [['skills', 'skill2'], 'skill', '技能 2'],
  [['skills', 'burst'], 'skill', '爆裂技能'],
  [['cube', 'level'], 'cubeLevel', '魔方等级'],
]

/**
 * 收藏品等级：SSR 珍藏品在数据模型里存 0-2（界面显示 1-3），而范围表给的是**界面值**，
 * 所以比较前先 +1 换算、写回时再 -1，别直接拿内部值去比 1-3。
 */
const fixFavoriteLevel = (root, changes) => {
  const favorite = root?.favoriteItem
  if (!favorite || typeof favorite !== 'object') return root
  const isSsr = favorite.rarity === 'SSR'
  const rangeKey = isSsr ? 'favoriteLevelSsr' : 'favoriteLevel'
  const level = favorite.level
  const comparable = isSsr && Number.isInteger(level) ? level + 1 : level
  if (!isOutOfSpec(rangeKey, comparable)) return root
  const to = fallbackOf(rangeKey)
  const stored = isSsr ? to - 1 : to
  changes.push({ field: isSsr ? '收藏品等级（SSR）' : '收藏品等级', from: level, to: stored })
  return { ...root, favoriteItem: { ...favorite, level: stored } }
}

/** 装备词条档位：equipments[槽][第几条].level；空槽（无 functionType）不碰 */
const fixEquipments = (root, changes) => {
  const list = root?.equipments
  if (!Array.isArray(list)) return root
  let changed = false
  const fixed = list.map((slot, slotIndex) => {
    if (!Array.isArray(slot)) return slot
    let slotChanged = false
    const lines = slot.map((line, lineIndex) => {
      if (!line || typeof line !== 'object') return line
      if (!isOutOfSpec('affixTier', line.level)) return line
      const to = fallbackOf('affixTier')
      changes.push({ field: `装备 ${slotIndex + 1} 第 ${lineIndex + 1} 条档位`, from: line.level, to })
      slotChanged = true
      return { ...line, level: to }
    })
    if (!slotChanged) return slot
    changed = true
    return lines
  })
  return changed ? { ...root, equipments: fixed } : root
}

/** 单条角色记录 → 修好的记录（未变更时返回原引用） */
export const sanitizeCharacter = (record, changes = []) => {
  if (!record || typeof record !== 'object') return record
  let next = record
  for (const [path, rangeKey, label] of CHARACTER_FIELDS) next = fixNested(next, path, rangeKey, label, changes)
  next = fixFavoriteLevel(next, changes)
  next = fixEquipments(next, changes)
  return next
}

/** 角色表 → { characters, changes }（全部合规时 characters 保持原引用） */
export const sanitizeCharacters = (characters, changes = []) => {
  if (!characters || typeof characters !== 'object') return characters
  let changed = false
  const next = {}
  for (const [code, record] of Object.entries(characters)) {
    const fixed = sanitizeCharacter(record, changes)
    next[code] = fixed
    if (fixed !== record) changed = true
  }
  return changed ? next : characters
}

/** 存档元信息（索引里的 profile）：同步器等级 + 研究等级 */
export const sanitizeProfileMeta = (profile, changes = []) => {
  if (!profile || typeof profile !== 'object') return profile
  let next = profile
  if (isOutOfSpec('synchro', next.synchroLevel)) {
    const to = fallbackOf('synchro')
    changes.push({ field: '同步器等级', from: next.synchroLevel, to })
    next = { ...next, synchroLevel: to }
  }
  for (const line of ['class', 'corporation']) {
    const table = next.research?.[line]
    if (!table || typeof table !== 'object') continue
    let fixedTable = table
    for (const [key, value] of Object.entries(table)) {
      if (!isOutOfSpec('research', value)) continue
      const to = fallbackOf('research')
      changes.push({ field: `研究等级 ${line}.${key}`, from: value, to })
      if (fixedTable === table) fixedTable = { ...table }
      fixedTable[key] = to
    }
    if (fixedTable !== table) next = { ...next, research: { ...next.research, [line]: fixedTable } }
  }
  return next
}

// ---- 版本链 ----
// 键 n = 「把 v(n) 的数据升到 v(n+1)」。加新版本时：改 CURRENT_DATA_VERSION，并在此补一条。

const CHARACTER_STEPS = {
  1: (characters, changes) => sanitizeCharacters(characters, changes),
}

const PROFILE_STEPS = {
  1: (profile, changes) => sanitizeProfileMeta(profile, changes),
}

/** 从 fromVersion 升到当前版本要经过的版本对，如 `['1→2']`（供日志用） */
export const migrationPath = (fromVersion) => {
  const path = []
  for (let version = fromVersion; version < CURRENT_DATA_VERSION; version += 1) path.push(`${version}→${version + 1}`)
  return path
}

/** 逐级迁移角色表；返回 { characters, changes } */
export const migrateCharacters = (characters, fromVersion) => {
  let current = characters
  const changes = []
  for (let version = fromVersion; version < CURRENT_DATA_VERSION; version += 1) {
    const step = CHARACTER_STEPS[version]
    if (!step) throw new Error(`缺少角色数据 v${version} → v${version + 1} 的迁移`)
    current = step(current, changes)
  }
  return { characters: current, changes }
}

/** 逐级迁移存档元信息；返回 { profile, changes } */
export const migrateProfileMeta = (profile, fromVersion) => {
  let current = profile
  const changes = []
  for (let version = fromVersion; version < CURRENT_DATA_VERSION; version += 1) {
    const step = PROFILE_STEPS[version]
    if (!step) throw new Error(`缺少存档元信息 v${version} → v${version + 1} 的迁移`)
    current = step(current, changes)
  }
  return { profile: current, changes }
}
