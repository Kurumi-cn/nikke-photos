// 角色卡版式常量与模块开关（与 Workshop characterCardLayout.js 对齐）
export const CARD_WIDTH = 736
export const CARD_HEIGHT = 1096

export const MODULE_OPTIONS = [
  { key: 'favoriteItem', label: '收藏品' },
  { key: 'rarity', label: '稀有度/突破' },
  { key: 'levelName', label: '等级/名称' },
  { key: 'affection', label: '好感度' },
  { key: 'combat', label: '战斗力' },
  { key: 'metadata', label: '属性图标' },
  { key: 'skills', label: '技能等级' },
  { key: 'cube', label: '魔方' },
  { key: 'affixSummary', label: '词条合计' },
  { key: 'equipments', label: '四件装备' },
]

export const DEFAULT_MODULES = Object.fromEntries(MODULE_OPTIONS.map(({ key }) => [key, true]))

export const KIND = { standard: 'standard', overload: 'overload' }