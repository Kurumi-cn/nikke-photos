// 角色卡版式常量与模块开关（与 Workshop characterCardLayout.js 对齐）
import { tData } from './i18n.js'

export const CARD_WIDTH = 736
export const CARD_HEIGHT = 1096

// label 用 getter：繁体模式下取到字形映射后的名词（模块名是游戏术语），
// 读取时才求值 —— 写死的对象字面量会在模块加载时把语言钉死。
const moduleOption = (key, label) => ({ key, get label() { return tData(label) } })

export const MODULE_OPTIONS = [
  moduleOption('favoriteItem', '收藏品'),
  moduleOption('rarity', '稀有度/突破'),
  moduleOption('levelName', '等级/名称'),
  moduleOption('affection', '好感度'),
  moduleOption('combat', '战斗力'),
  moduleOption('metadata', '属性图标'),
  moduleOption('skills', '技能等级'),
  moduleOption('cube', '魔方'),
  moduleOption('affixSummary', '词条合计'),
  moduleOption('equipments', '四件装备'),
]

export const DEFAULT_MODULES = Object.fromEntries(MODULE_OPTIONS.map(({ key }) => [key, true]))

export const KIND = { standard: 'standard', overload: 'overload' }