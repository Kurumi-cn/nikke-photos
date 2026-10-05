// NIKKE Workshop 图鉴 xlsx → 本工具角色记录 的解析回归
//
//   node scripts/check-workshop-import.mjs <图鉴.xlsx> [--dump]
//
// 脚本只读文件、只打印结果，不写任何存储（localStorage 也不碰）。
// 断言：
//   1) 产出记录能**原样通过 sanitizeCharacters** —— 否则会被落库层静默改写（与 account:check 同一条纪律）
//   2) 每条词条的 value 必须等于本工具档位表里该档位的值（数值口径唯一）
//   3) 每个角色至少有一件装备的词条，或至少一个角色级数值（不能产出空记录）
//   4) 报告里的跳过项都有对应的 notices 文案（用户看得到）
// --dump 额外打印每个角色的字段摘要，人工核对用。
import { readFile } from 'node:fs/promises'
import { AFFIX_TIER_VALUES } from '../src/data/affixTiers.js'
import { parseWorkshopExcel } from '../src/lib/workshopImport.js'
import { sanitizeCharacters } from '../src/lib/profileMigrations.js'

const file = process.argv[2]
if (!file) {
  console.error('用法：node scripts/check-workshop-import.mjs <图鉴.xlsx> [--dump]')
  process.exit(2)
}

let failures = 0
const check = (label, ok, detail = '') => {
  if (ok) console.log(`  [OK]   ${label}`)
  else { failures += 1; console.error(`  [FAIL] ${label}${detail ? `：${detail}` : ''}`) }
}

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

const buffer = await readFile(file)
let result
try {
  result = await parseWorkshopExcel(buffer, { now: Date.parse('2026-10-05T12:00:00+08:00') })
} catch (problem) {
  console.error(`解析失败：${problem?.message || problem}`)
  process.exit(1)
}
const { parsed, report } = result

console.log(`\n文件：${file}`)
console.log(`解析出 ${parsed.count} 个角色，跳过未收录 ${report.unmatched.length} 个，空数据 ${report.emptySkipped} 个`)
console.log('\n== 处理说明 ==')
parsed.notices.forEach((notice) => console.log(`  · ${notice}`))

console.log('\n== 1) 记录形状与落库安全 ==')
const diff = deepDiff(parsed.characters, sanitizeCharacters(parsed.characters))
check('记录原样通过 sanitizeCharacters', diff === '', diff)
check('parsed 形状与 parseProfile 一致（+notices）', ['characters', 'count', 'name', 'notices', 'remark', 'research', 'schemes', 'synchroLevel', 'unknown']
  .every((key) => key in parsed), Object.keys(parsed).join(','))
check('synchroLevel 为 null（文件里没有，交给导入流程）', parsed.synchroLevel === null, String(parsed.synchroLevel))
check('带 origin=workshop 标记（导入流程据此取默认存档名 workshop导入N）', parsed.origin === 'workshop', String(parsed.origin))
check('每个角色至少有一件装备或一个角色级数值', Object.values(parsed.characters).every((record) => (
  record.equipments.some((slot) => slot.some(Boolean))
  || [record.limitBreak.grade, record.limitBreak.core, record.affection, record.combat,
    record.skills.skill1, record.skills.skill2, record.skills.burst].some((value) => value !== null)
)))

console.log('\n== 2) 词条数值口径 ==')
let lineCount = 0
const mismatched = []
for (const [code, record] of Object.entries(parsed.characters)) {
  record.equipments.forEach((slot, slotIndex) => slot.forEach((line, lineIndex) => {
    if (!line) return
    lineCount += 1
    const expected = AFFIX_TIER_VALUES[line.functionType]?.[line.level - 1]
    if (line.value !== expected) mismatched.push(`${code} 槽${slotIndex + 1} 第${lineIndex + 1} 条`)
  }))
}
check(`全部 ${lineCount} 条词条的 value 都等于档位表对应值`, mismatched.length === 0, mismatched.slice(0, 5).join('; '))

console.log('\n== 3) 报告与说明对得上 ==')
const noticeText = parsed.notices.join('\n')
check('未收录角色有说明', report.unmatched.length === 0 || noticeText.includes('图鉴未收录'))
check('越界字段有说明', Object.keys(report.fieldIssues).length === 0 || noticeText.includes('数值越界'))
check('未导入的存档级列（等级/职业等级/企业等级）有说明',
  report.levelFieldCharacters === 0 || noticeText.includes('按角色填写'),
  `levelFieldCharacters=${report.levelFieldCharacters}`)

if (process.argv.includes('--dump')) {
  console.log('\n== 角色明细 ==')
  for (const [code, record] of Object.entries(parsed.characters)) {
    const lines = record.equipments.flat().filter(Boolean)
    console.log(`  ${code}: 突破${record.limitBreak.grade ?? '-'}/${record.limitBreak.core ?? '-'} 好感${record.affection ?? '-'} 战力${record.combat ?? '-'} 技能${record.skills.skill1 ?? '-'}/${record.skills.skill2 ?? '-'}/${record.skills.burst ?? '-'} 词条${lines.length}条`)
  }
}

console.log(`\n${failures === 0 ? '全部通过' : `${failures} 项未通过`}`)
process.exitCode = failures === 0 ? 0 : 1