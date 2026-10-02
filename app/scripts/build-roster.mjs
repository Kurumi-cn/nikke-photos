// 生成 src/data/roster.json：把 NIKKE Helper 的（名单 + 分类 + 头像立绘 + 国服名单 + 标签）
// 合并为单一角色表，并做完整性校验；数据源只读，产物可重复生成
// 用法：node scripts/build-roster.mjs [--check]（--check 只校验不写产物）
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pinyin } from 'pinyin-pro'

const SOURCE_DIR = process.env.NIKKE_SOURCE_DIR
  || 'E:/桌面/NIKKE Helper/NIKKE Helper v1.0/src/renderer/src/data'

// Workshop 珍藏品名单（按资源号 cNNN），作为“拥有珍藏品”的全集来源
const WORKSHOP_OBJECTS_PATH = process.env.NIKKE_WORKSHOP_OBJECTS
  || 'E:/博哥/NIKKE WORKSHOP 1.0.14/NIKKE-Workshop-1.0.14/src/data/characterObjectAssets.json'

// Workshop 技能图标目录（按资源号 → skill1/skill2/burst 文件名）
const WORKSHOP_SKILL_CATALOG = process.env.NIKKE_SKILL_ICON_CATALOG
  || 'E:/博哥/NIKKE WORKSHOP 1.0.14/NIKKE-Workshop-1.0.14/src/data/characterSkillIconCatalog.json'

// 卡片素材在 public 下的根目录（与 Workshop 保持同一相对结构，便于对照）
const UI_ROOT = 'ui-assets/nikke'

const SCRIPT_DIR = import.meta.dirname
const APP_DIR = path.resolve(SCRIPT_DIR, '..')
const PUBLIC_DIR = path.join(APP_DIR, 'public')
const ARTWORK_DIR = path.join(PUBLIC_DIR, UI_ROOT, 'character-artwork')
const ROSTER_PATH = path.join(APP_DIR, 'src', 'data', 'roster.json')
const REPORT_PATH = path.join(SCRIPT_DIR, 'roster-report.json')

const CHECK_ONLY = process.argv.includes('--check')

// 分类定义：选项与中文标签照抄 NIKKE Helper（characterModel.js），图标来自 NIKKE分类图标 目录
const FILTER_DEFS = [
  {
    key: 'corporation',
    label: '企业',
    dir: '企业',
    options: [
      ['ELYSION', '极乐净土'],
      ['MISSILIS', '米西利斯'],
      ['TETRA', '泰特拉'],
      ['PILGRIM', '朝圣者'],
      ['ABNORMAL', '反常'],
    ],
  },
  {
    key: 'use_burst_skill',
    label: '爆裂阶段',
    dir: '爆裂阶段',
    options: [
      ['Step1', '一阶'],
      ['Step2', '二阶'],
      ['Step3', '三阶'],
      ['AllStep', '通用'],
    ],
  },
  {
    key: 'weapon_type',
    label: '武器',
    dir: '武器',
    options: [
      ['AR', '步枪'],
      ['MG', '机枪'],
      ['RL', '发射器'],
      ['SG', '霰弹枪'],
      ['SMG', '冲锋枪'],
      ['SR', '狙击枪'],
    ],
  },
  {
    key: 'original_rare',
    label: '稀有度',
    dir: '稀有度',
    options: [
      ['SSR', 'SSR'],
      ['SR', 'SR'],
      ['R', 'R'],
    ],
  },
  {
    key: 'element',
    label: '属性',
    dir: '属性',
    options: [
      ['Fire', '燃烧'],
      ['Water', '水冷'],
      ['Wind', '风压'],
      ['Electronic', '电击'],
      ['Iron', '铁甲'],
    ],
  },
  {
    key: 'class',
    label: '职业',
    dir: '职业',
    options: [
      ['Attacker', '火力型'],
      ['Defender', '防御型'],
      ['Supporter', '辅助型'],
    ],
  },
]

const readJson = async (name) =>
  JSON.parse(await readFile(path.join(SOURCE_DIR, name), 'utf8'))

const readJsonPath = async (target) => JSON.parse(await readFile(target, 'utf8'))

const exists = async (target) => {
  try {
    await access(target)
    return true
  } catch {
    return false
  }
}

const pinyinInitials = (text) =>
  pinyin(text, { pattern: 'first', toneType: 'none', type: 'array' })
    .join('')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')

const [assetsFile, directoryFile, cnFile, tagsFile, workshopObjects, skillIconCatalog] = await Promise.all([
  readJson('character-assets.json'),
  readJson('nikke-directory.json'),
  readJson('cn-roster.json'),
  readJson('tags.json'),
  readJsonPath(WORKSHOP_OBJECTS_PATH),
  readJsonPath(WORKSHOP_SKILL_CATALOG),
])

/** 技能图标：按资源号取 skill1/skill2/burst 三个文件名，转成 public 相对路径 */
const buildSkillIcons = (resourceId) => {
  const entry = skillIconCatalog[String(resourceId ?? '').trim()]
  if (!entry) return null
  const toPath = (file) => (file ? `${UI_ROOT}/skill-icons/${file}` : null)
  return { skill1: toPath(entry.skill1), skill2: toPath(entry.skill2), burst: toPath(entry.burst) }
}

const dirByCode = new Map(directoryFile.map((item) => [String(item.name_code), item]))
const cnSet = new Set(cnFile.cnRoster.map(String))
// collectibleCn：国服已实装珍藏品（NIKKE Helper 标记，12 人）
const collectibleSet = new Set(tagsFile.collectible.map(String))
const helperCollectiblePool = new Set(tagsFile.collectiblePool.map(String))
const overSpecSet = new Set(tagsFile.overSpec.map(String))
// 珍藏品全集：Workshop 名单（21 人），key 形如 c030，按资源号归一
const favoriteKeyByResourceId = new Map(
  Object.keys(workshopObjects.favorites || {})
    .map((key) => [String(Number(key.slice(1))), key]),
)

const errors = []
const warnings = []

// 校验分类选项与图标是否齐备
const optionSetByKey = new Map()
for (const def of FILTER_DEFS) {
  const set = new Set(def.options.map(([value]) => value))
  optionSetByKey.set(def.key, set)
  for (const [, label] of def.options) {
    const iconPath = path.join(PUBLIC_DIR, 'icons', def.dir, `${label}.webp`)
    if (!(await exists(iconPath))) {
      errors.push(`分类图标缺失：icons/${def.dir}/${label}.webp（请先执行 npm run assets:sync）`)
    }
  }
}

const seenCodes = new Set()
const characters = []
let artworkTotal = 0

for (const asset of assetsFile.characters) {
  const code = String(asset.name_code)
  if (seenCodes.has(code)) {
    errors.push(`重复的 name_code：${code}`)
    continue
  }
  seenCodes.add(code)

  const directory = dirByCode.get(code)
  if (!directory) {
    warnings.push(`nikke-directory.json 中缺少该角色：${code} ${asset.name_cn}`)
  }

  const baseName = asset.name_cn || ''
  const displayName = cnFile.displayNames?.[code] || baseName
  const aliasSet = new Set()
  if (baseName && baseName !== displayName) aliasSet.add(baseName)

  const initials = new Set([pinyinInitials(displayName)])
  if (baseName && baseName !== displayName) initials.add(pinyinInitials(baseName))

  // 珍藏品全集按资源号匹配（Workshop 的 favorites key 形如 c030）
  const favoriteKey = favoriteKeyByResourceId.get(
    String(asset.resource_id ?? directory?.resource_id ?? ''),
  ) || null

  // 立绘文件名：正常情况下就是源数据里的 basename（形如 c090.webp）。
  // 但国服独占两个角色（画皮/婴宁）源数据写的是 images/characters 下的半身像 .png，
  // 立绘目录里根本没有同名文件；此时退回本项目统一约定 character-artwork/<nameCode>.webp。
  // 只有在回退文件确实存在时才替换，避免素材未同步时把所有角色名写错。
  const resolveArtworkFile = async (rawFile) => {
    const raw = path.basename(rawFile || '')
    if (!raw || (await exists(path.join(ARTWORK_DIR, raw)))) return raw
    const alt = `${code}.webp`
    return (await exists(path.join(ARTWORK_DIR, alt))) ? alt : raw
  }
  const artworks = []
  for (const artwork of asset.artworks || []) {
    artworks.push({
      id: artwork.id,
      label: artwork.label,
      file: await resolveArtworkFile(artwork.file),
    })
  }

  const record = {
    nameCode: code,
    resourceId: String(asset.resource_id ?? directory?.resource_id ?? ''),
    nameCn: displayName,
    nameEn: asset.name_en || '',
    aliases: [...aliasSet],
    pinyin: [...initials].filter(Boolean).join(' '),
    avatar: asset.avatar || '',
    artworks,
    skillIcons: buildSkillIcons(asset.resource_id ?? directory?.resource_id),
    class: directory?.class ?? null,
    element: directory?.element ?? null,
    use_burst_skill: directory?.use_burst_skill ?? null,
    corporation: directory?.corporation ?? null,
    weapon_type: directory?.weapon_type ?? null,
    original_rare: directory?.original_rare ?? null,
    chinaExclusive: Boolean(asset.china_exclusive),
    cnAvailable: cnSet.has(code),
    collectible: Boolean(favoriteKey),
    collectibleCn: collectibleSet.has(code),
    favoriteItem: favoriteKey
      ? {
        resourceKey: favoriteKey,
        icon: `${UI_ROOT}/character-card/favorite-items/${favoriteKey}.png`,
        background: `${UI_ROOT}/character-artwork/favorite_${favoriteKey}.webp`,
      }
      : null,
    overSpec: overSpecSet.has(code),
  }

  // 必要字段校验
  if (!record.nameCn) errors.push(`缺少中文名：${code}`)
  if (!record.avatar) {
    errors.push(`缺少头像路径：${code} ${record.nameCn}`)
  } else if (!(await exists(path.join(PUBLIC_DIR, record.avatar)))) {
    errors.push(`头像文件不存在：${record.avatar}（${code} ${record.nameCn}，请先执行 npm run assets:sync）`)
  }
  for (const def of FILTER_DEFS) {
    const value = record[def.key]
    if (!value) {
      errors.push(`分类字段为空：${def.key}（${code} ${record.nameCn}）`)
    } else if (!optionSetByKey.get(def.key).has(value)) {
      errors.push(`分类值未登记：${def.key}=${value}（${code} ${record.nameCn}）`)
    }
  }
  if (!record.artworks.length) warnings.push(`无立绘记录：${code} ${record.nameCn}`)

  // 卡片素材（M2）是否存在：素材缺失只告警，不阻塞角色表生成
  const defaultArtwork = record.artworks.find((artwork) => artwork.id === 'default') || record.artworks[0]
  if (defaultArtwork?.file && !(await exists(path.join(ARTWORK_DIR, defaultArtwork.file)))) {
    warnings.push(`立绘文件缺失：${defaultArtwork.file}（${code} ${record.nameCn}，执行 npm run assets:sync 同步）`)
  }
  if (record.favoriteItem && !(await exists(path.join(PUBLIC_DIR, record.favoriteItem.icon)))) {
    warnings.push(`珍藏品图标缺失：${record.favoriteItem.icon}（${code} ${record.nameCn}）`)
  }
  for (const [skillKey, skillPath] of Object.entries(record.skillIcons || {})) {
    if (skillPath && !(await exists(path.join(PUBLIC_DIR, skillPath)))) {
      warnings.push(`技能图标缺失：${skillPath}（${code} ${record.nameCn} ${skillKey}）`)
    }
  }

  artworkTotal += record.artworks.length
  characters.push(record)
}

// 交叉校验：国服名单 / 标签名单里的角色必须在角色表内
for (const code of cnSet) {
  if (!seenCodes.has(code)) errors.push(`国服名单中的角色不在角色表内：${code}`)
}
for (const code of collectibleSet) {
  if (!seenCodes.has(code)) warnings.push(`国服珍藏品名单中的角色不在角色表内：${code}`)
}
// 珍藏品全集（Workshop）与国服子集（NIKKE Helper）的交叉校验
const favoriteCodes = new Set(characters.filter((item) => item.collectible).map((item) => item.nameCode))
for (const record of characters) {
  if (record.collectibleCn && !record.collectible) {
    errors.push(`国服珍藏品不在珍藏品全集内：${record.nameCode} ${record.nameCn}`)
  }
}
for (const [resourceId, key] of favoriteKeyByResourceId) {
  if (!characters.some((item) => item.resourceId === resourceId)) {
    errors.push(`Workshop 珍藏品 ${key} 未匹配到角色：resource_id=${resourceId}`)
  }
}
const poolMissing = [...helperCollectiblePool].filter((code) => !favoriteCodes.has(code))
const poolExtra = [...favoriteCodes].filter((code) => !helperCollectiblePool.has(code))
if (poolMissing.length) {
  warnings.push(`珍藏品全集比 Helper collectiblePool 少：${poolMissing.join(',')}`)
}
if (poolExtra.length) {
  warnings.push(`珍藏品全集比 Helper collectiblePool 多：${poolExtra.join(',')}`)
}
for (const code of overSpecSet) {
  if (!seenCodes.has(code)) warnings.push(`超标准名单中的角色不在角色表内：${code}`)
}
for (const item of directoryFile) {
  const code = String(item.name_code)
  if (!seenCodes.has(code)) warnings.push(`目录中有角色未进入角色表：${code} ${item.name_cn}`)
}

const counts = {
  characters: characters.length,
  cnAvailable: characters.filter((item) => item.cnAvailable).length,
  collectible: characters.filter((item) => item.collectible).length,
  collectibleCn: characters.filter((item) => item.collectibleCn).length,
  overSpec: characters.filter((item) => item.overSpec).length,
  chinaExclusive: characters.filter((item) => item.chinaExclusive).length,
  artworks: artworkTotal,
}

const taxonomy = {
  filters: FILTER_DEFS.map((def) => ({
    key: def.key,
    label: def.label,
    options: def.options.map(([value, label]) => ({
      value,
      label,
      icon: `icons/${def.dir}/${label}.webp`,
    })),
  })),
}

const report = {
  generatedAt: new Date().toISOString(),
  sourceDir: SOURCE_DIR,
  workshopObjectsPath: WORKSHOP_OBJECTS_PATH,
  sourceGeneratedAt: assetsFile.generatedAt || null,
  counts,
  expectedCnRoster: cnFile.count ?? null,
  errors,
  warnings,
}

await mkdir(path.dirname(REPORT_PATH), { recursive: true })
await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

if (!CHECK_ONLY) {
  const payload = {
    revision: new Date().toISOString().slice(0, 10),
    generatedAt: report.generatedAt,
    sources: {
      roster: 'NIKKE Helper character-assets.json',
      directory: 'NIKKE Helper nikke-directory.json',
      cnRoster: 'NIKKE Helper cn-roster.json',
      tags: 'NIKKE Helper tags.json',
      favoriteItemPool: 'NIKKE Workshop characterObjectAssets.json（favorites）',
      sourceDir: SOURCE_DIR,
      workshopObjectsPath: WORKSHOP_OBJECTS_PATH,
      sourceGeneratedAt: assetsFile.generatedAt || null,
    },
    counts,
    taxonomy,
    characters,
  }
  await mkdir(path.dirname(ROSTER_PATH), { recursive: true })
  await writeFile(ROSTER_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}

console.log(`角色：${counts.characters}（国服 ${counts.cnAvailable} / 珍藏品 ${counts.collectible}（国服已实装 ${counts.collectibleCn}）/ 超标准 ${counts.overSpec} / 国服独占 ${counts.chinaExclusive}）`)
console.log(`立绘记录：${counts.artworks} 张（来源字段，素材本体在 M2 接入）`)
console.log(`错误：${errors.length} 条，警告：${warnings.length} 条`)
for (const item of errors) console.error(`  [错误] ${item}`)
for (const item of warnings) console.warn(`  [警告] ${item}`)
console.log(CHECK_ONLY ? '校验完成（--check，未写产物）' : `产物：${path.relative(APP_DIR, ROSTER_PATH)}`)
console.log(`报告：${path.relative(APP_DIR, REPORT_PATH)}`)

if (errors.length > 0) process.exitCode = 1