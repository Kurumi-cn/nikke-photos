// 角色卡数据模型：把「角色表 + 档案记录」转成卡片展示模型
// 词条汇总与格式化规则与 Workshop characterCard.js 对齐
import {
  cubeIconAsset,
  decorAsset,
  dollAssetForWeapon,
  metaAsset,
  overloadIconAsset,
  rarityAsset,
  starAsset,
  coreFrameAsset,
} from './cardAssets.js'
import { FUNCTION_LABELS } from '../data/affixTiers.js'
import { tData } from './i18n.js'

export { FUNCTION_LABELS }

export const SLOT_KEYS = ['head', 'body', 'arms', 'legs']
export const SLOT_LABELS = ['头部', '身躯', '臂部', '腿部']

export const toNumber = (value) => {
  if (value === null || value === undefined || typeof value === 'boolean' || String(value).trim() === '') {
    return null
  }
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

export const formatPercent = (value) => {
  const number = toNumber(value)
  return number === null ? '—' : `${number.toFixed(2)}%`
}

export const formatCoreBadge = (core) => {
  const value = Math.max(0, Math.trunc(toNumber(core) ?? 0))
  if (value >= 7) return 'MAX'
  return value > 0 ? String(value).padStart(2, '0') : ''
}

/** 珍藏品/收藏品星级：普通 = ceil(等级/5)，SSR 珍藏品 = 等级 + 1（0~3 星） */
export const favoriteItemStars = (rarity, level) => {
  const normalized = Math.max(0, Math.trunc(toNumber(level) ?? 0))
  return String(rarity ?? '').trim().toUpperCase() === 'SSR'
    ? Math.min(3, normalized + 1)
    : Math.min(3, Math.ceil(normalized / 5))
}

export function normalizeEquipments(equipments) {
  return Array.from({ length: 4 }, (_, slotIndex) => {
    const source = Array.isArray(equipments?.[slotIndex]) ? equipments[slotIndex] : []
    const byPosition = new Map()
    source.forEach((line, sourceIndex) => {
      if (!line?.functionType) return
      const position = Number(line.position || sourceIndex + 1)
      if (byPosition.has(position)) return
      byPosition.set(position, {
        functionType: String(line.functionType),
        label: tData(FUNCTION_LABELS[line.functionType] || String(line.functionType)),
        value: toNumber(line.value),
        level: toNumber(line.level),
      })
    })
    return Array.from({ length: 3 }, (_, index) => byPosition.get(index + 1) || null)
  })
}

/** 词条合计：按 functionType 汇总档位与百分比，按总档位降序取前 N 条 */
export function summarizeAffixes(equipments, limit = 3) {
  const totals = new Map()
  let order = 0
  normalizeEquipments(equipments).forEach((slot) => {
    slot.forEach((line) => {
      if (!line || !Number.isFinite(line.level) || line.level <= 0) return
      const current = totals.get(line.functionType)
      if (current) {
        current.totalLevel += line.level
        if (Number.isFinite(line.value)) current.valueHundredths += Math.round(line.value * 100)
        else current.completeValue = false
        return
      }
      totals.set(line.functionType, {
        functionType: line.functionType,
        label: line.label,
        totalLevel: line.level,
        valueHundredths: Number.isFinite(line.value) ? Math.round(line.value * 100) : 0,
        completeValue: Number.isFinite(line.value),
        order: order++,
      })
    })
  })
  return [...totals.values()]
    .sort((left, right) => right.totalLevel - left.totalLevel || left.order - right.order)
    .slice(0, Math.max(0, limit))
    .map((item) => ({ ...item, totalValue: item.completeValue ? item.valueHundredths / 100 : null }))
}

/** 四件装备一律按“过载 T10”展示（本工具只处理改造装备，类型不可选；旧档案中的类型字段忽略） */
function resolveEquipmentDisplays(character) {
  const className = character.class || ''
  return Array.from({ length: 4 }, (_, slotIndex) => ({
    state: 'known',
    icon: overloadIconAsset(className, SLOT_KEYS[slotIndex]),
    tier: 'T10',
    isOverload: true,
    className,
    manufacturer: '',
    label: tData(`${SLOT_LABELS[slotIndex]} · T10`),
  }))
}

/** 组装卡片展示模型；record 为角色档案（缺省时所有数值显示为 —）
 *  options.synchroLevel：存档级同步器等级（全局唯一，优先于记录里的遗留 level）
 *  options.research：存档级研究等级表（按角色的职业 / 企业取对应值） */
export function buildCardData(character, record, options = {}) {
  const data = record || {}
  const synchroLevel = options.synchroLevel
  const research = options.research
  const equipments = normalizeEquipments(data.equipments)
  const favoriteRarity = String(data.favoriteItem?.rarity ?? '').trim().toUpperCase()
  const favoriteLevel = toNumber(data.favoriteItem?.level)
  const isFavoriteSsr = favoriteRarity === 'SSR'
  const favoriteStars = favoriteRarity || favoriteLevel !== null
    ? favoriteItemStars(favoriteRarity, favoriteLevel)
    : null
  const favoriteAsset = favoriteRarity || favoriteLevel !== null
    ? (isFavoriteSsr && character.favoriteItem?.icon
      ? character.favoriteItem.icon
      : dollAssetForWeapon(character.weapon_type))
    : ''

  const skillIcons = character.skillIcons || {}
  const skillLevels = { skill1: data.skills?.skill1, skill2: data.skills?.skill2, burst: data.skills?.burst }
  const skills = Object.entries(skillLevels)
    .map(([key, level]) => ({ key, label: tData(key === 'burst' ? '爆裂技能' : `技能 ${key === 'skill1' ? 1 : 2}`), url: skillIcons[key] || '', level: toNumber(level) }))
    .filter((skill) => skill.url && Number.isFinite(skill.level) && skill.level >= 1 && skill.level <= 10)

  const cubeLevel = toNumber(data.cube?.level)
  const cube = (data.cube?.resourceId || Number.isFinite(cubeLevel))
    ? { name: tData(data.cube?.nameCn || '魔方'), asset: cubeIconAsset(data.cube?.resourceId), level: cubeLevel }
    : null

  return {
    name: tData(character.nameCn),
    rarity: character.original_rare || '',
    rarityAsset: rarityAsset(character.original_rare),
    level: toNumber(synchroLevel) ?? toNumber(data.level),
    levelCap: toNumber(data.levelCap),
    limitBreak: {
      grade: Math.min(3, Math.max(0, Math.trunc(toNumber(data.limitBreak?.grade) ?? 0))),
      core: data.limitBreak?.core,
      coreBadge: formatCoreBadge(data.limitBreak?.core),
    },
    affection: toNumber(data.affection),
    combat: toNumber(data.combat),
    classLevel: research?.class?.[character?.class] ?? data.classLevel ?? null,
    corporationLevel: research?.corporation?.[character?.corporation] ?? data.corporationLevel ?? null,
    favoriteItem: favoriteAsset || favoriteRarity
      ? { rarity: favoriteRarity, level: favoriteLevel, stars: favoriteStars, asset: favoriteAsset, isFavorite: isFavoriteSsr }
      : null,
    skills,
    cube,
    element: character.element,
    className: character.class,
    burstStage: character.use_burst_skill,
    corporation: character.corporation,
    weaponType: character.weapon_type,
    equipments,
    equipmentDisplays: resolveEquipmentDisplays(character),
    topAffixes: summarizeAffixes(equipments, 3),
    starAsset: starAsset,
    coreFrameAsset,
    decorAsset,
    metaAsset,
  }
}