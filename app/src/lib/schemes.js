// 数据录入「方案」：一组可复用的角色默认值，**手动**应用到当前角色
//
// 设计约束（改动请一并同步这里）：
//   1) 只含**角色级**字段。同步器等级 / 研究等级是存档级（全体共用），不进方案
//   2) 手工应用，不自动套用 —— 要有一个明确的触发动作，落库也发生在那一刻
//   3) 逐字段语义：留空（null / undefined / ''）= 该方案不指定这一项
//        - 未勾「强制替换」：只填空缺（目标该项为空才写）
//        - 勾了「强制替换」：覆盖方案里有值的字段；**留空的一律不碰**
//   4) 装备词条（equipments）**绝不动** —— 方案里根本没有它
//   5) 魔方（类型+等级）与收藏品（品质+等级）各自**成组**处理。理由是避免凑出
//      "方案的类型 + 原来的等级" 这种半新半旧的组合 —— 那种搭配游戏里不存在
//
// 与 fieldRanges 的关系：方案里的每个值同样受范围约束（弹窗里越界会红框并禁止保存）。
// 但读取时净化越界值的方向与角色记录**不同**：角色记录折回 fallback（必需字段要有值），
// 方案字段是可选的，所以越界一律归为「不指定」（null）—— 写一个用户没打算要的值更糟。

import { findCube } from './cubes.js'
import { isEmptyValue, isOutOfSpec } from './fieldRanges.js'
import { t, tData } from './i18n.js'

/** 方案名长度上限（与存档名一致） */
export const SCHEME_NAME_MAX = 30

/** 新建方案时预填的魔方：遗迹巨熊 15 级（用户指定 —— 很多角色都用这个） */
const DEFAULT_CUBE_ID = 10003
const DEFAULT_CUBE_LEVEL = 15

/** 珍藏品单选的选项；控件值用字符串，存储值见 ssrLevelFromControl */
export const FAVORITE_SSR_OPTIONS = [
  { value: 'follow', label: '跟随上一条收藏品设置' },
  { value: '1', label: '1⭐收藏品' },
  { value: '2', label: '2⭐收藏品' },
  { value: '3', label: '3⭐收藏品' },
]

/** 存储值（null = 跟随 | 1|2|3 = 星数）→ 控件值 */
export const ssrLevelToControl = (value) => ([1, 2, 3].includes(Number(value)) ? String(Number(value)) : 'follow')

/** 控件值 → 存储值 */
export const ssrLevelFromControl = (control) => (['1', '2', '3'].includes(String(control)) ? Number(control) : null)

/** 方案里「逐字段」的部分：路径 + 范围键 + 展示名（弹窗与 applyScheme 共用同一张表） */
export const SCHEME_FIELD_ROWS = [
  { path: ['limitBreak', 'grade'], rangeKey: 'grade', label: '突破（星）' },
  { path: ['limitBreak', 'core'], rangeKey: 'core', label: '核心' },
  { path: ['affection'], rangeKey: 'affection', label: '好感度' },
  { path: ['combat'], rangeKey: 'combat', label: '战斗力' },
  { path: ['skills', 'skill1'], rangeKey: 'skill', label: '技能 1' },
  { path: ['skills', 'skill2'], rangeKey: 'skill', label: '技能 2' },
  { path: ['skills', 'burst'], rangeKey: 'skill', label: '爆裂技能' },
]

// ---- 读写小工具（非破坏性，只重建变动的那条路径）----

const getPath = (root, path) => path.reduce((node, key) => (node == null ? undefined : node[key]), root)

const setPath = (root, path, value) => {
  const [head, ...rest] = path
  if (rest.length === 0) return { ...root, [head]: value }
  const child = root?.[head]
  return { ...root, [head]: setPath(child && typeof child === 'object' ? child : {}, rest, value) }
}

const newId = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`

// ---- 命名 ----

/** 下一个自动编号名：扫描现有「方案N」取最大 N + 1（不补空号） */
export const nextSchemeName = (schemes) => {
  let max = 0
  for (const scheme of schemes || []) {
    const matched = /^方案(\d+)$/.exec(String(scheme?.name ?? '').trim())
    if (matched) max = Math.max(max, Number(matched[1]))
  }
  return `方案${max + 1}`
}

/** 重名校验：trim 后精确比对（区分大小写）；exceptId 用于编辑时排除自己 */
export const isSchemeNameTaken = (schemes, name, exceptId = null) => {
  const target = String(name ?? '').trim()
  if (!target) return false
  return (schemes || []).some((scheme) => scheme?.id !== exceptId && String(scheme?.name ?? '').trim() === target)
}

// ---- 归一化（读取 / 导入时用）----

/** 越界或类型不对 → 归为 null（不指定）；合法值原样保留 */
const cleanValue = (rangeKey, value) => {
  if (isEmptyValue(value)) return null
  return isOutOfSpec(rangeKey, value) ? null : value
}

/** 把任意来源的对象整成合法方案；缺项补空、越界归空，不抛错 */
export const normalizeScheme = (raw) => {
  const cube = raw?.cube || {}
  const favorite = raw?.favoriteItem || {}
  const cubeId = isEmptyValue(cube.resourceId) ? null : Number(cube.resourceId)
  const scheme = {
    id: typeof raw?.id === 'string' && raw.id ? raw.id : newId(),
    name: String(raw?.name ?? '').trim(),
    forceReplace: Boolean(raw?.forceReplace),
    affection: null,
    combat: null,
    favoriteSsrLevel: null,
    limitBreak: {},
    skills: {},
    cube: {},
    favoriteItem: {},
  }
  for (const { path, rangeKey } of SCHEME_FIELD_ROWS) {
    const [group, key] = path
    const value = cleanValue(rangeKey, key === undefined ? raw?.[group] : raw?.[group]?.[key])
    if (key === undefined) scheme[group] = value
    else scheme[group][key] = value
  }
  scheme.cube = {
    resourceId: findCube(cubeId) ? cubeId : null,
    level: cleanValue('cubeLevel', cube.level),
  }
  const rarity = String(favorite.rarity ?? '').trim().toUpperCase()
  scheme.favoriteItem = {
    // 方案不允许 SSR —— 珍藏品走下面那个单选
    rarity: rarity === 'R' || rarity === 'SR' ? rarity : null,
    level: cleanValue('favoriteLevel', favorite.level),
  }
  scheme.favoriteSsrLevel = ssrLevelFromControl(ssrLevelToControl(raw?.favoriteSsrLevel))
  return scheme
}

/** 方案列表归一化：去重 id、补缺项；返回新数组 */
export const normalizeSchemes = (list) => {
  if (!Array.isArray(list)) return []
  const seen = new Set()
  const out = []
  for (const raw of list) {
    const scheme = normalizeScheme(raw)
    if (seen.has(scheme.id)) scheme.id = newId()
    seen.add(scheme.id)
    out.push(scheme)
  }
  return out
}

/** 新建方案的初始值：除魔方外全部留空；强制替换默认不勾 */
export const createScheme = (name) => {
  const scheme = normalizeScheme({ name })
  scheme.cube = { resourceId: DEFAULT_CUBE_ID, level: DEFAULT_CUBE_LEVEL }
  return scheme
}

/**
 * 导入档案时合并方案：保留本机现有的，把导入的追加到后面。
 * 重名（trim 后精确相同）按 `名字 (2)`、`名字 (3)`… 依次避让，id 冲突时换新 id。
 *
 * @returns {{list: object[], renames: {from: string, to: string}[]}} renames 用于回执里告诉用户改过哪些名字
 */
export const mergeSchemes = (existing, incoming) => {
  const list = normalizeSchemes(existing)
  const renames = []
  const taken = (name) => list.some((scheme) => String(scheme?.name ?? '').trim() === name)
  for (const scheme of normalizeSchemes(incoming)) {
    if (list.some((item) => item.id === scheme.id)) scheme.id = newId()
    const original = scheme.name || '方案'
    if (taken(original)) {
      const stem = original.slice(0, SCHEME_NAME_MAX - 6)
      let index = 2
      let candidate = `${stem} (${index})`
      while (taken(candidate)) {
        index += 1
        candidate = `${stem} (${index})`
      }
      renames.push({ from: original, to: candidate })
      scheme.name = candidate
    }
    list.push(scheme)
  }
  return { list, renames }
}

// ---- 应用 ----

const describeCube = (cube) => [
  cube?.resourceId ? (tData(findCube(cube.resourceId)?.nameCn) || t('魔方 {id}', { id: cube.resourceId })) : '',
  isEmptyValue(cube?.level) ? '' : t('{level} 级', { level: cube.level }),
].filter(Boolean).join(' · ')

const describeFavorite = (favorite) => {
  if (favorite?.rarity === 'SSR') return t('SSR 珍藏品 · {stars}⭐', { stars: (Number(favorite.level) || 0) + 1 })
  return [
    favorite?.rarity || '',
    isEmptyValue(favorite?.level) ? '' : t('{level} 级', { level: favorite.level }),
  ].filter(Boolean).join(' · ')
}

/**
 * 把方案应用到一条角色记录
 *
 * @param {object} record 目标角色记录（不会被修改）
 * @param {object} scheme 方案
 * @param {{force?: boolean, isFavoriteCharacter?: boolean}} options
 *        force 默认取 `scheme.forceReplace`；isFavoriteCharacter 来自角色表
 *        （珍藏品是**角色**属性，不在记录里，所以必须外部传进来）
 * @returns {{record: object, filled: object[], overwritten: object[], notes: string[]}}
 *        filled = 从空补上的；overwritten = 被覆盖的（二次确认要列出这些）；
 *        notes = 跳过某项的原因
 */
export const applyScheme = (record, scheme, { force, isFavoriteCharacter = false } = {}) => {
  const source = record && typeof record === 'object' ? record : {}
  const detail = normalizeScheme(scheme)
  const useForce = force === undefined ? detail.forceReplace : Boolean(force)
  let next = source
  const filled = []
  const overwritten = []
  const notes = []

  /** 单个字段：留空不动；有值则按 force 决定填空缺还是覆盖 */
  const put = (path, rangeKey, label, value) => {
    if (isEmptyValue(value)) return
    if (isOutOfSpec(rangeKey, value)) {
      notes.push(t('{label} 的方案值 {value} 越界，已跳过', { label: t(label), value }))
      return
    }
    const current = getPath(next, path)
    const hasValue = !isEmptyValue(current)
    if (hasValue && !useForce) return
    ;(hasValue ? overwritten : filled).push({ label, from: hasValue ? current : null, to: value })
    next = setPath(next, path, value)
  }

  for (const { path, rangeKey, label } of SCHEME_FIELD_ROWS) {
    const [group, key] = path
    put(path, rangeKey, label, key === undefined ? detail[group] : detail[group]?.[key])
  }

  /**
   * 成组写入（魔方 / 收藏品）
   * describe(current) 返回空串表示目标里这一项还是空的 → 属于「填」；非空 → 属于「覆盖」
   */
  const putGroup = (groupKey, patch, label, describe) => {
    if (Object.keys(patch).length === 0) return
    const current = source[groupKey] && typeof source[groupKey] === 'object' ? source[groupKey] : {}
    const from = describe(current)
    const hasValue = from !== ''
    if (hasValue && !useForce) return
    const merged = { ...current, ...patch }
    ;(hasValue ? overwritten : filled).push({ label, from: from || null, to: describe(merged) })
    next = setPath(next, [groupKey], merged)
  }

  // 魔方：类型 + 等级成组
  const cube = detail.cube || {}
  const cubePatch = {}
  const cubeFound = findCube(cube.resourceId)
  if (cubeFound) {
    cubePatch.resourceId = cubeFound.resourceId
    cubePatch.nameCn = cubeFound.nameCn
    cubePatch.nameEn = cubeFound.nameEn
  }
  if (!isEmptyValue(cube.level)) cubePatch.level = cube.level
  putGroup('cube', cubePatch, t('魔方'), describeCube)

  // 收藏品：珍藏品角色 + 单选指定了星数 → 走 SSR 支（内部存 0-2，与表单一致）
  const ssrLevel = detail.favoriteSsrLevel
  const favoritePatch = {}
  if (isFavoriteCharacter && ssrLevel !== null) {
    favoritePatch.rarity = 'SSR'
    favoritePatch.level = ssrLevel - 1
  } else {
    if (!isFavoriteCharacter && ssrLevel !== null) notes.push(t('收藏品：该角色不是珍藏品角色，已忽略珍藏品设置'))
    if (detail.favoriteItem?.rarity) favoritePatch.rarity = detail.favoriteItem.rarity
    if (!isEmptyValue(detail.favoriteItem?.level)) favoritePatch.level = detail.favoriteItem.level
  }
  putGroup('favoriteItem', favoritePatch, '收藏品', describeFavorite)

  return { record: next, filled, overwritten, notes }
}

/** 方案里有没有任何「会被写入」的值（全留空时，应用它等于什么都没做） */
export const schemeHasAnyValue = (scheme) => {
  const detail = normalizeScheme(scheme)
  const hasField = SCHEME_FIELD_ROWS.some(({ path }) => {
    const [group, key] = path
    return !isEmptyValue(key === undefined ? detail[group] : detail[group]?.[key])
  })
  if (hasField) return true
  if (!isEmptyValue(detail.cube.resourceId) || !isEmptyValue(detail.cube.level)) return true
  if (detail.favoriteItem.rarity || !isEmptyValue(detail.favoriteItem.level)) return true
  return detail.favoriteSsrLevel !== null
}

/** 列表里的一句话摘要：只列方案**指定了**的项；全空返回空串 */
export const schemeSummary = (scheme) => {
  const detail = normalizeScheme(scheme)
  const parts = []
  for (const { path, label } of SCHEME_FIELD_ROWS) {
    const [group, key] = path
    const value = key === undefined ? detail[group] : detail[group]?.[key]
    if (!isEmptyValue(value)) parts.push(`${t(label)} ${value}`)
  }
  const cube = describeCube(detail.cube)
  if (cube) parts.push(`${t('魔方')} ${cube}`)
  const favorite = describeFavorite(detail.favoriteItem)
  if (favorite) parts.push(`${t('收藏品')} ${favorite}`)
  if (detail.favoriteSsrLevel !== null) parts.push(`${t('珍藏品角色')} ${detail.favoriteSsrLevel}⭐`)
  return parts.join(' · ')
}

/** 「应用」二次确认里用的字段变更描述：`突破（星）2 → 1` */
export const changeText = ({ label, from, to }) => (
  from === null || from === undefined ? `${t(label)} → ${to}` : `${t(label)} ${from} → ${to}`
)
