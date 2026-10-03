// 数值字段的取值范围真源
//
// 本文件是**唯一**的范围定义处。之前范围散在三份，且已经漂了：
//   1) CharacterForm 的 NumField（min/max 属性）
//   2) shareCode.js 的 pick(…, min, max, 哨兵) 字面量
//   3) BOT 的 core/store.py（注释写着"改这里要同步改表单"，已经过期）
// 表单与分享码从此都从这里取；BOT 是 Python，只能靠人工镜像（见文件末说明）。
//
// 本模块是**叶子**：不 import 项目内任何文件。profileStore 反过来从这里取常量，
// 所以绝不能反向依赖，否则会形成 import 环。
//
// `fallback` = 该字段的默认值。用于两处：
//   - 读取旧存档迁移时，把"不符合规格的值"替换成它（没有默认值的取 min）
//   - 越界提示文案里给出用户可以填的范围
// 「未填」用 null / undefined / '' 表达，与 fallback 是两回事 —— 空值不迁移。

/** 范围表：min / max 为闭区间；fallback 省略时即 min */
export const FIELD_RANGES = Object.freeze({
  // 存档级
  synchro: { min: 1, max: 2000, fallback: 200 },   // 与 profileStore.DEFAULT_SYNCHRO_LEVEL 同源
  research: { min: 0, max: 999, fallback: 1 },      // 与 profileStore 的 DEFAULT_RESEARCH_LEVEL 同源
  // 角色级
  grade: { min: 0, max: 3 },                        // 突破（星）
  core: { min: 0, max: 7 },                         // 核心
  affection: { min: 0, max: 40 },
  combat: { min: 1, max: 4000000 },
  skill: { min: 1, max: 10 },                       // skill1 / skill2 / burst 共用
  cubeLevel: { min: 1, max: 15 },
  favoriteLevel: { min: 1, max: 15 },               // R / SR 收藏品
  favoriteLevelSsr: { min: 1, max: 3 },             // SSR 珍藏品（内部存 0-2、界面 1-3，范围按界面值）
  affixTier: { min: 1, max: 15 },                   // 装备词条档位（表单是下拉，闭集，此处供分享码用）
})

const rangeOf = (key) => {
  const range = FIELD_RANGES[key]
  if (!range) throw new Error(`未知的数值字段：${key}`)
  return range
}

/** 该字段「不符合规格」时落到的值：有默认值用默认值，否则取 min */
export const fallbackOf = (key) => {
  const range = rangeOf(key)
  return range.fallback === undefined ? range.min : range.fallback
}

/** 空值：「未填」是合法状态，不属于越界（与 shareCode.toInt 的判定保持一致） */
export const isEmptyValue = (value) => value === null || value === undefined
  || (typeof value !== 'boolean' && String(value).trim() === '')

/** 是否为该字段的合法值：必须是区间内的整数 */
export const isInRange = (key, value) => {
  const range = rangeOf(key)
  return typeof value === 'number' && Number.isFinite(value)
    && Number.isInteger(value) && value >= range.min && value <= range.max
}

/** 非空但不在范围内（含非整数、非数字）—— 迁移与表单校验共用这一个判据 */
export const isOutOfSpec = (key, value) => !isEmptyValue(value) && !isInRange(key, value)

/** 范围文案里的数字：≥1 万且能整除时写成「400w」（目前只有战斗力用得到） */
const formatBound = (value) => (value >= 10000 && value % 10000 === 0 ? `${value / 10000}w` : String(value))

/** 给用户看的范围文案，如 `1-400w` / `0-40` */
export const rangeText = (key) => {
  const range = rangeOf(key)
  return `${formatBound(range.min)}-${formatBound(range.max)}`
}

/** 把不符合规格的值折成 fallback；合法值或空值原样返回 */
export const sanitizeValue = (key, value) => (isOutOfSpec(key, value) ? fallbackOf(key) : value)

// ── 关于 BOT（Python，另一个仓库）──────────────────────────────────
// bot/astrbot_plugin_nikke_roster/core/store.py 里有一份同名常量表。跨语言无法共享模块，
// 只维护 JS 单源，BOT 侧需人工对齐（那处注释已提示）。改本文件时请一并核对：
//   SYNCHRO / RESEARCH / GRADE / CORE / AFFECTION / COMBAT / SKILL
