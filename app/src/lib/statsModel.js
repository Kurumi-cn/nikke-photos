// 词条统计模型（纯函数）：档案（4 件装备 × 3 行词条）→ 按词条累加、变色判定与“阶数”计算
import { AFFIX_TIER_VALUES } from '../data/affixTiers.js'

/** 统计表列（顺序与参考表一致） */
export const STATS_COLUMNS = [
  { key: 'IncElementDmg', label: '优越' },
  { key: 'StatAtk', label: '攻击' },
  { key: 'StatAmmoLoad', label: '装弹' },
  { key: 'StatCriticalDamage', label: '暴伤' },
  { key: 'StatCritical', label: '暴率' },
  { key: 'StatChargeTime', label: '蓄速' },
  { key: 'StatChargeDamage', label: '蓄伤' },
  { key: 'StatAccuracyCircle', label: '命中' },
  { key: 'StatDef', label: '防御' },
]

/** 属性（元素）→ 显示名与名字颜色（色系取自 public/icons/属性 图标） */
const ELEMENTS = [
  { keys: ['Fire'], label: '燃烧', color: '#DE3B27' },
  { keys: ['Water'], label: '水冷', color: '#2F7DE1' },
  { keys: ['Wind'], label: '风压', color: '#35B34C' },
  { keys: ['Electronic', 'Elect'], label: '电击', color: '#C13BC1' },
  { keys: ['Iron'], label: '铁甲', color: '#CE8327' },
]
const ELEMENT_INDEX = new Map()
for (const entry of ELEMENTS) {
  for (const key of entry.keys) ELEMENT_INDEX.set(key, entry)
}

/** 默认排列顺序：燃烧 → 水冷 → 风压 → 电击 → 铁甲 */
export const ELEMENT_ORDER = ELEMENTS.map((entry) => entry.label)

export const elementLabelOf = (raw) => ELEMENT_INDEX.get(String(raw ?? '').trim())?.label || ''
export const elementColorOf = (raw) => ELEMENT_INDEX.get(String(raw ?? '').trim())?.color || ''
export const elementRankOf = (raw) => {
  const label = elementLabelOf(raw)
  const index = ELEMENT_ORDER.indexOf(label)
  return index === -1 ? ELEMENT_ORDER.length : index
}

/** 待选条件：四件装备都已录入（4 个槽位均存在且至少各有一行有效词条） */
export const isFullyRecorded = (record) => {
  const equipment = record?.equipments
  if (!Array.isArray(equipment) || equipment.length < 4) return false
  return equipment.slice(0, 4).every((slot) => Array.isArray(slot) && slot.some((line) => line && line.functionType))
}

/**
 * 档案 → 统计：
 *  - byFunction：词条 → { value 累加值, level 档位和 }
 *  - tierScore（阶数）：4 件装备所有词条的档位直接相加（整数，一阶一数字；上限 = 有效词条数 × 15）
 * 变色判定（4 件规格）：档位和 ≥ 40 → 蓝字；≥ 52 → 黑底蓝字（单件 12/15 档各退两档）
 */
export const buildCharacterStats = (record) => {
  const byFunction = {}
  const equipment = Array.isArray(record?.equipments) ? record.equipments : []
  for (const slot of equipment) {
    if (!Array.isArray(slot)) continue
    for (const line of slot) {
      if (!line || !line.functionType || !AFFIX_TIER_VALUES[line.functionType]) continue
      const acc = byFunction[line.functionType] || (byFunction[line.functionType] = { value: 0, level: 0 })
      acc.value += Number(line.value) || 0
      acc.level += Number(line.level) || 0
    }
  }
  const tierScore = Object.values(byFunction).reduce((sum, acc) => sum + acc.level, 0)
  return { byFunction, tierScore }
}

/** 单元格色调：'' | 'is-blue'（≥40 档）| 'is-max'（≥52 档，黑底蓝字） */
export const cellToneOf = (level) => (level >= 52 ? 'is-max' : level >= 40 ? 'is-blue' : '')