// 词条统计表的名单：会话里的选择 + 没选过时的默认排列
//
// 为什么名单要单独存一份：表格配置码（NKP2 类型 1）只带「谁 + 什么顺序」，
// 而那份名单原本只活在 StatsPage 的组件状态里，离开页面就没了。
// 存进 sessionStorage 后，/bot-share 里读到的就是同一份名单，
// 不用把拖拽排序那套 UI 再实现一遍。
//
// 顺序规则（与 BOT 端 core/store.py 的默认名单一致）：
// 燃烧 → 水冷 → 风压 → 电击 → 铁甲，同属性内阶数降序。
import { findCharacter } from './roster.js'
import { fullyRecordedCodes, getCurrentProfileId, loadRecord } from './profileStore.js'
import { buildCharacterStats, elementRankOf } from './statsModel.js'

const KEY = 'nikke-photos/stats/selection/v1'

export function loadStatsSelection() {
  try {
    const raw = JSON.parse(sessionStorage.getItem(KEY) || 'null')
    if (!Array.isArray(raw)) return []
    return raw.map((code) => String(code))
  } catch {
    return []
  }
}

export function saveStatsSelection(codes) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify((Array.isArray(codes) ? codes : []).map(String)))
  } catch {
    // 会话存储不可用（隐私模式等）不影响统计页本身
  }
}

/** 按属性排列：统计页的「按属性排列」按钮与默认名单共用这一条规则 */
export const sortCodesByElement = (codes) => [...codes].sort((left, right) => {
  const rankDiff = elementRankOf(findCharacter(left)?.element) - elementRankOf(findCharacter(right)?.element)
  if (rankDiff !== 0) return rankDiff
  return buildCharacterStats(loadRecord(right)).tierScore - buildCharacterStats(loadRecord(left)).tierScore
})

/** 没在统计页选过时的默认名单：当前存档里四件装备都已录入的角色，按属性排列 */
export const defaultTableCodes = () => sortCodesByElement(fullyRecordedCodes(getCurrentProfileId()))
