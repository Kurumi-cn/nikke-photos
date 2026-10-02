// 生成 src/data/cubes.json：从 NIKKE Workshop 的 cubeIconCatalog.js 提取魔方目录
// （只提取 cubeId / resourceId / 名称，图标统一用 ui-assets/nikke/cubes/ie_{resourceId}.png）
// 用法：node scripts/build-cubes.mjs [--check]
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const SOURCE_FILE = process.env.NIKKE_CUBE_CATALOG
  || 'E:/博哥/NIKKE WORKSHOP 1.0.14/NIKKE-Workshop-1.0.14/src/domain/cubeIconCatalog.js'

const APP_DIR = path.resolve(import.meta.dirname, '..')
const PUBLIC_DIR = path.join(APP_DIR, 'public')
const UI_ROOT = 'ui-assets/nikke'
const OUTPUT = path.join(APP_DIR, 'src', 'data', 'cubes.json')
const CHECK_ONLY = process.argv.includes('--check')

const exists = async (target) => {
  try {
    await access(target)
    return true
  } catch {
    return false
  }
}

const text = await readFile(SOURCE_FILE, 'utf8')
const entryPattern = /\{\s*cubeId:\s*(\d+),\s*resourceId:\s*(\d+),\s*nameCn:\s*"([^"]+)",\s*nameEn:\s*"([^"]+)"/g
const entries = [...text.matchAll(entryPattern)].map((match) => ({
  cubeId: Number(match[1]),
  resourceId: Number(match[2]),
  nameCn: match[3],
  nameEn: match[4],
  icon: `${UI_ROOT}/cubes/ie_${match[2]}.png`,
}))

const errors = []
const warnings = []
if (entries.length !== 17) errors.push(`魔方条目数异常：${entries.length}（预期 17）`)
for (const entry of entries) {
  if (!(await exists(path.join(PUBLIC_DIR, entry.icon)))) {
    warnings.push(`魔方图标缺失：${entry.icon}（${entry.nameCn}，执行 npm run assets:sync 同步）`)
  }
}

if (!CHECK_ONLY) {
  await mkdir(path.dirname(OUTPUT), { recursive: true })
  await writeFile(OUTPUT, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    source: 'NIKKE Workshop cubeIconCatalog.js',
    count: entries.length,
    cubes: entries,
  }, null, 2)}\n`, 'utf8')
}

console.log(`魔方：${entries.length} 条`)
console.log(`错误：${errors.length} 条，警告：${warnings.length} 条`)
for (const item of errors) console.error(`  [错误] ${item}`)
for (const item of warnings) console.warn(`  [警告] ${item}`)
console.log(CHECK_ONLY ? '校验完成（--check，未写产物）' : `产物：${path.relative(APP_DIR, OUTPUT)}`)

if (errors.length > 0) process.exitCode = 1