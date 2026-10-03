// BlaBlaLink 账号导出文件 → 角色记录的映射回归
//
//   node scripts/check-account-import.mjs
//
// 覆盖：
//   1) 格式与版本校验：坏 JSON / 非对象 / 缺或错 format / 版本过高 / 没有 characters / 全部未收录
//   2) 正常映射：一个角色全字段落到我们的记录形状
//   3) 越界与缺失一律留空（**绝不写 0**）——落库层会把 0 折成 fallback，界面看不到
//   4) SSR 收藏品内部值 0-2；账号说 SSR 但不是珍藏品角色要留痕
//   5) 魔方：cubeId(1000301…) → resourceId(10001…)；未知编号整组丢弃；0 不算"未知"
//   6) 词条：value 按我们自己的档位表推导；档位/词条名不合法丢弃；同位置多条取首条
//   7) 研究所 tid → 我们存档表的键；1001(general) 丢弃
//   8) 存档名截断 / 控制字符
//   9) **产出的记录必须能原样通过 sanitizeCharacters**（否则会被静默改写）
import { AFFIX_TIER_VALUES } from '../src/data/affixTiers.js'
import { findCubeByCubeId } from '../src/lib/cubes.js'
import { parseAccountExport } from '../src/lib/accountImport.js'
import { sanitizeCharacters } from '../src/lib/profileMigrations.js'
import { CHARACTERS, findCharacter } from '../src/lib/roster.js'

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

const favoriteChar = CHARACTERS.find((c) => c.favoriteItem)
const plainChar = CHARACTERS.find((c) => !c.favoriteItem && !c.cnExclusive)
check('样本前提：找得到珍藏品角色与非珍藏品角色', Boolean(favoriteChar && plainChar),
  `${favoriteChar?.nameCode} / ${plainChar?.nameCode}`)

const entry = (overrides = {}) => ({
  nameCode: favoriteChar.nameCode,
  level: 200,
  grade: 3,
  core: 2,
  combat: 204140,
  affection: 10,
  skills: { skill1: 10, skill2: 10, burst: 10 },
  cube: { cubeId: 1000301, level: 15 },
  favoriteItem: { tid: 20011, level: 2 },
  equipments: [
    [{ functionType: 'StatAtk', level: 12 }, null, null],
    [null, null, null],
    [{ functionType: 'IncElementDmg', level: 15 }, null, { functionType: 'StatCritical', level: 3 }],
    [null, null, null],
  ],
  ...overrides,
})

const sample = (overrides = {}) => ({
  format: 'nikke-photos-account',
  version: 1,
  source: 'blablalink',
  exportedAt: '2026-10-03T16:20:00+08:00',
  areaId: '84',
  profileName: '测试昵称',
  synchroLevel: 200,
  outpostLevel: 47,
  researches: [
    { tid: 1101, lv: 100 }, { tid: 1102, lv: 5 }, { tid: 1103, lv: 20 },
    { tid: 1201, lv: 12 }, { tid: 1202, lv: 3 }, { tid: 1203, lv: 0 },
    { tid: 1204, lv: 8 }, { tid: 1205, lv: 0 }, { tid: 1001, lv: 60 },
  ],
  characters: [entry()],
  ...overrides,
})

const parse = (payload) => parseAccountExport(typeof payload === 'string' ? payload : JSON.stringify(payload))

console.log('\n== 1) 格式与版本校验 ==')
check('坏 JSON', parse('{oops').ok === false)
check('JSON 但不是对象', parse('[1,2,3]').ok === false)
check('缺少 format 标识', parse({ characters: [] }).ok === false)
check('format 不认识', parse({ format: 'other', characters: [] }).ok === false)
check('版本过高', parse({ format: 'nikke-photos-account', version: 99, characters: [] }).ok === false)
check('没有 characters', parse({ format: 'nikke-photos-account', version: 1 }).ok === false)
// 这个用例要求"一个角色都匹配不上"，所以编号必须永远不在图鉴里。
// （原来用的是 5181，后来 5181 被补录进图鉴，用例就失效了 —— 换成明确不会出现的 9999）
const UNMATCHED_CODE = '9999'
check('全部未收录 → 报错而不是产出空档', parse(sample({ characters: [entry({ nameCode: UNMATCHED_CODE })] })).ok === false)
check('报错信息是字符串数组', parse('x').errors.every((item) => typeof item === 'string'))

console.log('\n== 2) 正常映射 ==')
const full = parse(sample())
check('解析成功', full.ok === true, full.errors.join('；'))
equal('parsed 形状与 parseProfile 一致', Object.keys(full.parsed).sort(), [
  'characters', 'count', 'name', 'remark', 'research', 'schemes', 'synchroLevel', 'unknown',
].sort())
check('写入 1 个角色', full.parsed.count === 1, String(full.parsed.count))
equal('存档级：同步器等级', full.parsed.synchroLevel, 200)
equal('研究所：职业三项', [full.parsed.research.class.Attacker, full.parsed.research.class.Defender, full.parsed.research.class.Supporter], [100, 5, 20])
equal('研究所：企业五项', [
  full.parsed.research.corporation.ELYSION, full.parsed.research.corporation.MISSILIS,
  full.parsed.research.corporation.TETRA, full.parsed.research.corporation.PILGRIM,
  full.parsed.research.corporation.ABNORMAL,
], [12, 3, 0, 8, 0])
check('备注带来源与 area', full.parsed.remark.includes('BlaBlaLink 导入') && full.parsed.remark.includes('area 84'), full.parsed.remark)

const rec = full.parsed.characters[favoriteChar.nameCode]
equal('突破 / 核心', rec.limitBreak, { grade: 3, core: 2 })
equal('好感度 / 战斗力', [rec.affection, rec.combat], [10, 204140])
equal('技能三项', rec.skills, { skill1: 10, skill2: 10, burst: 10 })
equal('魔方：cubeId → resourceId', rec.cube, { resourceId: 10001, nameCn: '遗迹突击魔方', nameEn: 'Assault Cube', level: 15 })
equal('收藏品：SSR 内部值', rec.favoriteItem, { rarity: 'SSR', level: 2 })
check('部位顺序：0=头 2=臂', rec.equipments[0][0].functionType === 'StatAtk' && rec.equipments[2][0].functionType === 'IncElementDmg', JSON.stringify(rec.equipments))
equal('空行留 null', [rec.equipments[1][0], rec.equipments[0][1]], [null, null])
equal('词条 value 按档位表推导', rec.equipments[0][0].value, AFFIX_TIER_VALUES.StatAtk[11])
equal('第三条词条按 position 归位', rec.equipments[2][2].functionType, 'StatCritical')

console.log('\n== 3) 越界与缺失一律留空（不写 0）==')
const bad = parse(sample({
  synchroLevel: 0,
  characters: [entry({
    combat: 0, affection: 99, grade: 9, core: null,
    skills: { skill1: 0, skill2: null, burst: 11 },
  })],
}))
check('同步器 0 → 预填最小值 1', bad.parsed.synchroLevel === 1, String(bad.parsed.synchroLevel))
check('同步器拿不到时给出提示', bad.report.synchroFallback === true && bad.report.notices.some((n) => n.includes('同步器等级')))
const badRec = bad.parsed.characters[favoriteChar.nameCode]
equal('战斗力 0 → null（不是 1）', badRec.combat, null)
equal('好感度 99 → null（不是折回 40）', badRec.affection, null)
equal('突破 9 → null', badRec.limitBreak.grade, null)
equal('核心缺失 → null', badRec.limitBreak.core, null)
equal('技能 0 / 缺失 / 越界 → 全 null', badRec.skills, { skill1: null, skill2: null, burst: null })
check('留空的字段被统计出来', Object.keys(bad.report.fieldIssues).length >= 4, JSON.stringify(bad.report.fieldIssues))

console.log('\n== 4) 收藏品品质与等级 ==')
const rItem = parse(sample({ characters: [entry({ favoriteItem: { tid: 10011, level: 0 } })] }))
equal('R 品质识别 + 0 级 → null（我们没有 0 级）', rItem.parsed.characters[favoriteChar.nameCode].favoriteItem, { rarity: 'R', level: null })
const srItem = parse(sample({ characters: [entry({ favoriteItem: { tid: 10012, level: 15 } })] }))
equal('SR 品质 + 15 级保留', srItem.parsed.characters[favoriteChar.nameCode].favoriteItem, { rarity: 'SR', level: 15 })
const srOver = parse(sample({ characters: [entry({ favoriteItem: { tid: 10012, level: 16 } })] }))
equal('SR 超范围 → null', srOver.parsed.characters[favoriteChar.nameCode].favoriteItem.level, null)
const ssrZero = parse(sample({ characters: [entry({ favoriteItem: { tid: 20011, level: 0 } })] }))
equal('SSR 内部 0 保留（界面 1⭐）', ssrZero.parsed.characters[favoriteChar.nameCode].favoriteItem.level, 0)
const ssrThree = parse(sample({ characters: [entry({ favoriteItem: { tid: 20011, level: 3 } })] }))
check('SSR 给到 3（超出 0-2）→ 夹到 2 并留痕', ssrThree.parsed.characters[favoriteChar.nameCode].favoriteItem.level === 2
  && ssrThree.report.fieldIssues['收藏品等级'] === 1, JSON.stringify(ssrThree.report.fieldIssues))
const tidZero = parse(sample({ characters: [entry({ favoriteItem: { tid: 0, level: 0 } })] }))
check('tid 0 → 不写收藏品', tidZero.parsed.characters[favoriteChar.nameCode].favoriteItem === undefined)

const mismatch = parse(sample({ characters: [entry({ nameCode: plainChar.nameCode, favoriteItem: { tid: 20011, level: 1 } })] }))
check('账号说 SSR 但不是珍藏品角色 → 留痕且不阻断', mismatch.ok === true && mismatch.report.favoriteMismatch === 1
  && mismatch.report.notices.some((n) => n.includes('不是珍藏品角色')), JSON.stringify(mismatch.report.notices))

console.log('\n== 5) 魔方 ==')
equal('cubeId 1000303 → 遗迹巨熊魔方', findCubeByCubeId(1000303).nameCn, '遗迹巨熊魔方')
const unknownCube = parse(sample({ characters: [entry({ cube: { cubeId: 999999, level: 15 } })] }))
check('未知 cubeId → 整组丢弃 + 留痕', unknownCube.parsed.characters[favoriteChar.nameCode].cube === undefined
  && unknownCube.report.unknownCube === 1, JSON.stringify(unknownCube.report.notices))
const noCube = parse(sample({ characters: [entry({ cube: { cubeId: 0, level: 0 } })] }))
check('没装魔方（cubeId 0）→ 不算"未知"', noCube.parsed.characters[favoriteChar.nameCode].cube === undefined
  && noCube.report.unknownCube === 0, String(noCube.report.unknownCube))
const cubeNoLevel = parse(sample({ characters: [entry({ cube: { cubeId: 1000301, level: 0 } })] }))
check('有类型没等级 → 保留类型、等级留空', cubeNoLevel.parsed.characters[favoriteChar.nameCode].cube.level === null
  && cubeNoLevel.parsed.characters[favoriteChar.nameCode].cube.resourceId === 10001)

console.log('\n== 6) 词条 ==')
const messy = parse(sample({
  characters: [entry({
    equipments: [
      // 不带 position → 按数组下标归位到第 1、2 格（**不算冲突**）
      [{ functionType: 'StatAtk', level: 12 }, { functionType: 'StatDef', level: 1 }, null],
      // 词条名不合法 / 档位 16 → 各丢弃一条
      [{ functionType: '不存在的词条', level: 3 }, { functionType: 'StatDef', level: 16 }, null],
      [null, null, null],
      // 两条都显式声明 position=2 → 真冲突，取首条
      [{ functionType: 'StatAmmoLoad', level: 12, position: 2 }, { functionType: 'StatAtk', level: 1, position: 2 }, null],
    ],
  })],
}))
const messyRec = messy.parsed.characters[favoriteChar.nameCode]
check('不带 position 的两条按下标归位、不误报冲突',
  messyRec.equipments[0][0].functionType === 'StatAtk' && messyRec.equipments[0][1].functionType === 'StatDef',
  JSON.stringify(messyRec.equipments[0]))
check('空行不占位、不误报冲突', messyRec.equipments[2].every((line) => line === null))
check('同位置两条 → 取首条并留痕',
  messyRec.equipments[3][1].functionType === 'StatAmmoLoad' && messyRec.equipments[3][2] === null
  && messy.report.positionConflicts === 1,
  JSON.stringify({ slot3: messyRec.equipments[3], conflicts: messy.report.positionConflicts }))
equal('词条名不合法 / 档位 16 → 丢弃', [messyRec.equipments[1][0], messyRec.equipments[1][1]], [null, null])

const mismatchValue = parse(sample({
  characters: [entry({ equipments: [[{ functionType: 'StatAtk', level: 12, value: 99.99 }, null, null], [], [], []] })],
}))
check('接口百分比与我们档位表不一致 → 留痕但仍用我们的值', mismatchValue.report.valueMismatch === 1
  && mismatchValue.parsed.characters[favoriteChar.nameCode].equipments[0][0].value === AFFIX_TIER_VALUES.StatAtk[11],
  JSON.stringify(mismatchValue.report.notices))

console.log('\n== 7) 研究所等级 ==')
const dropGeneral = parse(sample())
check('1001(general) 被丢弃、不产生额外键', !('general' in dropGeneral.parsed.research)
  && Object.keys(dropGeneral.parsed.research.class).length === 3
  && Object.keys(dropGeneral.parsed.research.corporation).length === 5, JSON.stringify(dropGeneral.parsed.research))
const researchDefault = parse(sample({ researches: [{ tid: 1101, lv: 9999 }, { tid: 1201, lv: null }] }))
check('越界 / 缺失的研究等级保持默认 1', researchDefault.parsed.research.class.Attacker === 1
  && researchDefault.parsed.research.corporation.ELYSION === 1, JSON.stringify(researchDefault.parsed.research))

console.log('\n== 8) 存档名 ==')
const longName = parse(sample({ profileName: '一'.repeat(31) }))
check('超过 30 字 → 截断到 30 并留痕', longName.parsed.name.length === 30 && longName.report.nameTruncated === true,
  `${longName.parsed.name.length} / ${longName.report.nameTruncated}`)
const dirtyName = parse(sample({ profileName: '  昵\u0000称\u001f  ' }))
equal('去控制字符并 trim', dirtyName.parsed.name, '昵称')
equal('空昵称留空串（由界面回落到自动编号）', parse(sample({ profileName: '   ' })).parsed.name, '')

console.log('\n== 9) 产出必须原样通过 sanitizeCharacters（否则会被静默改写）==')
const deepDiff = (left, right, path = '') => {
  if (left === right) return ''
  if (typeof left !== typeof right || left === null || right === null) return `${path}: ${JSON.stringify(left)} → ${JSON.stringify(right)}`
  if (typeof left !== 'object') return `${path}: ${JSON.stringify(left)} → ${JSON.stringify(right)}`
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])]
  for (const key of keys) {
    const diff = deepDiff(left[key], right[key], `${path}.${key}`)
    if (diff) return diff
  }
  return ''
}
const sanitizeSafe = (label, payload) => {
  const parsed = parse(payload)
  check(`${label} 解析成功`, parsed.ok === true, parsed.errors.join('；'))
  if (!parsed.ok) return parsed
  const safe = sanitizeCharacters(parsed.parsed.characters)
  const diff = deepDiff(parsed.parsed.characters, safe)
  check(`${label} 记录未被 sanitize 改写`, diff === '', diff)
  return parsed
}
sanitizeSafe('标准样本', sample())
sanitizeSafe('全是边界值', sample({
  synchroLevel: 1,
  characters: [entry({
    grade: 0, core: 0, combat: 1, affection: 0,
    skills: { skill1: 1, skill2: 5, burst: 10 },
    cube: { cubeId: 1000317, level: 1 },
    favoriteItem: { tid: 10012, level: 15 },
    equipments: [[{ functionType: 'StatCritical', level: 15 }, null, null], [], [], []],
  }), entry({ nameCode: plainChar.nameCode, cube: null, favoriteItem: null, skills: null, equipments: [] })],
}))
sanitizeSafe('多项留空的样本', sample({
  characters: [entry({
    grade: null, core: null, combat: 0, affection: null, skills: {},
    cube: { cubeId: 0 }, favoriteItem: { tid: 0 }, equipments: [null, null, null, null],
  })],
}))

console.log(`\n${failures === 0 ? '全部通过' : `${failures} 项未通过`}`)
process.exitCode = failures === 0 ? 0 : 1
