// NKP2 分享码（变体 A4：二进制位打包 + 载荷类型）
//
// 设计目标：把网页端的练度数据编码成尽量短、可粘贴给 QQ BOT 的字符串。
// 做法：所有数值先位打包成一条紧凑字节流，再整体 base64url；不做 gzip
// （位打包后无冗余可压，实测反而变大）。
//
// ── 与 A3 的差别（A3 已废弃，不兼容，不做旧码兼容）──────────────────────
//   1. 版本 0.1 → 0.2（线上值 1 → 2）
//   2. 版本号后插入 1 字节「载荷类型」，同一条命令就能自动分派：
//        0 = 角色数据（1~10 个角色，装备词条必选，其余 7 项可勾）
//        1 = 表格显示配置（只带角色名单与行序，不带任何练度数据）
//   3. 角色 id 由「nameCode − 5000」的 9 bit 改成 **13 bit 直接写 nameCode**。
//      旧算法对 nameCode < 5000 的角色（拉毗 3001、尼恩 3002 等，共 35 个，
//      含起手队）直接抛错，等于练度根本分享不出去。
//   4. 「条目数」提到类型之后统一位置（角色数 / 行数）
//
// ── 字节流结构（多字节一律大端、位序 MSB-first）─────────────────────────
//   版本        2 字节   uint16 = 主版本×100 + 次版本（0.2 → 2）
//   载荷类型    1 字节   0 = 角色数据；1 = 表格配置
//   条目数      1 字节   类型 0：角色数 [1,10]；类型 1：行数 [1,255]
//   ── 类型 0（角色数据）──
//     字段掩码  1 字节   8 位对应 SHARE_FIELDS[].bit
//     同步器等级 2 字节  [1, 2000]
//     [研究等级] 8 × 10 bit（仅掩码含 research 时存在：先企业 5 个，后职业 3 个）
//     角色记录  × 角色数（每个角色按下方固定顺序写，掩码只决定字段写不写）
//   ── 类型 1（表格配置）──
//     角色 id   13 bit × 行数（顺序即表格行序）
//   CRC32       4 字节   覆盖前面全部字节
//
// ── 角色 id（13 bit）──────────────────────────────────────────────────
//   直接写 nameCode 原值，取值 0~8189；8190/8191 留给两个国服独占角色
//   （cn-exclusive-huapi 画皮 / cn-exclusive-yingning 婴宁，它们没有数字 id）。
//   13 bit 够到 8191，当前角色表最大 nameCode 是 5180，余量充足。
//   不做映射表：以后新增角色（nameCode 落在 5000+ 段）自动可用，不用改协议。
//
// ── 每个角色的字段（固定顺序写入；位宽 / 取值 / 缺值哨兵）──────────────────
//   顺序：id → limitBreak → affection → combat → skills → cube → favorite → equipments
//   星级         3 bit   [0,3]        哨兵 7      （对应 App 的「突破（星）」）
//   突破(核心)   4 bit   [0,7]        哨兵 15     （对应 App 的「核心」）
//   好感度       6 bit   [0,40]       哨兵 41
//   战斗力       22 bit  [1,4000000]  哨兵 0
//   技能 ×3      4 bit   [1,10]       哨兵 0
//   魔方类型     5 bit   [1,17]       哨兵 0 = 无魔方
//   魔方等级     4 bit   [1,15]       0 = 无
//   收藏品类型   5 bit   [1,23]       哨兵 0 = 无收藏品；1=R，2=SR，3-23=珍藏品
//   收藏品等级   4 bit   R/SR 用 [1,15]；珍藏品只用 [1,3]；0 = 无
//   装备词条     8 bit×12  类型 4 bit（0 = 空行，1-9 为词条类型）+ 档位 4 bit（0 = 空）
//   哨兵值一律落在各自合法区间之外，否则「满级」会被解成「无数据」
//
// ── 冻结字典（重要）─────────────────────────────────────────────────────
//   下面 AFFIX_TYPES / CUBE_IDS / FAVORITE_KEYS 三张表的顺序**已写死**：
//   只能往后追加，绝不重排、绝不删除。否则历史分享码会解成别的道具。
//   魔方 resourceId 不连续（10001…10013 之间夹着 11001/12001/13001），所以必须显式列出。
//
// ── 未导出字段 ─────────────────────────────────────────────────────────
//   掩码里没开的字段，BOT 端按 SHARE_DEFAULTS 填默认值（App 侧也会提示用户）。
import { AFFIX_TIER_VALUES } from '../data/affixTiers.js'
import { FIELD_RANGES } from './fieldRanges.js'
import { t, tData } from './i18n.js'
import { DEFAULT_SYNCHRO_LEVEL, RESEARCH_CLASSES, RESEARCH_CORPORATIONS } from './profileStore.js'

/** 单次分享的角色上限（协议侧写死，UI 与校验共用） */
export const SHARE_MAX_COUNT = 10

/** 表格配置单次最多多少行（受 1 字节条目数限制） */
export const TABLE_MAX_COUNT = 255

/** 载荷类型：同一条导入命令靠它自动分派 */
export const PAYLOAD_CHARACTERS = 0
export const PAYLOAD_TABLE = 1

/** 协议版本：主版本×100 + 次版本 */
export const SHARE_VERSION = 2
export const SHARE_VERSION_TEXT = '0.2'

/** 冻结字典：词条类型（序号 0-8，线上写序号+1，0 保留给空行） */
export const AFFIX_TYPES = [
  'IncElementDmg', 'StatAtk', 'StatAmmoLoad', 'StatChargeTime', 'StatChargeDamage',
  'StatCritical', 'StatCriticalDamage', 'StatAccuracyCircle', 'StatDef',
]

/** 冻结字典：魔方（序号 0-16，线上写序号+1，0 保留给「无魔方」） */
export const CUBE_IDS = [
  10001, 10002, 10003, 10004, 10005, 10006, 11001, 13001, 12001,
  13002, 12002, 10009, 10007, 10008, 10010, 10012, 10013,
]

/** 冻结字典：珍藏品（序号 0-20，线上写序号+3，0/1/2 留给 无/R/SR） */
export const FAVORITE_KEYS = [
  'c030', 'c032', 'c072', 'c080', 'c100', 'c101', 'c112', 'c140', 'c141', 'c142', 'c150',
  'c170', 'c192', 'c210', 'c280', 'c281', 'c352', 'c390', 'c411', 'c550', 'c580',
]

/** 收藏品类型序号：0 = 无，1 = R，2 = SR，3 起为 FAVORITE_KEYS 的珍藏品 */
export const FAVORITE_TYPE_R = 1
export const FAVORITE_TYPE_SR = 2
const FAVORITE_TYPE_BASE = 3

/** 可导出字段：数组顺序即掩码位序，也是界面上勾选项的顺序
 *  label 用 getter：繁体模式下取到字形映射后的名词（读取时才求值，别把语言钉死在模块加载时） */
const shareField = (key, bit, label, extra = {}) => ({ key, bit, get label() { return tData(label) }, ...extra })

export const SHARE_FIELDS = [
  shareField('equip', 0, '装备词条', { locked: true }),
  shareField('research', 1, '研究等级'),
  shareField('skills', 2, '技能等级'),
  shareField('cube', 3, '魔方'),
  shareField('favorite', 4, '收藏品'),
  shareField('limitBreak', 5, '星级 / 突破'),
  shareField('affection', 6, '好感度'),
  shareField('combat', 7, '战斗力'),
]
export const ALL_SHARE_FIELDS = SHARE_FIELDS.map((field) => field.key)
/** 默认只勾装备词条 */
export const DEFAULT_SHARE_FIELDS = ['equip']

/** 未导出字段的默认值：BOT 端照此填充，App 首次进入导出页时也会展示给用户 */
export const SHARE_DEFAULTS = [
  ['星级', '3'],
  ['突破（核心）', '7'],
  ['好感度', '30'],
  ['战斗力', '114514'],
  ['技能 1 / 2 / 爆裂', '10 / 10 / 10'],
  ['魔方类型', '遗迹巨熊魔方'],
  ['魔方等级', '15'],
  ['收藏品类型', 'SR'],
  ['收藏品等级', '15'],
  ['企业研究等级', '200'],
  ['职业研究等级', '200'],
]

/** 研究等级在字节流里的顺序：先企业 5 个，后职业 3 个 */
const WIRE_RESEARCH = [
  ...RESEARCH_CORPORATIONS.map((key) => ['corporation', key]),
  ...RESEARCH_CLASSES.map((key) => ['class', key]),
]

// 角色 id：13 bit 直接写 nameCode；最后两个值留给没有数字 id 的国服独占角色
const WIRE_ID_MAX = 8189
const CHAR_ID_SENTINELS = { 'cn-exclusive-huapi': 8190, 'cn-exclusive-yingning': 8191 }
const SENTINEL_CHAR_IDS = { 8190: 'cn-exclusive-huapi', 8191: 'cn-exclusive-yingning' }

const W = {
  id: 13,
  // 星级取值 [0,3] 只需 2 bit，但缺值哨兵 7 必须装得下，故给 3 bit
  // 核心取值 [0,7] 刚好占满 3 bit，哨兵必须落在区间外，故给 4 bit（哨兵 15）
  grade: 3, core: 4, affection: 6, combat: 22,
  skill: 4, cubeType: 5, cubeLevel: 4, favoriteType: 5, favoriteLevel: 4,
  affixType: 4, affixTier: 4, research: 10,
}
// 哨兵值一律落在各自取值区间之外，否则「满级」会被解成「无数据」
const SENTINEL = { grade: 7, core: 15, affection: 41 }

const CODE_RE = /^NKP2:([A-Za-z0-9\-_]+)$/

// ⚠️ 空值必须判成 null，不能直接 Number()：Number(null) === 0、Number('') === 0，
// 而 pick() 看到范围内（比如星级 0~3）的 0 就会当成「真实值 0」，
// 于是「没填星级」会被导出成「0 星」，BOT 那边也不再套用默认值。
// 判定条件与 cardModel.js 的 toNumber() 保持一致。
const toInt = (value) => {
  if (value === null || value === undefined || typeof value === 'boolean' || String(value).trim() === '') {
    return null
  }
  const number = Number(value)
  return Number.isFinite(number) ? Math.trunc(number) : null
}
/** 取范围内的整数值；空值或越界一律返回哨兵（避免把越界值静默改成边界值） */
const pick = (value, min, max, sentinel) => {
  const number = toInt(value)
  return number !== null && number >= min && number <= max ? number : sentinel
}

/** 按范围真源（fieldRanges.js）取范围后再 pick —— 本文件不再出现范围字面量 */
const pickField = (value, key, sentinel) => {
  const range = FIELD_RANGES[key]
  return pick(value, range.min, range.max, sentinel)
}

// 哨兵值必须落在各自范围**之外**，否则「真实值」和「无数据」会撞成同一个码。
// 这类事故在本项目发生过两次（星级 7 被 2 bit 截成 3；核心满级 7 撞上哨兵 7），
// 所以这里改为启动时断言：范围已经集中到真源，漂了就立刻报错而不是等线上解错。
{
  const sentinels = {
    grade: SENTINEL.grade,
    core: SENTINEL.core,
    affection: SENTINEL.affection,
    // 其余字段的「无数据」码统一用 0，而它们的 min 都是 1
    combat: 0,
    skill: 0,
    cubeLevel: 0,
    favoriteLevel: 0,
    favoriteLevelSsr: 0,
    affixTier: 0,
  }
  for (const [key, sentinel] of Object.entries(sentinels)) {
    const range = FIELD_RANGES[key]
    if (sentinel >= range.min && sentinel <= range.max) {
      throw new Error(`哨兵 ${key}=${sentinel} 落在合法范围 ${range.min}-${range.max} 内，会把真实值解成「无数据」`)
    }
  }
}

// ---- 位读写（MSB-first） ----
class BitWriter {
  constructor() { this.bytes = []; this.cur = 0; this.n = 0 }

  write(value, width) {
    // 位宽断言：哨兵值必须装得进字段，否则会被静默截断成另一个合法值（例如 7 装进 2 bit 变成 3）
    if (!Number.isInteger(value) || value < 0 || value >= 1 << width) {
      throw new Error(`位宽不足：值 ${value} 无法写入 ${width} bit`)
    }
    for (let i = width - 1; i >= 0; i--) {
      this.cur = (this.cur << 1) | ((value >> i) & 1)
      if (++this.n === 8) {
        this.bytes.push(this.cur)
        this.cur = 0
        this.n = 0
      }
    }
  }

  /** 补齐到字节边界并输出 */
  finish() {
    if (this.n > 0) {
      this.bytes.push(this.cur << (8 - this.n))
      this.cur = 0
      this.n = 0
    }
    return Uint8Array.from(this.bytes)
  }
}

class BitReader {
  constructor(bytes) { this.bytes = bytes; this.pos = 0 }

  read(width) {
    let value = 0
    for (let i = 0; i < width; i++) {
      const byte = this.bytes[this.pos >> 3]
      if (byte === undefined) throw new Error(t('分享码内容不完整'))
      value = (value << 1) | ((byte >> (7 - (this.pos & 7))) & 1)
      this.pos++
    }
    return value
  }
}

// ---- CRC32（校验复制 / 粘贴损坏） ----
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let value = i
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    table[i] = value >>> 0
  }
  return table
})()

function crc32(bytes) {
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

// ---- base64url ----
function bytesToB64url(bytes) {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlToBytes(text) {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** 补 CRC 并整体 base64url */
function seal(bw) {
  const body = bw.finish()
  const payload = new Uint8Array(body.length + 4)
  payload.set(body, 0)
  new DataView(payload.buffer).setUint32(body.length, crc32(body), false)
  return `NKP2:${bytesToB64url(payload)}`
}

/** 拆码、验 CRC，返回去掉 CRC 的字节流 */
function open(text) {
  const matched = CODE_RE.exec(String(text || '').trim())
  if (!matched) throw new Error(t('分享码格式不正确'))
  const payload = b64urlToBytes(matched[1])
  if (payload.length < 8) throw new Error(t('分享码内容不完整'))
  const body = payload.subarray(0, payload.length - 4)
  const view = new DataView(payload.buffer, payload.byteOffset + body.length, 4)
  if (crc32(body) !== view.getUint32(0, false)) throw new Error(t('分享码已损坏，请重新复制'))
  return body
}

// ---- 角色 id ----
const toWireId = (nameCode) => {
  const code = String(nameCode)
  if (/^\d+$/.test(code)) {
    const id = Number(code)
    if (id > WIRE_ID_MAX) throw new Error(`角色号超出协议范围：${code}`)
    return id
  }
  const sentinel = CHAR_ID_SENTINELS[code]
  if (sentinel === undefined) throw new Error(`未收录的角色键：${code}`)
  return sentinel
}

const fromWireId = (id) => (SENTINEL_CHAR_IDS[id] ?? String(id))

// ---- 单角色写入 ----
function writeCharacter(bw, nameCode, record, has) {
  const data = record || {}
  bw.write(toWireId(nameCode), W.id)

  if (has('limitBreak')) {
    bw.write(pickField(data.limitBreak?.grade, 'grade', SENTINEL.grade), W.grade)
    bw.write(pickField(data.limitBreak?.core, 'core', SENTINEL.core), W.core)
  }
  if (has('affection')) {
    bw.write(pickField(data.affection, 'affection', SENTINEL.affection), W.affection)
  }
  if (has('combat')) {
    bw.write(pickField(data.combat, 'combat', 0), W.combat)
  }
  if (has('skills')) {
    const skills = data.skills || {}
    for (const key of ['skill1', 'skill2', 'burst']) bw.write(pickField(skills[key], 'skill', 0), W.skill)
  }
  if (has('cube')) {
    const index = CUBE_IDS.indexOf(toInt(data.cube?.resourceId))
    bw.write(index >= 0 ? index + 1 : 0, W.cubeType)
    bw.write(index >= 0 ? pickField(data.cube?.level, 'cubeLevel', 0) : 0, W.cubeLevel)
  }
  if (has('favorite')) {
    const favorite = data.favoriteItem || {}
    const rarity = String(favorite.rarity || '').toUpperCase()
    let type = 0
    let level = 0
    if (rarity === 'R' || rarity === 'SR') {
      type = rarity === 'R' ? FAVORITE_TYPE_R : FAVORITE_TYPE_SR
      level = pickField(favorite.level, 'favoriteLevel', 0)
    } else if (rarity === 'SSR') {
      const index = FAVORITE_KEYS.indexOf(String(favorite.resourceKey || ''))
      if (index >= 0) {
        type = FAVORITE_TYPE_BASE + index
        // 珍藏品等级在 App 内部存 0-2（界面显示 1-3），线上统一传界面值；未填走哨兵 0
        const stored = toInt(favorite.level)
        level = stored === null ? 0 : pickField(stored + 1, 'favoriteLevelSsr', 0)
      }
    }
    bw.write(type, W.favoriteType)
    bw.write(level, W.favoriteLevel)
  }
  writeEquipments(bw, data, has)
}

function writeEquipments(bw, data, has) {
  if (!has('equip')) return
  for (let slot = 0; slot < 4; slot++) {
    const lines = Array.isArray(data.equipments?.[slot]) ? data.equipments[slot] : []
    for (let index = 0; index < 3; index++) {
      const line = lines[index]
      const typeIndex = line ? AFFIX_TYPES.indexOf(line.functionType) : -1
      const tier = line ? pickField(line.level, 'affixTier', 0) : 0
      if (typeIndex >= 0 && tier > 0) {
        bw.write(typeIndex + 1, W.affixType)
        bw.write(tier, W.affixTier)
      } else {
        bw.write(0, W.affixType)
        bw.write(0, W.affixTier)
      }
    }
  }
}

// ---- 单角色读取 ----
function readCharacter(br, has) {
  const id = br.read(W.id)
  const record = {}

  if (has('limitBreak')) {
    const grade = br.read(W.grade)
    const core = br.read(W.core)
    record.limitBreak = {
      grade: grade === SENTINEL.grade ? null : grade,
      core: core === SENTINEL.core ? null : core,
    }
  }
  if (has('affection')) {
    const affection = br.read(W.affection)
    record.affection = affection === SENTINEL.affection ? null : affection
  }
  if (has('combat')) {
    const combat = br.read(W.combat)
    record.combat = combat === 0 ? null : combat
  }
  if (has('skills')) {
    const values = [br.read(W.skill), br.read(W.skill), br.read(W.skill)]
    record.skills = {
      skill1: values[0] === 0 ? null : values[0],
      skill2: values[1] === 0 ? null : values[1],
      burst: values[2] === 0 ? null : values[2],
    }
  }
  if (has('cube')) {
    const type = br.read(W.cubeType)
    const level = br.read(W.cubeLevel)
    record.cube = type === 0 ? null : { resourceId: CUBE_IDS[type - 1], level: level || null }
  }
  if (has('favorite')) {
    const type = br.read(W.favoriteType)
    const level = br.read(W.favoriteLevel)
    if (type === 0 || level === 0) {
      record.favoriteItem = null
    } else if (type === FAVORITE_TYPE_R || type === FAVORITE_TYPE_SR) {
      record.favoriteItem = { rarity: type === FAVORITE_TYPE_R ? 'R' : 'SR', level, resourceKey: null }
    } else {
      record.favoriteItem = {
        rarity: 'SSR',
        resourceKey: FAVORITE_KEYS[type - FAVORITE_TYPE_BASE] ?? null,
        // 线上传的是界面值（1-3），落回 App 内部表示（0-2）
        level: level - 1,
      }
    }
  }
  if (has('equip')) {
    record.equipments = Array.from({ length: 4 }, () => (
      Array.from({ length: 3 }, () => {
        const type = br.read(W.affixType)
        const tier = br.read(W.affixTier)
        if (type === 0 || tier === 0) return null
        const functionType = AFFIX_TYPES[type - 1]
        if (!functionType) return null
        return { functionType, level: tier, value: AFFIX_TIER_VALUES[functionType]?.[tier - 1] ?? null }
      })
    ))
  }
  return { nameCode: fromWireId(id), record }
}

/** 读版本与类型头；版本不一致直接拒绝（布局变过，硬解析会解出垃圾） */
function readHeader(br) {
  const version = br.read(16)
  if (version !== SHARE_VERSION) {
    const text = `${Math.floor(version / 100)}.${version % 100}`
    throw new Error(t('分享码版本 {text} 与当前版本 {version} 不一致，请到网页端重新导出', { text, version: SHARE_VERSION_TEXT }))
  }
  return { version, payloadType: br.read(8), count: br.read(8) }
}

/**
 * 编码角色数据码（类型 0）。
 * characters: [{ nameCode, record }]，fields: 字段 key 数组（缺省＝全部）
 */
export function encodeShareCode({ synchroLevel, research, characters, fields }) {
  const list = Array.isArray(characters) ? characters : []
  if (list.length === 0) throw new Error(t('至少选择一个角色'))
  if (list.length > SHARE_MAX_COUNT) throw new Error(t('一次最多分享 {count} 个角色', { count: SHARE_MAX_COUNT }))
  const selected = Array.isArray(fields) && fields.length > 0 ? fields : ALL_SHARE_FIELDS
  const has = (key) => selected.includes(key)

  const bw = new BitWriter()
  bw.write(SHARE_VERSION, 16)
  bw.write(PAYLOAD_CHARACTERS, 8)
  bw.write(list.length, 8)
  bw.write(SHARE_FIELDS.reduce((mask, field) => (has(field.key) ? mask | (1 << field.bit) : mask), 0), 8)
  bw.write(pickField(synchroLevel, 'synchro', DEFAULT_SYNCHRO_LEVEL), 16)
  if (has('research')) {
    for (const [group, key] of WIRE_RESEARCH) {
      bw.write(pickField(research?.[group]?.[key], 'research', 0), W.research)
    }
  }
  for (const item of list) writeCharacter(bw, item.nameCode, item.record, has)
  return seal(bw)
}

/**
 * 编码表格配置码（类型 1）。只带角色名单与行序，不带任何练度数据 ——
 * BOT 收到后按这个顺序，从**该 QQ 自己已录入**的角色里取数据来排表。
 */
export function encodeTableShareCode({ nameCodes }) {
  const list = (Array.isArray(nameCodes) ? nameCodes : []).map((code) => String(code))
  if (list.length === 0) throw new Error(t('表格里至少放一个角色'))
  if (list.length > TABLE_MAX_COUNT) throw new Error(t('表格最多分享 {count} 个角色', { count: TABLE_MAX_COUNT }))

  const bw = new BitWriter()
  bw.write(SHARE_VERSION, 16)
  bw.write(PAYLOAD_TABLE, 8)
  bw.write(list.length, 8)
  for (const code of list) bw.write(toWireId(code), W.id)
  return seal(bw)
}

/**
 * 解码分享码，按载荷类型返回：
 *   类型 0 → { version, payloadType, fields, synchroLevel, research, characters }
 *   类型 1 → { version, payloadType, nameCodes }
 */
export function decodeShareCode(text) {
  const br = new BitReader(open(text))
  const { version, payloadType, count } = readHeader(br)

  if (payloadType === PAYLOAD_TABLE) {
    if (count === 0) throw new Error('分享码内容不完整')
    const nameCodes = []
    for (let i = 0; i < count; i++) nameCodes.push(fromWireId(br.read(W.id)))
    return { version, payloadType, nameCodes }
  }
  if (payloadType !== PAYLOAD_CHARACTERS) {
    throw new Error(`不认识的分享码类型：${payloadType}`)
  }
  if (count === 0 || count > SHARE_MAX_COUNT) throw new Error('分享码内容不完整')

  const mask = br.read(8)
  const fields = SHARE_FIELDS.filter((field) => mask & (1 << field.bit)).map((field) => field.key)
  const has = (key) => fields.includes(key)
  const synchroLevel = br.read(16)

  const research = { class: {}, corporation: {} }
  if (has('research')) {
    for (const [group, key] of WIRE_RESEARCH) research[group][key] = br.read(W.research)
  }
  const characters = {}
  for (let i = 0; i < count; i++) {
    const { nameCode, record } = readCharacter(br, has)
    characters[nameCode] = record
  }
  return { version, payloadType, fields, synchroLevel, research, characters }
}

// ---- 字段选择的本地持久化（导出页与角色详情页共用同一份设置） ----
const FIELDS_KEY = 'nikke-photos/share-fields/v1'

export function loadShareFields() {
  try {
    const raw = JSON.parse(localStorage.getItem(FIELDS_KEY) || 'null')
    if (!Array.isArray(raw)) return [...DEFAULT_SHARE_FIELDS]
    const valid = raw.filter((key) => ALL_SHARE_FIELDS.includes(key))
    // 装备词条恒为必选
    return valid.includes('equip') ? valid : ['equip', ...valid]
  } catch {
    return [...DEFAULT_SHARE_FIELDS]
  }
}

export function saveShareFields(fields) {
  const valid = (Array.isArray(fields) ? fields : []).filter((key) => ALL_SHARE_FIELDS.includes(key))
  const list = valid.includes('equip') ? valid : ['equip', ...valid]
  localStorage.setItem(FIELDS_KEY, JSON.stringify(list))
  return list
}

// ---- 首次进入导出页的默认值提示：用户可选「不再提醒」 ----
const NOTICE_KEY = 'nikke-photos/share-notice/v1'

export const isShareNoticeDismissed = () => {
  try {
    return localStorage.getItem(NOTICE_KEY) === '1'
  } catch {
    return true
  }
}

export function dismissShareNotice() {
  try {
    localStorage.setItem(NOTICE_KEY, '1')
  } catch {
    // 忽略：写入失败时下次进入仍会提醒，不影响功能
  }
}
