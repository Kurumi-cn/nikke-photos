// 同步素材到 public/：
//   1) 角色表素材：头像 + 6 组分类图标（源：本机 NIKKE Helper 资源库）
//   2) 角色卡素材（M2）：立绘、卡片装饰、装备/魔方/技能图标等（源：NIKKE Workshop public/ui-assets）
// 源目录只读，只写入 app/public，可重复执行
// 用法：node scripts/sync-assets.mjs
import { access, cp, mkdir, readdir, copyFile, stat } from 'node:fs/promises'
import path from 'node:path'

const APP_DIR = path.resolve(import.meta.dirname, '..')

const SRC_AVATARS = process.env.NIKKE_AVATAR_DIR
  || 'E:/桌面/NIKKE Helper/NIKKE-LocalAssets/avatars'
const SRC_ICONS = process.env.NIKKE_ICON_DIR
  || 'E:/桌面/NIKKE Helper/NIKKE分类图标'
const SRC_WORKSHOP = process.env.NIKKE_WORKSHOP_ASSETS
  || 'E:/博哥/NIKKE WORKSHOP 1.0.14/NIKKE-Workshop-1.0.14/public/ui-assets/nikke'

const ICON_GROUPS = ['企业', '爆裂阶段', '武器', '稀有度', '属性', '职业']
const EQUIPMENT_ICON_GROUP = '装备'
const WORKSHOP_DIRS = ['character-card', 'cubes', 'equipment', 'metadata', 'objects', 'skill-icons', 'stats']
const EXPECTED_AVATARS = 201
const EXPECTED_ICONS = 26

const DEST_AVATARS = path.join(APP_DIR, 'public', 'avatars')
const DEST_ICONS = path.join(APP_DIR, 'public', 'icons')
const DEST_UI = path.join(APP_DIR, 'public', 'ui-assets', 'nikke')

const countFiles = async (dir) => {
  const entries = await readdir(dir, { withFileTypes: true })
  return entries.filter((entry) => entry.isFile()).length
}

const ensureDir = async (dir) => {
  try {
    await access(dir)
  } catch {
    throw new Error(`源目录不存在：${dir}`)
  }
}

await ensureDir(SRC_AVATARS)
await ensureDir(SRC_ICONS)

await mkdir(DEST_AVATARS, { recursive: true })
await cp(SRC_AVATARS, DEST_AVATARS, { recursive: true, force: true })
const avatarCount = await countFiles(DEST_AVATARS)

let iconTotal = 0
for (const group of ICON_GROUPS) {
  const from = path.join(SRC_ICONS, group)
  const to = path.join(DEST_ICONS, group)
  await ensureDir(from)
  await mkdir(to, { recursive: true })
  await cp(from, to, { recursive: true, force: true })
  const count = await countFiles(to)
  iconTotal += count
  console.log(`  分类图标 ${group}：${count} 张`)
}

console.log(`头像：${avatarCount} 张（预期 ${EXPECTED_AVATARS}）`)
console.log(`分类图标：${iconTotal} 张（预期 ${EXPECTED_ICONS}）`)
console.log(`输出目录：${path.relative(APP_DIR, DEST_AVATARS)}、${path.relative(APP_DIR, DEST_ICONS)}`)

if (avatarCount !== EXPECTED_AVATARS) {
  console.warn(`[警告] 头像数量与预期不一致：实际 ${avatarCount}，预期 ${EXPECTED_AVATARS}`)
}
if (iconTotal !== EXPECTED_ICONS) {
  console.warn(`[警告] 图标数量与预期不一致：实际 ${iconTotal}，预期 ${EXPECTED_ICONS}`)
}

// ---------- 角色卡素材（M2，源：NIKKE Workshop ui-assets） ----------

await ensureDir(SRC_WORKSHOP)

// 立绘：只取角色立绘与珍藏品背景，排除技能动画静态图（lobby_burst_*，约 44MB，卡片用不到）
const artworkSrc = path.join(SRC_WORKSHOP, 'character-artwork')
const artworkDest = path.join(DEST_UI, 'character-artwork')
await ensureDir(artworkSrc)
await mkdir(artworkDest, { recursive: true })
const artworkFiles = await readdir(artworkSrc, { withFileTypes: true })
let artworkCount = 0
let artworkSkipped = 0
for (const entry of artworkFiles) {
  if (!entry.isFile()) continue
  if (entry.name.startsWith('lobby_burst')) {
    artworkSkipped += 1
    continue
  }
  await copyFile(path.join(artworkSrc, entry.name), path.join(artworkDest, entry.name))
  artworkCount += 1
}
console.log(`立绘/珍藏品背景：${artworkCount} 张（跳过技能动画静态图 ${artworkSkipped} 张）`)

// 注：国服独占角色（画皮/婴宁）的立绘已由上面这一步从 character-artwork 同步（cn-exclusive-*.webp）。
// 早期曾额外从 Workshop 的 public/images/characters 补拷 cn-exclusive-*，
// 但那里放的是半身像 .png 和 -thumb.png（头图），并非立绘，且文件名与角色表引用撞车，
// 会让卡片把半身像当立绘渲染，故不再拷贝。

const countFilesDeep = async (dir) => {
  const entries = await readdir(dir, { withFileTypes: true })
  let total = 0
  for (const entry of entries) {
    total += entry.isDirectory()
      ? await countFilesDeep(path.join(dir, entry.name))
      : 1
  }
  return total
}

for (const dir of WORKSHOP_DIRS) {
  const from = path.join(SRC_WORKSHOP, dir)
  const to = path.join(DEST_UI, dir)
  await ensureDir(from)
  await mkdir(to, { recursive: true })
  await cp(from, to, { recursive: true, force: true })
  console.log(`卡片素材 ${dir}：${await countFilesDeep(to)} 个文件`)
}

const uiTotalSize = (await Promise.all(
  WORKSHOP_DIRS.map(async (dir) => {
    const walk = async (target) => {
      const entries = await readdir(target, { withFileTypes: true })
      let sum = 0
      for (const entry of entries) {
        const full = path.join(target, entry.name)
        sum += entry.isDirectory() ? await walk(full) : (await stat(full)).size
      }
      return sum
    }
    return walk(path.join(DEST_UI, dir))
  }),
)).reduce((sum, size) => sum + size, 0)
console.log(`卡片素材合计：${(uiTotalSize / 1024 / 1024).toFixed(1)} MB → ${path.relative(APP_DIR, DEST_UI)}`)

// ---------- OCR 模板（M3，源：NIKKE Workshop public/ocr） ----------
// 词条名模板 18 + 数字字模 36 + 每档数值模板 135 + 档位数值表 9 + 图标模板 31
const ocrSrc = path.join(SRC_WORKSHOP, '..', '..', 'ocr')
const ocrDest = path.join(APP_DIR, 'public', 'ocr')
await ensureDir(ocrSrc)
await mkdir(ocrDest, { recursive: true })
await cp(ocrSrc, ocrDest, { recursive: true, force: true })
console.log(`OCR 模板：${await countFilesDeep(ocrDest)} 个文件 → ${path.relative(APP_DIR, ocrDest)}`)