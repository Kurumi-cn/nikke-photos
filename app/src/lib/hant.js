// 数据层名词的「简 → 繁」转换（角色名 / 皮肤名 / 词条名 / 分类标签 / 魔方名…）
// 界面文案的兜底也走这里（见 i18n.js：字典缺条目时 toHant 兜一层，不至于露出简体）。
//
// 两级：**词级术语表 → 字符映射表 → 原文**。
//   · 词级术语表（words.zh-Hant.json）处理"换词"的部分（保存→儲存、数据→資料…），UI 与名词共用；
//   · 字符映射表（s2t-map.json）来自 OpenCC 的单字对照，覆盖剩下绝大多数；
//   · 都命中不了就保持原样 —— 宁可留一个简体字，也不要编一个没人用过的写法。
//
// 本模块是**纯函数**（不碰 DOM / localStorage），Node 检查脚本也直接用它。
import overrides from '../data/i18n/words.zh-Hant.json' with { type: 'json' }
import s2t from '../data/i18n/s2t-map.json' with { type: 'json' }

const MAP = s2t.map
const WORDS = overrides.words || {}
const WORD_KEYS = Object.keys(WORDS).sort((left, right) => right.length - left.length)
const WORD_PATTERN = WORD_KEYS.length ? new RegExp(WORD_KEYS.join('|'), 'g') : null

/** 逐个字符做简繁替换；表里没有的字原样保留 */
function convertChars(text) {
  let out = ''
  for (const ch of text) out += MAP[ch] ?? ch
  return out
}

/** 简体 → 繁体（词级例外优先，其次逐字映射）
 *  词表命中的片段**原样用词表的值**（不再过字表）—— 所以词表既能改写、也能"保护"
 *  （例如 基里→基里，挡住字表把角色名里的「里」变成「裡」）。 */
export function toHant(text) {
  const source = String(text ?? '')
  if (!source) return source
  if (!WORD_PATTERN) return convertChars(source)
  let out = ''
  let last = 0
  for (const match of source.matchAll(WORD_PATTERN)) {
    out += convertChars(source.slice(last, match.index))
    out += WORDS[match[0]]
    last = match.index + match[0].length
  }
  return out + convertChars(source.slice(last))
}

/** 只做**字形**映射、不换词：搜索归一（简繁两种写法都能命中）与检查脚本用 */
export const toHantChars = (text) => convertChars(String(text ?? ''))

/** 供检查脚本用：暴露两级表，便于统计覆盖率与列未映射字符 */
export const HANT_TABLES = { map: MAP, words: WORDS, ambiguous: s2t.ambiguous, source: s2t.source }