// 重建角色卡中文字体子集（游戏字体 Noto Sans SC Black → 精简 woff2）
// 何时需要跑：卡片的界面文案或角色名里出现了新汉字时（否则缺字会回退到系统字体，观感不一致）
// 用法：npm run fonts:card
// 依赖：项目内 .tools/fonttools（一次性安装：python -m pip install --target .tools/fonttools fonttools brotli）
// 源字体：解包字体库（外部路径）：D:\NIKKE备用工作区0923_tools\font_library\fonts\OTF\Noto_Sans_SC_Black.otf
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'

const APP_DIR = path.resolve(import.meta.dirname, '..')
const PROJECT_DIR = path.resolve(APP_DIR, '..')
const OUT_FONT = path.join(APP_DIR, 'src', 'assets', 'fonts', 'NotoSansSC-Black-subset.woff2')
const SOURCE_FONT = 'D:\\NIKKE备用工作区0923_tools\\font_library\\fonts\\OTF\\Noto_Sans_SC_Black.otf'
const PYTHON_TOOLS = path.join(PROJECT_DIR, '.tools', 'fonttools')

if (!existsSync(SOURCE_FONT)) {
  console.error(`源字体不存在：${SOURCE_FONT}`)
  console.error('（来自解包字体库，若工作区路径变化需改脚本里的 SOURCE_FONT）')
  process.exit(1)
}
if (!existsSync(PYTHON_TOOLS)) {
  console.error(`缺少 fonttools：请先执行 python -m pip install --target "${PYTHON_TOOLS}" fonttools brotli`)
  process.exit(1)
}

// 收集 src 下全部源码/数据里的汉字与标点（覆盖卡片文案 + roster 角色名等动态内容）
const chars = new Set()
const cjk = /[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef\u2018\u2019\u201c\u201d\u2026\u2014\u00b7]/g
const exts = new Set(['.js', '.jsx', '.css', '.json'])
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full)
    else if (exts.has(path.extname(entry.name))) {
      const found = readFileSync(full, 'utf8').match(cjk)
      if (found) for (const ch of found) chars.add(ch)
    }
  }
}
walk(path.join(APP_DIR, 'src'))
for (let code = 0x20; code <= 0x7e; code += 1) chars.add(String.fromCharCode(code))
for (const ch of '%【】·—…～') chars.add(ch)

const charsFile = path.join(tmpdir(), 'nikke-card-font-chars.txt')
writeFileSync(charsFile, [...chars].join(''))

const result = spawnSync(
  'python',
  ['-m', 'fontTools.subset', SOURCE_FONT, `--text-file=${charsFile}`, `--output-file=${OUT_FONT}`, '--flavor=woff2'],
  { env: { ...process.env, PYTHONPATH: PYTHON_TOOLS }, stdio: 'inherit' },
)
if (result.status !== 0) process.exit(result.status ?? 1)
console.log(`\n子集完成：${chars.size} 个字符 → ${OUT_FONT}（${Math.round(statSync(OUT_FONT).size / 1024)} KB）`)