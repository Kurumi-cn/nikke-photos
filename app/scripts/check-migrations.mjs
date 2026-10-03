// 存档「读取时迁移」的回归检查
//
//   node scripts/check-migrations.mjs
//
// 用 stub 的 localStorage 跑真实的 profileStore，覆盖：
//   1) 范围真源自洽（每个字段都有合法范围与 fallback，文案可读）
//   2) 越界字段折回 fallback          3) 合规值原样保留（一个字都不许动）
//   4) 空值（未填）不迁移              5) 迁移后版本升到当前 + 原始副本留档
//   6) 幂等：第二次读取不再迁移、不再写回
//   7) 失败保护：迁移抛错时原样返回且**不写回**（存档不能因迁移而更糟）
//   8) 写入边界兜底：绕过迁移直接写非法值，也会被折回
//   9) 方案（存档级）：老索引补空、归一化、applyScheme 四种组合、导入合并改名
import { readFileSync } from 'node:fs'

// ---- 浏览器 API 桩 ----
const store = new Map()
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
}
// 迁移日志走 console.info/table，这里静音掉免得刷屏（失败仍要看得见）
const quiet = { info: console.info, warn: console.warn }
console.info = () => {}
console.table = () => {}

const { FIELD_RANGES, fallbackOf, isInRange, isOutOfSpec, rangeText } = await import('../src/lib/fieldRanges.js')
const { CURRENT_DATA_VERSION } = await import('../src/lib/profileMigrations.js')
const store1 = await import('../src/lib/profileStore.js')
const {
  applyScheme, createScheme, isSchemeNameTaken, mergeSchemes, nextSchemeName, schemeSummary,
} = await import('../src/lib/schemes.js')

const INDEX_KEY = 'nikke-photos/profiles/v1/index'
const DATA_KEY = 'nikke-photos/profiles/v1/data/default'
const BACKUP_KEY = 'nikke-photos/profiles/v1/backup/default'
const LEGACY_KEY = 'nikke-photos/profile/v1'

let failures = 0
const check = (label, ok, detail = '') => {
  if (ok) console.log(`  [OK]   ${label}`)
  else { failures += 1; console.error(`  [FAIL] ${label}${detail ? `：${detail}` : ''}`) }
}
const equal = (label, actual, expected) => check(
  label,
  JSON.stringify(actual) === JSON.stringify(expected),
  `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`,
)

/** 用给定 blob 重置存储（每次都从干净状态出发，用例之间不互相污染） */
const seed = ({ index, characters, dataVersion = 1, otherData = null }) => {
  store.clear()
  if (index) store.set(INDEX_KEY, JSON.stringify(index))
  if (characters) store.set(DATA_KEY, JSON.stringify({ version: dataVersion, updatedAt: 'x', characters }))
  if (otherData) for (const [key, value] of Object.entries(otherData)) store.set(key, JSON.stringify(value))
}

const okIndex = (extra = {}) => ({
  version: 1,
  currentId: 'default',
  profiles: [{
    id: 'default', name: '默认存档', synchroLevel: 200,
    research: { class: { Attacker: 1 }, corporation: {} },
    createdAt: 'x', updatedAt: 'x', deletable: false, ...extra,
  }],
})

console.log('\n== 1) 范围真源自洽 ==')
for (const [key, range] of Object.entries(FIELD_RANGES)) {
  const fallback = fallbackOf(key)
  check(`${key}：范围 ${rangeText(key)}，越界落到 ${fallback}`, isInRange(key, fallback), `fallback ${fallback} 不在范围内`)
  check(`${key}：范围文案非空且含两个边界`, /^\S+-\S+$/.test(rangeText(key)), rangeText(key))
}
check('空值不算越界', ![null, undefined, ''].some((raw) => isOutOfSpec('combat', raw)))
check('战斗力 0 算越界（v2 起最小 1）', isOutOfSpec('combat', 0))
check('战斗力上界文案为 400w', rangeText('combat') === '1-400w', rangeText('combat'))

console.log('\n== 2~4) 越界折回 / 合规保留 / 空值不动 ==')
const legacy = {
  5145: {
    limitBreak: { grade: 5, core: 9 },
    affection: 99,
    combat: 0,
    skills: { skill1: 10, skill2: 0, burst: 7 },
    cube: { resourceId: 10003, level: 99 },
    favoriteItem: { rarity: 'R', level: 0 },
    equipments: [[{ functionType: 'StatAtk', level: 16, value: 11.81 }], [], [], []],
  },
  6001: {
    limitBreak: { grade: 2, core: 3 },
    affection: 10,
    combat: 204140,
    skills: { skill1: 5, skill2: 5, burst: 5 },
    cube: { resourceId: 10003, level: 10 },
    favoriteItem: { rarity: 'SSR', level: 0 },
    equipments: [[{ functionType: 'StatAtk', level: 15, value: 11.81 }], [], [], []],
  },
  7001: { affection: null, combat: undefined, favoriteItem: { rarity: 'R', level: null } },
}
seed({ index: okIndex({ synchroLevel: 99999, research: { class: { Attacker: 5000 }, corporation: {} } }), characters: legacy })

const fixed = store1.loadRecord(5145)
equal('越界字段全部折回 fallback', fixed, {
  limitBreak: { grade: 0, core: 0 },
  affection: 0,
  combat: 1,
  skills: { skill1: 10, skill2: 1, burst: 7 },
  cube: { resourceId: 10003, level: 1 },
  favoriteItem: { rarity: 'R', level: 1 },
  equipments: [[{ functionType: 'StatAtk', level: 1, value: 11.81 }], [], [], []],
})
equal('合规记录一个字都不动（含 SSR 内部 level 0）', store1.loadRecord(6001), legacy[6001])
equal('空值不迁移', store1.loadRecord(7001), { affection: null, favoriteItem: { rarity: 'R', level: null } })
check('同步器 99999 → 200', store1.getSynchroLevel() === 200, String(store1.getSynchroLevel()))
check('研究 5000 → 1', store1.getResearch().class.Attacker === 1, String(store1.getResearch().class.Attacker))

console.log('\n== 5) 版本与留档 ==')
check(`数据版本升到 ${CURRENT_DATA_VERSION}`, JSON.parse(store.get(DATA_KEY)).version === CURRENT_DATA_VERSION)
check(`索引版本升到 ${CURRENT_DATA_VERSION}`, JSON.parse(store.get(INDEX_KEY)).version === CURRENT_DATA_VERSION)
check('原始副本已留档', store.has(BACKUP_KEY))
check('副本是迁移前的版本', JSON.parse(store.get(BACKUP_KEY) || '{}').version === 1)
check('副本里保留原值 combat=0', JSON.parse(store.get(BACKUP_KEY)).characters['5145'].combat === 0)

console.log('\n== 6) 幂等 ==')
quiet.info = console.info
const before = store.get(DATA_KEY)
store1.loadRecord(5145)
check('第二次读取不再写回（updatedAt 未变）', store.get(DATA_KEY) === before)

console.log('\n== 7) 失败保护 ==')
seed({ index: okIndex(), characters: { 8001: { combat: 0 } }, dataVersion: 0 })
const survived = store1.loadRecord(8001)
equal('迁移抛错时原样返回，不炸', survived, { combat: 0 })
check('未写回（版本仍是 0）', JSON.parse(store.get(DATA_KEY)).version === 0)

console.log('\n== 8) 旧版单档 → 默认存档（走写入边界兜底）==')
seed({ otherData: { [LEGACY_KEY]: { characters: { 9001: { combat: 0, affection: 99 } } } } })
store1.loadStore()
equal('旧版单档数据在写入前已被折回', JSON.parse(store.get(DATA_KEY)).characters['9001'], { combat: 1, affection: 0 })
check('写入后即标记为当前版本', JSON.parse(store.get(DATA_KEY)).version === CURRENT_DATA_VERSION)

console.log('\n== 9) 导入的元信息同样过规格 ==')
const parsed = store1.parseProfile(JSON.stringify({
  format: 'nikke-photos-profile', version: 1, synchroLevel: 99999,
  research: { class: { Attacker: 5000 } }, characters: { 5145: { combat: 99999999 } },
}))
check('导入的同步器越界 → 默认值', parsed.synchroLevel === 200, String(parsed.synchroLevel))
check('导入的研究越界 → 默认值', parsed.research.class.Attacker === 1, String(parsed.research.class.Attacker))

console.log('\n== 10) 方案：老存档补空数组 + 整表读写 ==')
seed({ index: okIndex(), characters: {} })
equal('老索引（没有 schemes 字段）读取后是空数组', store1.getSchemes(), [])
store1.saveSchemes([
  { name: '方案1', affection: 10 },
  { name: '方案2', cube: { resourceId: 10003, level: 15 } },
])
const roundTripped = store1.getSchemes()
check('整表写回后仍是 2 个', roundTripped.length === 2, String(roundTripped.length))
check('自动补 id', roundTripped.every((scheme) => typeof scheme.id === 'string' && scheme.id), '')
check('方案1 的好感度保留', roundTripped[0].affection === 10, String(roundTripped[0].affection))
equal('方案2 的魔方保留', roundTripped[1].cube, { resourceId: 10003, level: 15 })
check('缺项被补成 null（不是 undefined）', roundTripped[0].combat === null && roundTripped[0].limitBreak.grade === null, JSON.stringify(roundTripped[0]))

console.log('\n== 11) 方案归一化：越界一律归「不指定」 ==')
const dirty = store1.saveSchemes([
  { id: 'dup', name: 'A', affection: 99, combat: 0, limitBreak: { grade: 9 }, skills: { skill1: 11, skill2: 5 } },
  { id: 'dup', name: 'B', favoriteItem: { rarity: 'SSR', level: 2 }, cube: { resourceId: 99999, level: 3 } },
])
check('越界好感度 → null', dirty[0].affection === null, String(dirty[0].affection))
check('越界战斗力 0 → null（不是折回 1）', dirty[0].combat === null, String(dirty[0].combat))
check('越界星级 → null', dirty[0].limitBreak.grade === null, String(dirty[0].limitBreak.grade))
check('合法技能等级保留、越界的归 null', dirty[0].skills.skill2 === 5 && dirty[0].skills.skill1 === null, JSON.stringify(dirty[0].skills))
check('方案里不允许 SSR 品质（珍藏品走另一个字段）', dirty[1].favoriteItem.rarity === null, String(dirty[1].favoriteItem.rarity))
check('收藏品等级保留', dirty[1].favoriteItem.level === 2, String(dirty[1].favoriteItem.level))
check('未知魔方 id → null', dirty[1].cube.resourceId === null, String(dirty[1].cube.resourceId))
check('id 冲突时换新 id', dirty[1].id !== 'dup', dirty[1].id)

console.log('\n== 12) applyScheme：四种组合 ==')
const baseRecord = {
  limitBreak: { grade: 2 },
  affection: null,
  combat: null,
  skills: { skill1: 5 },
  cube: { resourceId: 10001, nameCn: '旧魔方', nameEn: 'old', level: 3 },
  favoriteItem: { rarity: 'SR', level: 4 },
  equipments: [[{ functionType: 'StatAtk', level: 7 }], [], [], []],
}
const scheme = {
  id: 's1', name: '标准', forceReplace: false,
  limitBreak: { grade: 1, core: 7 }, affection: 10, combat: 100,
  skills: { skill1: 1, skill2: 2, burst: null },
  cube: { resourceId: 10003, level: 15 },
  favoriteItem: { rarity: 'R', level: 5 },
  favoriteSsrLevel: 2,
}

const relaxed = applyScheme(baseRecord, scheme, { isFavoriteCharacter: false })
check('不勾强制替换：只填空缺（核心/好感度/战斗力/技能2）', relaxed.filled.length === 4 && relaxed.overwritten.length === 0, JSON.stringify({ filled: relaxed.filled, overwritten: relaxed.overwritten }))
check('不勾强制替换：已填的星级不动', relaxed.record.limitBreak.grade === 2, String(relaxed.record.limitBreak.grade))
check('不勾强制替换：已有魔方不动', relaxed.record.cube.resourceId === 10001, String(relaxed.record.cube.resourceId))
check('非珍藏品角色：忽略珍藏品设置并说明', relaxed.notes.length === 1 && relaxed.record.favoriteItem.rarity === 'SR', JSON.stringify(relaxed.notes))
check('装备词条原样（同一个引用）', relaxed.record.equipments === baseRecord.equipments, '')

const forced = applyScheme(baseRecord, scheme, { force: true, isFavoriteCharacter: true })
check('勾强制替换：覆盖有值的字段', forced.overwritten.length === 4, JSON.stringify(forced.overwritten.map((item) => item.label)))
check('勾强制替换：方案里留空的爆裂技能不碰（Q24）', forced.record.skills.burst === undefined, String(forced.record.skills.burst))
check('勾强制替换：魔方换类型也换等级', forced.record.cube.resourceId === 10003 && forced.record.cube.level === 15, JSON.stringify(forced.record.cube))
check('珍藏品角色：2⭐ → 内部存 1', forced.record.favoriteItem.rarity === 'SSR' && forced.record.favoriteItem.level === 1, JSON.stringify(forced.record.favoriteItem))
check('原记录未被修改', baseRecord.limitBreak.grade === 2 && baseRecord.cube.level === 3, '')

const blank = applyScheme(baseRecord, { id: 's2', name: '空', forceReplace: true }, { force: true, isFavoriteCharacter: true })
check('全空方案 + 强制替换：记录原样返回，什么都不做', blank.record === baseRecord && blank.filled.length === 0 && blank.overwritten.length === 0, '')

console.log('\n== 13) 命名 / 摘要 / 导入合并 ==')
check('自动编号取最大 N + 1', nextSchemeName([{ name: '方案1' }, { name: '方案3' }, { name: '自定义' }]) === '方案4', nextSchemeName([{ name: '方案1' }, { name: '方案3' }, { name: '自定义' }]))
check('重名判定忽略首尾空格', isSchemeNameTaken([{ id: 'a', name: '方案1' }], ' 方案1 ') === true, '')
check('重名判定可排除自己（编辑场景）', isSchemeNameTaken([{ id: 'a', name: '方案1' }], '方案1', 'a') === false, '')
check('新建方案预填魔方：遗迹巨熊 15 级', schemeSummary(createScheme('x')).includes('遗迹巨熊魔方 · 15 级'), schemeSummary(createScheme('x')))
check('全空方案摘要为空串', schemeSummary({ name: 'x' }) === '', schemeSummary({ name: 'x' }))

seed({ index: okIndex(), characters: {} })
store1.saveSchemes([{ name: '方案1', affection: 10 }])
store1.importIntoProfile('default', store1.parseProfile(JSON.stringify({
  format: 'nikke-photos-profile', version: 1, synchroLevel: 200,
  schemes: [{ name: '方案1', combat: 100 }, { name: '方案2', affection: 20 }],
  characters: { 5145: { combat: 1000 } },
})))
const merged = store1.getSchemes()
check('导入的方案是合并，不是覆盖', merged.length === 3, JSON.stringify(merged.map((item) => item.name)))
check('重名自动改成「方案1 (2)」', merged.some((item) => item.name === '方案1 (2)'), JSON.stringify(merged.map((item) => item.name)))
check('未重名的保持原名', merged.some((item) => item.name === '方案2'), '')
check('本机原有的方案没被动', merged.some((item) => item.name === '方案1' && item.affection === 10), JSON.stringify(merged[0]))
check('导出带上方案', JSON.parse(store1.exportProfile()).schemes.length === 3, '')
equal('mergeSchemes 的改名回执', mergeSchemes([{ name: 'A' }], [{ name: 'A' }, { name: 'A' }]).renames.map((item) => item.to), ['A (2)', 'A (3)'])

console.info = quiet.info
console.warn = quiet.warn
console.log(`\n${failures === 0 ? '全部通过' : `${failures} 项未通过`}`)
process.exitCode = failures === 0 ? 0 : 1
