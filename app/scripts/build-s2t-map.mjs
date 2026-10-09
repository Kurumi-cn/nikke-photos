// 生成「简 → 繁」字符映射表（供繁体模式的名词字形转换使用）
//
// 用法：npm run i18n:map
// 源数据：OpenCC 的 STCharacters.txt（Apache-2.0），一次性下载到工作区：
//   pwsh: Invoke-WebRequest "https://raw.githubusercontent.com/BYVoid/OpenCC/ver.1.1.7/data/dictionary/STCharacters.txt" `
//           -Proxy http://127.0.0.1:7890 -OutFile "E:\博哥\NIKKE Photos\.tools\i18n-research\STCharacters.txt"
// 产物：src/data/i18n/s2t-map.json
//   map       简 → 繁（首选写法），未收录的字保持原样
//   ambiguous 多候选字（如 发→發/髮），供 check-i18n 审计时列出让我们人工过一遍
//
// 说明：只取**单字**条目；多字词条不使用（我们用「例外覆盖表」处理词级差异）。首选候选与源字相同的
// 条目（如 台→台）不进表，避免把本来两边同形的字改坏。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const APP_DIR = path.resolve(import.meta.dirname, '..')
const PROJECT_DIR = path.resolve(APP_DIR, '..')
const SOURCE = path.join(PROJECT_DIR, '.tools', 'i18n-research', 'STCharacters.txt')
const OUT = path.join(APP_DIR, 'src', 'data', 'i18n', 's2t-map.json')

if (!existsSync(SOURCE)) {
  console.error(`缺少源数据：${SOURCE}`)
  console.error('请按文件头的 pwsh 命令先下载 OpenCC 的 STCharacters.txt')
  process.exit(1)
}

const map = {}
const ambiguous = {}
let skippedEqual = 0
let skippedPhrase = 0

// 一字多繁里，按**本项目的语料**钉死首选写法（OpenCC 的默认不一定合适）：
//   为 → 為（OpenCC 给的是异体「爲」，台湾通行「為」）
//   众 → 眾（同上，台湾通行「眾」而非「衆」）
//   里 → 裡（「…里」在台湾写「裡」；角色名「基里」靠词表保护，见 word 表）
//   干 → 乾（我们只有「饼干」这类词；「幹」在本项目用不到）
//   后 → 後（同上；「皇后」这类用法没有）
const PREFERRED = { 为: '為', 众: '眾', 里: '裡', 后: '後', 干: '乾' }
// 两边都合法、且在我们的数据里应保持原样：台（「樱花舞台」用「舞台」更贴游戏社区习惯）
const KEEP_AS_IS = new Set(['台'])

for (const line of readFileSync(SOURCE, 'utf8').split('\n')) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) continue
  const [source, rest] = trimmed.split('\t')
  if (!source || !rest) continue
  const candidates = rest.trim().split(/\s+/).filter(Boolean)
  if (!candidates.length) continue
  if ([...source].length !== 1) {
    skippedPhrase += 1
    continue
  }
  if (KEEP_AS_IS.has(source)) continue
  const preferred = PREFERRED[source] || candidates[0]
  if (preferred === source) {
    skippedEqual += 1
    continue
  }
  map[source] = preferred
  if (candidates.length > 1) ambiguous[source] = candidates
}

const payload = {
  source: 'OpenCC STCharacters.txt (ver.1.1.7)',
  note: '单字简→繁首选写法；多候选字见 ambiguous；词级差异走 name-overrides 例外表',
  count: Object.keys(map).length,
  map,
  ambiguous,
}
mkdirSync(path.dirname(OUT), { recursive: true })
writeFileSync(OUT, `${JSON.stringify(payload, null, 1)}\n`)

console.log(`简→繁映射完成：${payload.count} 条（多候选 ${Object.keys(ambiguous).length} 条，源字同形跳过 ${skippedEqual} 条，多字词条忽略 ${skippedPhrase} 条）`)
console.log(`产物：${OUT}`)