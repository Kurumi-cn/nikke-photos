// 繁中本地化的健康检查（数据层名词 + 界面文案字典）
//
// 用法：npm run i18n:check        （有问题时退出码 1）
//        npm run i18n:check -- --list   额外列出"还没套 t() 的中文行"工作清单
//
// 三件事：
//   1) 数据层名词：把角色名/皮肤名/分类标签/词条名/魔方名过一遍映射，列出
//      · 未映射字符（既不是映射表的简、也不是繁 → 需要人工看是不是漏网简体字）
//      · 歧义字符（映射表里一字多繁，比如 发→發/髮）——出现在我们数据里就要人工定夺
//   2) 界面字典：zh-Hant.js 里的 key 必须还能在源码里找到（防陈旧条目）；
//      每个繁体值再走一遍映射，若还会被改写说明残留了简体字。
//   3) --list：扫出源码里含中文、但没套 t()/tData() 的行（迁移工作清单，仅提示不判错）
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { FUNCTION_LABELS } from '../src/data/affixTiers.js'
import { HANT_TABLES, toHant, toHantChars } from '../src/lib/hant.js'
import { ZH_HANT } from '../src/locales/zh-Hant.js'

const APP_DIR = path.resolve(import.meta.dirname, '..')
const SRC = path.join(APP_DIR, 'src')
const CJK = /[\u4e00-\u9fff]/

let failures = 0
const section = (title) => console.log(`\n== ${title} ==`)
const fail = (message) => { failures += 1; console.error(`  [FAIL] ${message}`) }
const ok = (message) => console.log(`  [OK]   ${message}`)
const info = (message) => console.log(`  · ${message}`)

const readJSON = (rel) => JSON.parse(readFileSync(path.join(SRC, rel), 'utf8'))

// ---- 1) 数据层名词 ----
section('1) 数据层名词映射')

const roster = readJSON('data/roster.json')
const cubes = readJSON('data/cubes.json')

const dataStrings = []
for (const character of roster.characters) {
  dataStrings.push(['角色名', character.nameCn])
  for (const alias of character.aliases || []) dataStrings.push(['角色别名', alias])
  for (const art of character.artworks || []) if (art.label) dataStrings.push(['皮肤名', art.label])
}
for (const group of roster.taxonomy.filters) {
  for (const option of group.options) if (option.label) dataStrings.push(['分类标签', option.label])
}
for (const cube of Object.values(cubes.cubes || cubes)) {
  if (cube?.nameCn) dataStrings.push(['魔方名', cube.nameCn])
}
for (const label of Object.values(FUNCTION_LABELS || {})) dataStrings.push(['词条名', label])

const { map: S2T, words: WORDS, ambiguous } = HANT_TABLES
const traditionalValues = new Set(Object.values(S2T))
const wordValues = new Set(Object.values(WORDS))

const unknownChars = new Map() // char -> 例子
const ambiguousHits = new Map() // char -> candidates
for (const [kind, text] of dataStrings) {
  const converted = toHant(text)
  for (const ch of converted) {
    if (!CJK.test(ch)) continue
    if (ambiguous[ch] && !ambiguousHits.has(ch)) ambiguousHits.set(ch, { kind, text, candidates: ambiguous[ch] })
    if (!S2T[ch] && !traditionalValues.has(ch)) {
      if (!unknownChars.has(ch)) unknownChars.set(ch, `${kind}「${text}」`)
    }
  }
}
console.log(`  名词条目 ${dataStrings.length} 条；映射表 ${Object.keys(S2T).length} 简→繁、词表 ${Object.keys(WORDS).length} 条`)
if (unknownChars.size === 0) ok('没有"表里查不到"的汉字')
else {
  info(`表里查不到的汉字 ${unknownChars.size} 个（多数是简繁同形，抽几个看）：`)
  for (const [ch, sample] of [...unknownChars].slice(0, 12)) info(`   ${ch} ← ${sample}`)
}
if (ambiguousHits.size > 0) {
  info(`一字多繁的字出现在数据里 ${ambiguousHits.size} 个（当前用首选写法，需人工过一眼）：`)
  for (const [ch, hit] of [...ambiguousHits].slice(0, 12)) info(`   ${ch} → ${hit.candidates.join('/')} ← ${hit.kind}「${hit.text}」`)
}

// 词表值本身也要是"已是繁体"的（防止手滑写成简体）
const badWords = Object.entries(WORDS).filter(([, value]) => toHant(value) !== value)
if (badWords.length === 0) ok('词表的值都是规范繁体')
else fail(`词表里有值的写法会被再次改写（疑似含简体）：${badWords.slice(0, 6).map(([k, v]) => `${k}→${v}`).join('、')}`)

// ---- 2) 界面字典 ----
section('2) 界面字典（locales/zh-Hant.js）')

let sourceText = ''
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    const rel = path.relative(SRC, full).replaceAll('\\', '/')
    if (entry.isDirectory()) {
      if (rel.startsWith('data/i18n') || rel === 'locales') continue
      walk(full)
    } else if (/\.(jsx?|json)$/.test(entry.name)) {
      sourceText += readFileSync(full, 'utf8')
    }
  }
}
walk(SRC)

const entries = Object.entries(ZH_HANT)
const stale = entries.filter(([key]) => !sourceText.includes(key))
if (stale.length === 0) ok(`${entries.length} 条字典条目的原文都能在源码里找到`)
else fail(`有 ${stale.length} 条字典 key 在源码里找不到（可能是改过字面或已删除）：${stale.slice(0, 5).map(([key]) => key).join('、')}`)

const dirtyValues = entries.filter(([, value]) => toHant(value) !== value)
if (dirtyValues.length === 0) ok('字典里的繁体值没有被再次改写（无残留简体）')
else fail(`有 ${dirtyValues.length} 条繁体值会被再次改写（疑似残留简体）：${dirtyValues.slice(0, 5).map(([key, value]) => `${key}→${value}`).join('、')}`)

// ---- 3) 迁移工作清单（可选） ----
if (process.argv.includes('--list')) {
  section('3) 还没套 t() 的中文行（工作清单，仅供参考）')
  const CJK_TEST = /[\u4e00-\u9fff]/
  const skipLine = (line) => {
    const trimmed = line.trim()
    return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')
      || trimmed.includes('t(') || trimmed.includes('tData(') || trimmed.includes('console.')
  }
  let count = 0
  const walkList = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      const rel = path.relative(SRC, full).replaceAll('\\', '/')
      if (entry.isDirectory()) {
        if (rel.startsWith('data') || rel === 'locales' || rel === 'styles' || rel === 'assets') continue
        walkList(full)
      } else if (/\.jsx?$/.test(entry.name)) {
        if (rel.startsWith('lib/i18n') || rel.startsWith('lib/hant')) continue
        const lines = readFileSync(full, 'utf8').split('\n')
        lines.forEach((line, index) => {
          if (!CJK_TEST.test(line) || skipLine(line)) return
          count += 1
          if (count <= 40) info(`${rel}:${index + 1}  ${line.trim().slice(0, 70)}`)
        })
      }
    }
  }
  walkList(SRC)
  info(`共 ${count} 行（前 40 条已列出）`)
}

console.log(`\n${failures === 0 ? '全部通过' : `${failures} 项未通过`}`)
process.exitCode = failures === 0 ? 0 : 1