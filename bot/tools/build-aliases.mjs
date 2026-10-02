// 生成 BOT 端别名表 aliases.json（key = nameCode，供用户用 FinalShell 手改）。
//
// 为什么要生成而不是手写：201 个角色挨个手抄一遍 nameCode 没有意义，
// 但**别名内容**必须由人来定（机器猜的俗称不可信）。所以这里只做机械的部分：
//   1. 把 roster.json 的 201 个角色原样铺开，name 填好，aliases 默认空数组
//   2. 把旧插件抢救出来的俗称（aliases-legacy.json，key 是中文名）按中文名
//      匹配回 nameCode 填进去
//   3. 打印没匹配上的旧俗称，交给人判断
//
// 用法：
//   node bot/tools/build-aliases.mjs
//
// 输出：bot/seed/aliases.json
//
// ⚠️ 服务器上的 aliases.json 是**用户手改**的文件。种子只在首次部署时上传；
//    之后如果还要重新生成，先把服务器上的文件拉回来放进 bot/seed/，
//    脚本会以它为基础合并（保留已有别名），不会覆盖用户写的东西。

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../..')

const ROSTER = resolve(repoRoot, 'app/src/data/roster.json')
const LEGACY = resolve(here, 'aliases-legacy.json')
const EXISTING = resolve(here, '../seed/aliases.json')
const OUT = resolve(here, '../seed/aliases.json')

/** 与 BOT 端 core/roster.py 的 normalize() 保持一致：NFKC + 去空白 + 小写 */
const normalize = (text) =>
  String(text ?? '')
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .toLowerCase()

const roster = JSON.parse(readFileSync(ROSTER, 'utf8'))
const characters = roster.characters ?? []
if (!characters.length) throw new Error(`角色表为空：${ROSTER}`)

// ── 旧俗称：中文名 → 别名数组 ───────────────────────────────────────────
const legacy = existsSync(LEGACY) ? JSON.parse(readFileSync(LEGACY, 'utf8')) : {}

// 中文名 → nameCode 的查找：优先精确，其次归一化，再其次 roster 自带别名
const byExact = new Map()
const byNormalized = new Map()
for (const char of characters) {
  byExact.set(char.nameCn, char.nameCode)
  byNormalized.set(normalize(char.nameCn), char.nameCode)
  for (const alias of char.aliases ?? []) {
    if (!byNormalized.has(normalize(alias))) byNormalized.set(normalize(alias), char.nameCode)
  }
}

const unmatched = []
/** nameCode → 别名数组 */
const seeded = new Map()

for (const [legacyName, aliases] of Object.entries(legacy)) {
  let code = byExact.get(legacyName) ?? byNormalized.get(normalize(legacyName))

  if (!code) {
    // 模糊兜底：中文名互相包含，且候选唯一时才认
    const key = normalize(legacyName)
    const hits = characters.filter((c) => {
      const n = normalize(c.nameCn)
      return n.includes(key) || key.includes(n)
    })
    if (hits.length === 1) code = hits[0].nameCode
  }

  if (!code) {
    unmatched.push([legacyName, aliases])
    continue
  }
  const list = seeded.get(code) ?? []
  for (const alias of aliases) {
    if (!list.some((item) => normalize(item) === normalize(alias))) list.push(alias)
  }
  seeded.set(code, list)
}

// ── 合并已有的手改文件（如果存在）────────────────────────────────────
const existing = existsSync(EXISTING) ? JSON.parse(readFileSync(EXISTING, 'utf8')) : null
let mergedCount = 0
if (existing) {
  for (const [code, entry] of Object.entries(existing)) {
    if (code.startsWith('_')) continue
    const list = seeded.get(code) ?? []
    const kept = Array.isArray(entry) ? entry : entry?.aliases ?? []
    for (const alias of kept) {
      if (!list.some((item) => normalize(item) === normalize(alias))) {
        list.push(alias)
        mergedCount += 1
      }
    }
    if (list.length) seeded.set(code, list)
  }
}

// ── 输出：201 个角色全部铺开，按角色表顺序（非数字 nameCode 排最后）─────
const ordered = [...characters].sort((a, b) => {
  const numeric = (c) => (/^\d+$/.test(String(c.nameCode)) ? 0 : 1)
  return numeric(a) - numeric(b) || String(a.nameCode).localeCompare(String(b.nameCode), 'en', { numeric: true })
})

const out = {
  _help: [
    'BOT 端角色别名表。key = nameCode（以数字 id 为准，name 只用来核对有没有改错行）。',
    'aliases 里可以随便加俗称、错别字、外号；BOT 这边改完立即生效，不需要重载插件。',
    '网页端仍然按角色全名搜索，别名只影响 BOT 命令里的角色参数。',
    '以 _ 开头的 key（比如这条 _help）会被 BOT 忽略，可以用来记笔记。',
  ],
}
for (const char of ordered) {
  out[String(char.nameCode)] = {
    name: char.nameCn,
    aliases: seeded.get(String(char.nameCode)) ?? [],
  }
}

writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`, 'utf8')

// ── 报告 ─────────────────────────────────────────────────────────────
const withAlias = Object.entries(out).filter(([k, v]) => !k.startsWith('_') && v.aliases.length)
const aliasCount = withAlias.reduce((sum, [, v]) => sum + v.aliases.length, 0)
console.log(`角色 ${characters.length} 个，写入 ${OUT}`)
console.log(`有别名的角色 ${withAlias.length} 个，别名共 ${aliasCount} 条`)
if (existing) console.log(`与已有手改文件合并，额外保留 ${mergedCount} 条`)
if (unmatched.length) {
  console.log(`\n以下 ${unmatched.length} 条旧俗称没匹配上角色，需要人工判断：`)
  for (const [name, aliases] of unmatched) console.log(`  ${name}  ->  ${aliases.join('、')}`)
} else {
  console.log('旧俗称全部匹配成功')
}
