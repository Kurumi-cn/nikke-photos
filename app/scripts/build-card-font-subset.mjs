// 重建角色卡 / 统计表的中文字体子集（游戏字体 → 精简 woff2）
// 何时需要跑：卡片或统计表的界面文案、角色名里出现了新汉字时
// 用法：npm run fonts:card
// 依赖：项目内 .tools/fonttools（一次性安装：python -m pip install --target .tools/fonttools fonttools brotli）
// 源字体：解包字体库（外部路径）：D:\NIKKE备用工作区0923_tools\font_library\fonts\OTF\
//   · Noto_Sans_SC_Black.otf → 简体皮肤用（NotoSansSC-Black-subset.woff2）
//   · Noto_Sans_TC_Black.otf → 繁体皮肤用（NotoSansTC-Black-subset.woff2）
//
// 收字范围的两套规则（关键）：
//   · 简体子集 = 源码里直接出现的汉字（繁中字典、词表、映射表这些"数据文件"不算显示文案，跳过）
//   · 繁体子集 = 简体那套 + 每个字经简繁映射后的繁体写法 + 词表/字典里真正会被显示的字
//     （否则 设置→設定 里的「設」在源码里根本找不到，出图就会缺字）
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'

const APP_DIR = path.resolve(import.meta.dirname, '..')
const PROJECT_DIR = path.resolve(APP_DIR, '..')
const FONT_DIR = 'D:\\NIKKE备用工作区0923_tools\\font_library\\fonts\\OTF'
const PYTHON_TOOLS = path.join(PROJECT_DIR, '.tools', 'fonttools')

const CJK = /[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef\u2018\u2019\u201c\u201d\u2026\u2014\u00b7]/g
const EXTS = new Set(['.js', '.jsx', '.css', '.json'])

/** 收集 src 下源码/数据里的汉字（skip 命中的相对路径前缀整目录跳过） */
function collectChars(skip = []) {
  const chars = new Set()
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      const rel = path.relative(path.join(APP_DIR, 'src'), full).replaceAll('\\', '/')
      if (skip.some((prefix) => rel.startsWith(prefix))) continue
      if (entry.isDirectory()) walk(full)
      else if (EXTS.has(path.extname(entry.name))) {
        const found = readFileSync(full, 'utf8').match(CJK)
        if (found) for (const ch of found) chars.add(ch)
      }
    }
  }
  walk(path.join(APP_DIR, 'src'))
  return chars
}

/** 简繁映射表（数据文件本身不参与收字，只用来推繁体写法） */
const s2t = JSON.parse(readFileSync(path.join(APP_DIR, 'src', 'data', 'i18n', 's2t-map.json'), 'utf8'))

const sourceChars = collectChars(['data/i18n/'])
const hantChars = new Set(sourceChars)
for (const ch of sourceChars) if (s2t.map[ch]) hantChars.add(s2t.map[ch])
// 词表与字典里"会显示"的繁体字（设置→設定 的「設」就只在这里出现）
for (const file of ['locales/zh-Hant.js', 'data/i18n/words.zh-Hant.json']) {
  const text = readFileSync(path.join(APP_DIR, 'src', file), 'utf8')
  for (const ch of text.match(CJK) || []) hantChars.add(ch)
}

const subsets = [
  {
    font: path.join(FONT_DIR, 'Noto_Sans_SC_Black.otf'),
    out: path.join(APP_DIR, 'src', 'assets', 'fonts', 'NotoSansSC-Black-subset.woff2'),
    chars: sourceChars,
  },
  {
    font: path.join(FONT_DIR, 'Noto_Sans_TC_Black.otf'),
    out: path.join(APP_DIR, 'src', 'assets', 'fonts', 'NotoSansTC-Black-subset.woff2'),
    chars: hantChars,
  },
]

if (!existsSync(PYTHON_TOOLS)) {
  console.error(`缺少 fonttools：请先执行 python -m pip install --target "${PYTHON_TOOLS}" fonttools brotli`)
  process.exit(1)
}

for (const { font, out, chars } of subsets) {
  if (!existsSync(font)) {
    console.error(`源字体不存在：${font}（来自解包字体库，若工作区路径变化需改脚本里的 FONT_DIR）`)
    process.exit(1)
  }
  const all = new Set(chars)
  for (let code = 0x20; code <= 0x7e; code += 1) all.add(String.fromCharCode(code))
  for (const ch of '%【】·—…～') all.add(ch)

  const charsFile = path.join(tmpdir(), `nikke-card-font-chars-${path.basename(out)}.txt`)
  writeFileSync(charsFile, [...all].join(''))
  const result = spawnSync(
    'python',
    ['-m', 'fontTools.subset', font, `--text-file=${charsFile}`, `--output-file=${out}`, '--flavor=woff2'],
    { env: { ...process.env, PYTHONPATH: PYTHON_TOOLS }, stdio: 'inherit' },
  )
  if (result.status !== 0) process.exit(result.status ?? 1)
  console.log(`\n子集完成：${all.size} 个字符 → ${path.basename(out)}（${Math.round(statSync(out).size / 1024)} KB）`)
}