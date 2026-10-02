import roster from '../data/roster.json' with { type: 'json' }

export const CHARACTERS = roster.characters
export const TAXONOMY = roster.taxonomy
export const ROSTER_META = {
  revision: roster.revision,
  generatedAt: roster.generatedAt,
  counts: roster.counts,
}

/** public 下的相对资源路径（兼容 GitHub Pages 子路径部署） */
export const assetUrl = (relativePath) => `${import.meta.env.BASE_URL}${relativePath}`

/** 分类值 → 中文显示名（用于卡片式展示） */
const labelIndex = new Map()
const iconIndex = new Map()
for (const group of TAXONOMY.filters) {
  for (const option of group.options) {
    labelIndex.set(`${group.key}:${option.value}`, option.label)
    iconIndex.set(`${group.key}:${option.value}`, option.icon)
  }
}

export const labelFor = (key, value) => labelIndex.get(`${key}:${value}`) || value || '—'

/** 分类值 → 图标路径（无图标返回空串，调用方自行跳过） */
export const iconFor = (key, value) => iconIndex.get(`${key}:${value}`) || ''

const norm = (value) => String(value ?? '').toLowerCase()

export function matchesSearch(character, query) {
  const q = norm(query).trim()
  if (!q) return true
  return (
    norm(character.nameCn).includes(q)
    || norm(character.nameEn).includes(q)
    || norm(character.nameCode).includes(q)
    || norm(character.resourceId).includes(q)
    || norm(character.pinyin).includes(q)
    || character.aliases.some((alias) => norm(alias).includes(q))
  )
}

/**
 * 角色搜索 + 分类筛选（组内多选取并集、跨组取交集），与 NIKKE Helper 规则一致。
 * toggles：国服已实装 / 珍藏品 / 超标准，默认全关（不额外缩小范围）。
 * 国服口径：单独开启时按“角色是否上过国服”筛（143 人）；
 * 若同时开启“珍藏品”，则按“国服已实装珍藏品”筛（12 人，collectibleCn ⊆ collectible）。
 */
export function applyFilters(list, { search = '', selected = {}, toggles = {} } = {}) {
  let result = list
  if (toggles.cnPublished) {
    result = result.filter((c) => (toggles.collectible ? c.collectibleCn : c.cnAvailable))
  }
  if (toggles.collectible) result = result.filter((c) => c.collectible)
  if (toggles.overSpec) result = result.filter((c) => c.overSpec)
  if (norm(search).trim()) result = result.filter((c) => matchesSearch(c, search))
  for (const group of TAXONOMY.filters) {
    const chosen = selected[group.key]
    if (chosen?.length) result = result.filter((c) => chosen.includes(c[group.key]))
  }
  return result
}

export const countActiveFilters = (selected = {}, toggles = {}) =>
  Object.values(selected).reduce((sum, list) => sum + (list?.length || 0), 0)
  + Object.values(toggles).filter(Boolean).length

export const findCharacter = (code) => CHARACTERS.find((c) => c.nameCode === String(code)) || null