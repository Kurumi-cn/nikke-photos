// 生成 BOT 出图用的字体（放到 bot/<插件>/assets/fonts/）。
//
// 用法：node bot/tools/build-fonts.mjs
// 何时需要重跑：卡片/统计表的界面文案出现了新的汉字，或角色表里新增了名字 ——
//   否则那些字会缺字形（画出来是空白），而且不会有报错，很难发现。
//   脚本会把两个子集字体的字符集写进 coverage.json，出图模块会据此告警。
//
// 字体选择与网页端的对应关系（网页端跑在 Windows 上，用的是微软雅黑 / Bahnschrift，
// 这两个都无法随插件分发，所以换成观感最接近的自由字体）：
//   · 一般中文       网页 Microsoft YaHei          → Noto Sans SC Regular（子集）
//   · 装备词条区中文  网页 SC_common_extra_bold     → Noto Sans SC Black（子集）
//   · 一般数字/西文   网页 Bahnschrift              → Industry Demi（同为 DIN 风格，仅 52KB 不子集）
//   · 词条区数字      网页 Deco_ext_azx (Azonix)    → Azonix Regular（原样，12KB）
//
// 源字体来自解包字体库（外部路径），与 app/scripts/build-card-font-subset.mjs 同源。

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'

const BOT_DIR = path.resolve(import.meta.dirname, '..')
const PROJECT_DIR = path.resolve(BOT_DIR, '..')
const PLUGIN_DIR = path.join(BOT_DIR, 'astrbot_plugin_nikke_roster')
const OUT_DIR = path.join(PLUGIN_DIR, 'assets', 'fonts')

const FONT_LIB = 'D:\\NIKKE备用工作区0923_tools\\font_library\\fonts'
const PYTHON_TOOLS = path.join(PROJECT_DIR, '.tools', 'fonttools')

// 需要子集的：CJK 字体动辄 8MB，出图只用得上很小一部分字
const SUBSET_FONTS = [
  { src: path.join(FONT_LIB, 'OTF', 'Noto_Sans_SC_Regular.otf'), out: 'NotoSansSC-Regular.otf' },
  { src: path.join(FONT_LIB, 'OTF', 'Noto_Sans_SC_Black.otf'), out: 'NotoSansSC-Black.otf' },
]
// 直接拷贝的：本身只有几十 KB，没有子集的必要
const COPY_FONTS = [
  { src: path.join(FONT_LIB, 'TTF', 'Industry-Demi.ttf'), out: 'Industry-Demi.ttf' },
  { src: path.join(FONT_LIB, 'OTF', 'Azonix_Regular.otf'), out: 'Azonix-Regular.otf' },
]

if (!existsSync(FONT_LIB)) {
  console.error(`字体库不存在：${FONT_LIB}`)
  console.error('（解包字体库路径变了的话，改本脚本的 FONT_LIB）')
  process.exit(1)
}
if (!existsSync(PYTHON_TOOLS)) {
  console.error(`缺少 fonttools：请先执行 python -m pip install --target "${PYTHON_TOOLS}" fonttools brotli`)
  process.exit(1)
}

// ── 收集出图可能用到的字符 ────────────────────────────────────────────
const chars = new Set()
// 汉字 + 中文标点 + 常见西文标点（与网页端字模脚本同一套范围）
const cjk = /[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef\u2018\u2019\u201c\u201d\u2026\u2014\u00b7]/g
const exts = new Set(['.js', '.jsx', '.css', '.json', '.py'])

const walk = (dir) => {
  if (!existsSync(dir)) return
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__pycache__') continue
      walk(full)
    } else if (exts.has(path.extname(entry.name))) {
      const found = readFileSync(full, 'utf8').match(cjk)
      if (found) for (const ch of found) chars.add(ch)
    }
  }
}

// 网页端源码：角色名（roster.json）、词条名（affixTiers.js）、卡片文案（characterCard.css）
walk(path.join(PROJECT_DIR, 'app', 'src'))
// BOT 自己的源码：统计表表头、提示文案等
walk(path.join(PLUGIN_DIR, 'core'))
for (const file of ['main.py']) {
  const full = path.join(PLUGIN_DIR, file)
  if (!existsSync(full)) continue
  const found = readFileSync(full, 'utf8').match(cjk)
  if (found) for (const ch of found) chars.add(ch)
}
// 西文与符号：数字、字母、百分号、卡片上出现的方括号与省略号等
for (let code = 0x20; code <= 0x7e; code += 1) chars.add(String.fromCharCode(code))
for (const ch of '★☆【】·—…～×✓✗（）《》、，。；：？！%') chars.add(ch)

const textFile = path.join(tmpdir(), 'nikke-bot-font-chars.txt')
writeFileSync(textFile, [...chars].join(''), 'utf8')

mkdirSync(OUT_DIR, { recursive: true })

// ── 子集 + 拷贝 ──────────────────────────────────────────────────────
const coverage = {}
for (const { src, out } of SUBSET_FONTS) {
  if (!existsSync(src)) {
    console.error(`源字体不存在：${src}`)
    process.exit(1)
  }
  const target = path.join(OUT_DIR, out)
  const result = spawnSync(
    'python',
    ['-m', 'fontTools.subset', src, `--text-file=${textFile}`, `--output-file=${target}`],
    { env: { ...process.env, PYTHONPATH: PYTHON_TOOLS }, stdio: 'inherit' },
  )
  if (result.status !== 0) process.exit(result.status ?? 1)
  coverage[out] = [...chars].join('')
  console.log(`${out}  ${Math.round(statSync(target).size / 1024)} KB`)
}

for (const { src, out } of COPY_FONTS) {
  if (!existsSync(src)) {
    console.error(`源字体不存在：${src}`)
    process.exit(1)
  }
  const target = path.join(OUT_DIR, out)
  copyFileSync(src, target)
  console.log(`${out}  ${Math.round(statSync(target).size / 1024)} KB（原样拷贝）`)
}

// 出图模块靠这个文件判断「这个字在子集字体里有没有」，缺了就在日志里告警
writeFileSync(
  path.join(OUT_DIR, 'coverage.json'),
  `${JSON.stringify({ note: '由 bot/tools/build-fonts.mjs 生成，勿手改', chars: coverage }, null, 1)}\n`,
  'utf8',
)

console.log(`\n共 ${chars.size} 个字符，输出到 ${OUT_DIR}`)
