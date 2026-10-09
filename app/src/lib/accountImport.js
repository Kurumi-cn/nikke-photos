// BlaBlaLink 账号导出文件（油猴脚本产出）→ 本工具的角色记录
//
// 分工：油猴脚本只做「字段搬运 + 形状整理」，不含任何游戏业务知识；
// 所有 **id → 术语** 的映射都在这里。纯函数，不碰 DOM / 存储 / localStorage，可被 Node 单测覆盖。
//
// 核心纪律：**越界或缺失一律写 null（未填），绝不写 0。**
// 因为落库时 profileStore 的 sanitizeCharacters 会把越界值折回 fallback
// （synchro 0 → 200、combat 0 → 1），而且它只在 console.warn 里提示、界面完全看不到 ——
// 把 0 原样交给它，用户会拿到一个"看起来正常但其实是我们编出来的"值。
import { AFFIX_TIER_VALUES, FUNCTION_LABELS } from '../data/affixTiers.js'
import { findCubeByCubeId } from './cubes.js'
import { FIELD_RANGES, isInRange } from './fieldRanges.js'
import { t, tData } from './i18n.js'
import { defaultResearch, NAME_MAX } from './profileStore.js'
import { findCharacter } from './roster.js'

/** 导出文件的格式标识与版本（脚本侧必须一致） */
export const ACCOUNT_FORMAT = 'nikke-photos-account'
export const ACCOUNT_VERSION = 1

/**
 * 研究所等级：接口的 `tid` → 我方存档表的 `[组, 键]`。
 * `1001`(general/通用研究) 我们这边没有对应项，直接丢弃。
 */
const RESEARCH_BY_TID = Object.freeze({
  1101: ['class', 'Attacker'],
  1102: ['class', 'Defender'],
  1103: ['class', 'Supporter'],
  1201: ['corporation', 'ELYSION'],
  1202: ['corporation', 'MISSILIS'],
  1203: ['corporation', 'TETRA'],
  1204: ['corporation', 'PILGRIM'],
  1205: ['corporation', 'ABNORMAL'],
})

/**
 * 收藏品品质：从 `favorite_item_tid` 的位数规律推（规则移植自 NIKKE Workshop，
 * 那里是唯一验证过的实现）：首位 2 → SSR；首位 1 且末位 1 → R、末位 2 → SR。
 */
const favoriteRarityOf = (tid) => {
  const text = String(tid ?? '')
  if (!text || text === '0') return ''
  const first = Number.parseInt(text.charAt(0), 10)
  const last = Number.parseInt(text.charAt(text.length - 1), 10)
  if (first === 2) return 'SSR'
  if (first === 1 && last === 1) return 'R'
  if (first === 1 && last === 2) return 'SR'
  return ''
}

const asInt = (value) => {
  if (value === null || value === undefined || String(value).trim() === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? Math.trunc(number) : null
}

const pad = (value) => String(value).padStart(2, '0')
const formatStamp = (iso) => {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 存档名：去控制字符、截断到 NAME_MAX；超长记进报告 */
const sanitizeProfileName = (raw) => {
  const name = String(raw ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim()
  if (name.length <= NAME_MAX) return { name, truncated: false }
  return { name: name.slice(0, NAME_MAX), truncated: true }
}

const createReport = () => ({
  matched: 0,
  unmatched: [],
  unknownCube: 0,
  favoriteMismatch: 0,
  positionConflicts: 0,
  valueMismatch: 0,
  synchroFallback: false,
  nameTruncated: false,
  /** 字段名 → 「缺失或越界被留空」的处数 */
  fieldIssues: {},
  /** 给人看的汇总句子（去重后有上限） */
  notices: [],
})

const noteIssue = (report, label) => {
  report.fieldIssues[label] = (report.fieldIssues[label] || 0) + 1
}

/** 取一个受范围约束的整数值：缺失或越界都不写，记进报告后返回 null */
const pickValue = (report, key, label, value) => {
  const number = asInt(value)
  if (number === null || !isInRange(key, number)) {
    noteIssue(report, label)
    return null
  }
  return number
}

/**
 * 一个部位的三条词条：按 position 排进 3 槽数组。
 * `value` 用**我们自己的档位表**推导（不采信接口给的百分比），
 * 否则词条合计会因为「有档位没有数值」被算成不完整、卡片显示 "—"。
 */
const toSlotLines = (entry, slot, report) => {
  const source = Array.isArray(entry?.equipments?.[slot]) ? entry.equipments[slot] : []
  const byPosition = new Map()
  source.forEach((line, index) => {
    // 空行（null / undefined）不是词条，先跳过 —— 否则它也会占一个位置、把后面的行误判成"同位置冲突"
    if (!line) return
    const position = asInt(line.position) ?? index + 1
    if (position < 1 || position > 3) return
    // 同一位置出现多条：留首条（与 cardModel.normalizeEquipments 的取向一致）
    if (byPosition.has(position)) {
      report.positionConflicts += 1
      return
    }
    byPosition.set(position, line)
  })
  return Array.from({ length: 3 }, (_, index) => {
    const line = byPosition.get(index + 1)
    if (!line) return null
    const functionType = String(line.functionType ?? '').trim()
    const tier = asInt(line.level)
    const value = Number.isFinite(tier) ? AFFIX_TIER_VALUES[functionType]?.[tier - 1] : undefined
    if (!FUNCTION_LABELS[functionType] || !Number.isFinite(value)) {
      noteIssue(report, '词条')
      return null
    }
    // 与接口给的百分比交叉校验（不一致时以我们的档位表为准，但要留痕）
    const remoteValue = Number(line.value)
    if (Number.isFinite(remoteValue) && Math.abs(Math.abs(remoteValue) - value) > 0.005) {
      report.valueMismatch += 1
    }
    return { functionType, level: tier, value }
  })
}

/** 一条账号记录 → 本工具的角色记录；`character` 只用来判断是不是珍藏品角色 */
const toCharacterRecord = (entry, character, report) => {
  const record = {
    limitBreak: {
      grade: pickValue(report, 'grade', '突破（星）', entry?.grade),
      core: pickValue(report, 'core', '核心', entry?.core),
    },
    affection: pickValue(report, 'affection', '好感度', entry?.affection),
    combat: pickValue(report, 'combat', '战斗力', entry?.combat),
    skills: {
      skill1: pickValue(report, 'skill', '技能 1', entry?.skills?.skill1),
      skill2: pickValue(report, 'skill', '技能 2', entry?.skills?.skill2),
      burst: pickValue(report, 'skill', '爆裂技能', entry?.skills?.burst),
    },
  }

  // 魔方：接口给的是 cubeId（1000301…），我们记录里存 resourceId（10001…）
  const cubeId = asInt(entry?.cube?.cubeId)
  const cubeLevel = pickValue(report, 'cubeLevel', '魔方等级', entry?.cube?.level)
  if (cubeId !== null && cubeId > 0) {
    const cube = findCubeByCubeId(cubeId)
    if (cube) {
      record.cube = {
        resourceId: cube.resourceId,
        nameCn: cube.nameCn,
        nameEn: cube.nameEn,
        level: cubeLevel,
      }
    } else {
      report.unknownCube += 1
    }
  }

  // 收藏品：品质由 tid 推；等级语义两边同构（SSR 内部 0-2、R/SR 原值 1-15）
  const rarity = favoriteRarityOf(asInt(entry?.favoriteItem?.tid))
  if (rarity === 'SSR') {
    const raw = asInt(entry?.favoriteItem?.level)
    if (raw === null) noteIssue(report, '收藏品等级')
    // 0-2 是内部值（界面 1-3）；给到 3 说明对方可能是 1 起，按 2 处理并留痕
    else if (raw < 0 || raw > 2) noteIssue(report, '收藏品等级')
    record.favoriteItem = { rarity: 'SSR', level: raw === null ? null : Math.max(0, Math.min(2, raw)) }
    if (!character?.favoriteItem) report.favoriteMismatch += 1
  } else if (rarity) {
    record.favoriteItem = {
      rarity,
      level: pickValue(report, 'favoriteLevel', '收藏品等级', entry?.favoriteItem?.level),
    }
  }

  record.equipments = Array.from({ length: 4 }, (_, slot) => toSlotLines(entry, slot, report))
  return record
}

/** 把统计数字整理成几句人读提示 */
const buildNotices = (report, synchroLevel) => {
  const notices = []
  if (report.unmatched.length > 0) {
    const head = report.unmatched.slice(0, 5).join('、')
    notices.push(t('图鉴未收录，已跳过 {count} 个角色（{head}{more}）', {
      count: report.unmatched.length,
      head,
      more: report.unmatched.length > 5 ? t(' 等') : '',
    }))
  }
  if (report.unknownCube > 0) notices.push(t('有 {count} 个角色的魔方编号本工具不认识，该魔方已跳过', { count: report.unknownCube }))
  if (report.favoriteMismatch > 0) notices.push(t('有 {count} 个角色账号里显示是 SSR 珍藏品，但本工具图鉴里不是珍藏品角色', { count: report.favoriteMismatch }))
  if (report.positionConflicts > 0) notices.push(t('同一位置出现多条词条，已取首条：{count} 处', { count: report.positionConflicts }))
  if (report.valueMismatch > 0) notices.push(t('词条数值与游戏显示不一致（已按本工具档位表为准）：{count} 处', { count: report.valueMismatch }))
  if (report.synchroFallback) notices.push(t('没有取到可用的同步器等级，已预填 {level}，请自行确认', { level: synchroLevel }))
  if (report.nameTruncated) notices.push(t('游戏昵称超过 {max} 字，存档名已截断', { max: NAME_MAX }))
  for (const [label, count] of Object.entries(report.fieldIssues)) {
    notices.push(t('{label}：{count} 处缺失或越界，已留空', { label: tData(label), count }))
  }
  return notices
}

/**
 * 解析油猴脚本导出的账号数据。
 *
 * @returns {{ok: boolean, errors: string[], parsed: object|null, report: object|null, meta: object|null}}
 *   `parsed` 与 `profileStore.parseProfile` 同形状，可直接喂给
 *   `importAsNewProfile(parsed, { name, synchroLevel })` / `importIntoProfile(id, parsed)`。
 */
export const parseAccountExport = (text) => {
  const fail = (message) => ({ ok: false, errors: [message], parsed: null, report: null, meta: null })

  let raw
  try {
    raw = JSON.parse(text)
  } catch {
    return fail('不是有效的 JSON 文件')
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail('文件内容不是一个对象')
  if (raw.format !== ACCOUNT_FORMAT) {
    return fail(`不是本工具认识的账号导出文件${raw.format ? `（format=${raw.format}）` : '（缺少 format 标识）'}`)
  }
  const version = asInt(raw.version)
  if (version === null || version < 1 || version > ACCOUNT_VERSION) {
    return fail(`暂不支持该文件版本（version=${raw.version ?? '缺失'}）`)
  }
  if (!Array.isArray(raw.characters)) return fail('文件里没有角色数据')

  const report = createReport()
  const characters = {}
  for (const entry of raw.characters) {
    const code = String(entry?.nameCode ?? '').trim()
    if (!code) continue
    const character = findCharacter(code)
    if (!character) {
      report.unmatched.push(code)
      continue
    }
    characters[code] = toCharacterRecord(entry, character, report)
    report.matched += 1
  }
  if (report.matched === 0) {
    return fail(`文件里的 ${raw.characters.length} 个角色本工具图鉴都没收录，无法导入`)
  }

  // 研究所等级：tid 命中就写，缺失项保持默认值 1
  const research = defaultResearch()
  for (const item of Array.isArray(raw.researches) ? raw.researches : []) {
    const target = RESEARCH_BY_TID[String(asInt(item?.tid) ?? '')]
    if (!target) continue
    const level = asInt(item?.lv)
    if (level === null || !isInRange('research', level)) continue
    research[target[0]][target[1]] = level
  }

  // 同步器等级：拿不到就预填最小值，交给确认弹窗让用户改
  const rawSynchro = asInt(raw.synchroLevel)
  const synchroReady = rawSynchro !== null && isInRange('synchro', rawSynchro)
  const synchroLevel = synchroReady ? rawSynchro : FIELD_RANGES.synchro.min
  report.synchroFallback = !synchroReady

  const { name, truncated } = sanitizeProfileName(raw.profileName)
  report.nameTruncated = truncated

  const areaId = String(raw.areaId ?? '').trim()
  const stamp = formatStamp(raw.exportedAt)
  const remark = ['BlaBlaLink 导入', areaId ? `area ${areaId}` : '', stamp].filter(Boolean).join(' · ')

  report.notices = buildNotices(report, synchroLevel)

  return {
    ok: true,
    errors: [],
    parsed: {
      name,
      remark,
      synchroLevel,
      research,
      schemes: [],
      characters,
      count: report.matched,
      unknown: report.unmatched,
    },
    report,
    meta: { areaId, exportedAt: raw.exportedAt ?? '', stamp },
  }
}
