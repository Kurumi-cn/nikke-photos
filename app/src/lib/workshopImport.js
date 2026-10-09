// NIKKE Workshop「本地图鉴」xlsx → 本工具档案结构（单向导入）
//
// 背景：Workshop 的图鉴导出只有 xlsx（没有 JSON / CSV）。文件里共 5 张工作表，
// 数据全在「角色 / 装备 / 词条」三张里（「角色卡」是展示页、「使用说明」是文档，都不读）。
//
// 纪律（与 accountImport.js 一致）：
//   · 越界一律留空（null），绝不写 0 —— 落库时 profileStore 的 sanitize 会把越界值折成
//     fallback（战斗力 0 → 1），写 0 会让用户拿到一个"看起来正常但其实是编的"值；
//   · 词条数值不采信文件里的「数值」列，按「档位」用本工具档位表反推（两边同源，口径以我们为准），
//     文件数值只用于交叉核对并留痕；
//   · 本工具只认图鉴里的标准角色（没有自定义角色机制）：Workshop 的自定义角色、
//     本工具还没收录的角色，一律跳过并记入报告。
//
// xlsx 读取不引第三方库：浏览器原生 DecompressionStream 解 ZIP，再扫描 XML 取纯值
// （共享字符串 / 内联字符串 / 数字 / 布尔）。不读样式、图片与公式，这张三表够用了。
import { AFFIX_TIER_VALUES, FUNCTION_LABELS, snapAffixValue } from '../data/affixTiers.js'
import { isEmptyValue, isInRange } from './fieldRanges.js'
import { t, tData } from './i18n.js'
import { defaultResearch } from './profileStore.js'
import { CHARACTERS } from './roster.js'

const SHEET_CHARACTERS = '角色'
const SHEET_LINES = '词条'

/** 角色表里本工具不导入的三列：在 Workshop 是角色级存储，在本工具是存档级（同步器等级 / 研究等级） */
const LEVEL_FIELDS = ['等级', '职业等级', '企业等级']

// ---------------------------------------------------------------- ZIP / XML 底层

/** ZIP 结尾标记（EOCD）与中央目录项签名 */
const SIG_EOCD = 0x06054b50
const SIG_CENTRAL = 0x02014b50
const SIG_LOCAL = 0x04034b50

/**
 * 读 ZIP 中央目录：返回 Map<条目名, { localOffset, size, method }>。
 * 只需要中央目录 + 本地头（xlsx 是普通 ZIP，不涉及 ZIP64 / 加密）。
 */
function readZipDirectory(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  // EOCD 在文件尾部，注释最长 64KB，从后往前找
  const floor = Math.max(0, bytes.length - 0xffff - 22)
  let eocd = -1
  for (let offset = bytes.length - 22; offset >= floor; offset -= 1) {
    if (view.getUint32(offset, true) === SIG_EOCD) {
      eocd = offset
      break
    }
  }
  if (eocd < 0) throw new Error('这个文件不是 xlsx（找不到 ZIP 结构）')

  const count = view.getUint16(eocd + 10, true)
  const decoder = new TextDecoder()
  const entries = new Map()
  let pointer = view.getUint32(eocd + 16, true)
  for (let index = 0; index < count && pointer + 46 <= bytes.length; index += 1) {
    if (view.getUint32(pointer, true) !== SIG_CENTRAL) break
    const method = view.getUint16(pointer + 10, true)
    const size = view.getUint32(pointer + 20, true)
    const nameLength = view.getUint16(pointer + 28, true)
    const extraLength = view.getUint16(pointer + 30, true)
    const commentLength = view.getUint16(pointer + 32, true)
    const localOffset = view.getUint32(pointer + 42, true)
    const name = decoder.decode(bytes.subarray(pointer + 46, pointer + 46 + nameLength))
    entries.set(name, { localOffset, size, method })
    pointer += 46 + nameLength + extraLength + commentLength
  }
  return { view, entries }
}

/** 取一个 ZIP 条目的原始内容（deflate 用 DecompressionStream('deflate-raw') 解） */
async function readZipEntry(zip, bytes, name) {
  const entry = zip.entries.get(name)
  if (!entry) return null
  const { view } = zip
  if (view.getUint32(entry.localOffset, true) !== SIG_LOCAL) throw new Error('xlsx 内部结构异常（ZIP 头校验失败）')
  const nameLength = view.getUint16(entry.localOffset + 26, true)
  const extraLength = view.getUint16(entry.localOffset + 28, true)
  const start = entry.localOffset + 30 + nameLength + extraLength
  const raw = bytes.subarray(start, start + entry.size)
  if (entry.method === 0) return raw
  if (entry.method !== 8) throw new Error(`xlsx 内部使用了不支持的压缩方式（${entry.method}）`)
  if (typeof DecompressionStream !== 'function') throw new Error('当前浏览器不支持解压 xlsx，请换新版 Chrome / Edge / Firefox')
  const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

const decodeText = (data) => (data ? new TextDecoder().decode(data) : null)

const decodeEntities = (text) => String(text ?? '').replace(
  /&(?:#x([0-9a-fA-F]+)|#(\d+)|(amp|lt|gt|quot|apos));/g,
  (whole, hex, dec, named) => {
    if (hex) return String.fromCodePoint(Number.parseInt(hex, 16))
    if (dec) return String.fromCodePoint(Number.parseInt(dec, 10))
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[named] ?? whole
  },
)

/**
 * 扫描 XML 里某一层标签：返回 [attrs 原文, 内部内容][]（自闭合标签的内容为空串）。
 * xlsx 的这几张数据表由程序生成、结构规整，够用且不依赖 DOM 解析器（Node 里也能跑）。
 */
function scanElements(xml, tag) {
  const pattern = new RegExp(`<${tag}((?:\\s[^>]*?)?)(?:/>|>([\\s\\S]*?)</${tag}>)`, 'g')
  const found = []
  for (const match of xml.matchAll(pattern)) found.push([match[1] || '', match[2] ?? ''])
  return found
}

const parseAttrs = (text) => {
  const attrs = {}
  for (const match of String(text ?? '').matchAll(/([A-Za-z_][\w.:-]*)\s*=\s*"([^"]*)"/g)) {
    attrs[match[1]] = decodeEntities(match[2])
  }
  return attrs
}

/** 单元格引用（如 "AB12"）→ 0 起的列号 */
function columnIndexOf(reference) {
  let index = 0
  for (let position = 0; position < reference.length; position += 1) {
    const code = reference.charCodeAt(position)
    if (code < 65 || code > 90) break
    index = index * 26 + (code - 64)
  }
  return index - 1
}

/** 共享字符串表 → string[] */
function parseSharedStrings(xml) {
  if (!xml) return []
  return scanElements(xml, 'si').map(([, inner]) => (
    scanElements(inner, 't').map(([, text]) => decodeEntities(text)).join('')
  ))
}

/** 工作表 XML → 对象行数组（键 = 第一行的表头文字；跳过全空行） */
function parseSheetRows(xml, shared) {
  const table = scanElements(xml, 'row').map(([, rowXml]) => {
    const cells = []
    for (const [attrsText, inner] of scanElements(rowXml, 'c')) {
      const attrs = parseAttrs(attrsText)
      const column = attrs.r ? columnIndexOf(attrs.r) : cells.length
      const type = attrs.t || 'n'
      let value = null
      if (type === 'inlineStr') {
        value = scanElements(inner, 't').map(([, text]) => decodeEntities(text)).join('')
      } else {
        const raw = decodeEntities(scanElements(inner, 'v')[0]?.[1] ?? '')
        if (type === 's') value = shared[Number(raw)] ?? null
        else if (type === 'b') value = raw === '1' || raw.toLocaleLowerCase('en-US') === 'true'
        else if (type === 'str') value = raw
        else if (type === 'e') value = null
        else value = raw === '' ? null : Number(raw)
      }
      cells[column] = value
    }
    return cells
  })

  const headerRow = table.find((cells) => cells.some((cell) => cell !== null && cell !== undefined))
  if (!headerRow) return []
  const headers = headerRow.map((label) => String(label ?? '').trim())
  const rows = []
  for (const cells of table.slice(table.indexOf(headerRow) + 1)) {
    if (!cells.some((cell) => cell !== null && cell !== '')) continue
    const row = {}
    headers.forEach((label, column) => {
      if (label) row[label] = cells[column] ?? null
    })
    rows.push(row)
  }
  return rows
}

/** 按工作表名取到解析好的行（名字 → rId → 具体 xml 路径） */
async function readSheets(zip, bytes, wanted) {
  const workbookXml = decodeText(await readZipEntry(zip, bytes, 'xl/workbook.xml'))
  const relsXml = decodeText(await readZipEntry(zip, bytes, 'xl/_rels/workbook.xml.rels'))
  if (!workbookXml || !relsXml) throw new Error('这个文件不是有效的 xlsx（缺少工作簿结构）')
  const targets = new Map(scanElements(relsXml, 'Relationship').map(([attrsText]) => {
    const attrs = parseAttrs(attrsText)
    return [attrs.Id, attrs.Target]
  }))

  const result = new Map()
  for (const [attrsText] of scanElements(workbookXml, 'sheet')) {
    const attrs = parseAttrs(attrsText)
    const name = attrs.name || ''
    if (!wanted.includes(name) || result.has(name)) continue
    const target = targets.get(attrs['r:id'])
    if (!target) continue
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`
    const xml = decodeText(await readZipEntry(zip, bytes, path))
    if (xml) result.set(name, xml)
  }
  return result
}

// ---------------------------------------------------------------- 角色 / 字段映射

const nameKey = (value) => String(value ?? '').normalize('NFKC').replace(/\s+/g, '').toLocaleLowerCase('en-US')

const asInt = (value) => {
  const number = Number(value)
  return Number.isFinite(number) ? Math.trunc(number) : null
}

/** 取一个受范围约束的整数：未填留空（不提示），越界留空并记进报告 */
const pickValue = (report, key, label, value) => {
  if (isEmptyValue(value)) return null
  const number = asInt(value)
  if (number === null || !isInRange(key, number)) {
    report.fieldIssues[label] = (report.fieldIssues[label] || 0) + 1
    return null
  }
  return number
}

/** 图鉴索引：name_code 优先，名称（简中 / 英文 / 别名）兜底 */
function buildRosterIndex() {
  const byCode = new Map(CHARACTERS.map((character) => [character.nameCode, character]))
  const byName = new Map()
  for (const character of CHARACTERS) {
    for (const name of [character.nameCn, character.nameEn, ...(character.aliases || [])]) {
      const key = nameKey(name)
      if (key && !byName.has(key)) byName.set(key, character)
    }
  }
  return { byCode, byName }
}

function matchCharacter(row, index) {
  const code = String(row['标准name_code'] ?? '').trim()
  if (code && index.byCode.has(code)) return index.byCode.get(code)
  for (const column of ['名称', '简中名称', '英文名称']) {
    const hit = index.byName.get(nameKey(row[column]))
    if (hit) return hit
  }
  return null
}

const pad = (value) => String(value).padStart(2, '0')
const stampText = (time) => {
  const date = new Date(time)
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const createReport = () => ({
  matched: 0,
  unmatched: [],
  emptySkipped: 0,
  unknownTypes: 0,
  badPlacements: 0,
  badTiers: 0,
  snappedTiers: 0,
  positionConflicts: 0,
  valueMismatch: 0,
  /** 文件里有「等级 / 职业等级 / 企业等级」值的角色数（这三列是角色级、本工具为存档级，不导入） */
  levelFieldCharacters: 0,
  fieldIssues: {},
  notices: [],
})

function buildNotices(report) {
  const notices = []
  if (report.unmatched.length) {
    const head = report.unmatched.slice(0, 5).join('、')
    notices.push(t('图鉴未收录，已跳过 {count} 个角色（{head}{more}）——多为 Workshop 的自定义角色', {
      count: report.unmatched.length,
      head,
      more: report.unmatched.length > 5 ? t(' 等') : '',
    }))
  }
  if (report.emptySkipped) notices.push(t('有 {count} 个角色只有本工具不保存的字段（如等级），没有可导入的数据，已跳过', { count: report.emptySkipped }))
  if (report.levelFieldCharacters) {
    notices.push(t('文件里的「等级 / 职业等级 / 企业等级」是按角色填写的（共 {count} 个角色有值），本工具的同步器等级与研究等级是全档共用的一个值，所以这三列没有逐个导入，请在下一步统一填写', { count: report.levelFieldCharacters }))
  }
  if (report.unknownTypes) notices.push(t('有 {count} 条词条的类型代码不在本工具的档位表里，已跳过', { count: report.unknownTypes }))
  if (report.badPlacements) notices.push(t('有 {count} 条词条的装备序号 / 位置超出 1~4 / 1~3，已跳过', { count: report.badPlacements }))
  if (report.badTiers) notices.push(t('有 {count} 条词条既没有有效档位、数值也对不上档位表，已跳过', { count: report.badTiers }))
  if (report.snappedTiers) notices.push(t('有 {count} 条词条缺档位，已按数值吸附到最近的档位', { count: report.snappedTiers }))
  if (report.positionConflicts) notices.push(t('同一位置出现多条词条，已取首条：{count} 处', { count: report.positionConflicts }))
  if (report.valueMismatch) notices.push(t('文件里的词条数值与档位对应值不一致（已按本工具的档位表为准）：{count} 处', { count: report.valueMismatch }))
  for (const [label, count] of Object.entries(report.fieldIssues)) notices.push(t('{label}：{count} 处数值越界，已留空', { label: tData(label), count }))
  notices.push(t('Workshop 的导出文件不含同步器等级、魔方与收藏品数据：同步器等级在下一步填写，魔方与收藏品可在「数据录入」页补填'))
  return notices
}

/**
 * 解析 Workshop 导出的图鉴 xlsx。
 *
 * @param input ArrayBuffer / Uint8Array
 * @returns {{ parsed: object, report: object }}
 *   `parsed` 与 profileStore.parseProfile 同形状（可直接喂给 importAsNewProfile / importIntoProfile），
 *   额外带 `notices`（给人看的处理说明）与 `origin: 'workshop'`（导入流程据此把默认存档名定为「workshop导入N」）。
 *   `synchroLevel` 为 null —— 文件里没有这个值，覆盖存档时由调用方保留原值、新建存档时由用户填写。
 */
export async function parseWorkshopExcel(input, { now = Date.now() } = {}) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  const zip = readZipDirectory(bytes)
  const sheets = await readSheets(zip, bytes, [SHEET_CHARACTERS, SHEET_LINES])
  if (!sheets.has(SHEET_CHARACTERS) || !sheets.has(SHEET_LINES)) {
    throw new Error('不是 NIKKE Workshop 导出的图鉴文件（缺少「角色」或「词条」工作表）')
  }

  const shared = parseSharedStrings(decodeText(await readZipEntry(zip, bytes, 'xl/sharedStrings.xml')))
  const characterRows = parseSheetRows(sheets.get(SHEET_CHARACTERS), shared)
  const lineRows = parseSheetRows(sheets.get(SHEET_LINES), shared)

  // 词条按「本地ID 优先、角色名兜底」归组（与 Workshop 自己的导入规则一致）
  const linesByKey = new Map()
  for (const row of lineRows) {
    const id = String(row['本地ID'] ?? '').trim()
    const key = id || nameKey(row['角色名称'])
    if (!key) continue
    if (!linesByKey.has(key)) linesByKey.set(key, [])
    linesByKey.get(key).push(row)
  }

  const index = buildRosterIndex()
  const report = createReport()
  const characters = {}

  for (const row of characterRows) {
    const character = matchCharacter(row, index)
    if (!character) {
      report.unmatched.push(String(row['名称'] ?? row['简中名称'] ?? row['英文名称'] ?? '（未命名）').trim())
      continue
    }
    const localId = String(row['本地ID'] ?? '').trim()
    const equipments = Array.from({ length: 4 }, () => [null, null, null])
    for (const line of linesByKey.get(localId) || linesByKey.get(nameKey(row['名称'])) || []) {
      const type = String(line['词条类型代码'] ?? '').trim()
      if (!type) continue // 空行（只有位置 / 锁定状态）不是词条
      if (!FUNCTION_LABELS[type]) {
        report.unknownTypes += 1
        continue
      }
      const slot = asInt(line['装备序号'])
      const position = asInt(line['词条位置'])
      if (!(slot >= 1 && slot <= 4) || !(position >= 1 && position <= 3)) {
        report.badPlacements += 1
        continue
      }
      const target = equipments[slot - 1]
      if (target[position - 1]) {
        report.positionConflicts += 1
        continue
      }
      let tier = asInt(line['档位'])
      if (!(tier >= 1 && tier <= 15)) {
        // 档位缺失 / 越界时，用数值在本词条的档位表里吸附一次作为兜底
        const snapped = snapAffixValue(Number(line['数值']), { functionType: type })
        tier = Number.isInteger(snapped?.tier) ? snapped.tier : null
        if (tier === null) {
          report.badTiers += 1
          continue
        }
        report.snappedTiers += 1
      }
      const value = AFFIX_TIER_VALUES[type][tier - 1]
      const rawValue = Number(line['数值'])
      // 交叉核对：容许文件里是"小数形式"的百分比（0.2215 表示 22.15%）
      if (Number.isFinite(rawValue) && Math.abs(rawValue - value) > 0.005 && Math.abs(rawValue * 100 - value) > 0.005) {
        report.valueMismatch += 1
      }
      target[position - 1] = { position, functionType: type, level: tier, value }
    }

    const draft = {
      limitBreak: {
        grade: pickValue(report, 'grade', '突破', row['突破']),
        core: pickValue(report, 'core', '核心', row['核心突破']),
      },
      affection: pickValue(report, 'affection', '好感度', row['好感度']),
      combat: pickValue(report, 'combat', '战斗力', row['战斗力']),
      skills: {
        skill1: pickValue(report, 'skill', '技能等级', row['技能1等级']),
        skill2: pickValue(report, 'skill', '技能等级', row['技能2等级']),
        burst: pickValue(report, 'skill', '技能等级', row['爆裂技能等级']),
      },
      equipments,
    }

    // 角色表里的等级 / 职业等级 / 企业等级本工具不保存（等级取存档级同步器、研究等级取存档表），
    // 有值时统计出来在说明里讲清楚；只有这些字段的角色没有可导入的数据，跳过并说明（不要产出空记录）
    if (LEVEL_FIELDS.some((label) => !isEmptyValue(row[label]))) report.levelFieldCharacters += 1
    const hasData = [draft.limitBreak.grade, draft.limitBreak.core, draft.affection, draft.combat,
      draft.skills.skill1, draft.skills.skill2, draft.skills.burst].some((value) => value !== null)
      || equipments.some((slot) => slot.some(Boolean))
    if (!hasData) {
      report.emptySkipped += 1
      continue
    }

    characters[character.nameCode] = draft
    report.matched += 1
  }

  if (report.matched === 0) {
    throw new Error(report.unmatched.length
      ? `文件里的 ${report.unmatched.length} 个角色本工具图鉴都没有收录，无法导入`
      : '文件里没有可导入的角色数据')
  }

  report.notices = buildNotices(report)
  return {
    parsed: {
      name: '',
      remark: `NIKKE Workshop 图鉴导入 · ${stampText(now)}`,
      synchroLevel: null,
      research: defaultResearch(),
      schemes: [],
      characters,
      count: report.matched,
      unknown: report.unmatched,
      notices: report.notices,
      /** 供导入流程区分来源（默认存档名走「workshop导入N」自动编号，见 ProfileImportFlow） */
      origin: 'workshop',
    },
    report,
  }
}