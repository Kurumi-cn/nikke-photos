// 多存档档案存储：一个存档（profile）内含多个角色记录，键 = name_code
// 存放于浏览器 localStorage；支持整档 JSON 导出/导入（本地文件，不经网络）
// 兼容旧版单档存储：首次读取时惰性迁移为「默认存档」；同步器等级为存档级全局唯一值
import { CHARACTERS } from './roster.js'
import { isFullyRecorded } from './statsModel.js'

export const STORE_VERSION = 1
const PROFILE_VERSION = 1

const LEGACY_KEY = 'nikke-photos/profile/v1'
const INDEX_KEY = 'nikke-photos/profiles/v1/index'
const DATA_KEY = (id) => `nikke-photos/profiles/v1/data/${id}`

export const DEFAULT_PROFILE_ID = 'default'
export const DEFAULT_PROFILE_NAME = '默认存档'
export const DEFAULT_SYNCHRO_LEVEL = 200
export const SYNCHRO_MIN = 1
export const SYNCHRO_MAX = 2000
export const REMARK_MAX = 200
export const NAME_MAX = 30

// 研究所等级：存档级共通值（职业研究 + 企业研究两条独立研究线），默认全 1
export const RESEARCH_CLASSES = ['Attacker', 'Defender', 'Supporter']
export const RESEARCH_CORPORATIONS = ['ELYSION', 'MISSILIS', 'TETRA', 'PILGRIM', 'ABNORMAL']
export const RESEARCH_MIN = 0
export const RESEARCH_MAX = 999
const DEFAULT_RESEARCH_LEVEL = 1

export const defaultResearch = () => ({
  class: Object.fromEntries(RESEARCH_CLASSES.map((key) => [key, DEFAULT_RESEARCH_LEVEL])),
  corporation: Object.fromEntries(RESEARCH_CORPORATIONS.map((key) => [key, DEFAULT_RESEARCH_LEVEL])),
})

/** 归一化研究等级：缺项补 1，保证老存档也能读到完整的两张表 */
function normalizeResearch(input) {
  const table = defaultResearch()
  if (!input || typeof input !== 'object') return table
  for (const key of RESEARCH_CLASSES) {
    const value = Number(input.class?.[key])
    if (Number.isFinite(value)) table.class[key] = Math.trunc(value)
  }
  for (const key of RESEARCH_CORPORATIONS) {
    const value = Number(input.corporation?.[key])
    if (Number.isFinite(value)) table.corporation[key] = Math.trunc(value)
  }
  return table
}

const now = () => new Date().toISOString()
const newId = () => `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`

// ---- 轻量订阅：切换 / 改名 / 改等级后通知常驻组件（TopNav 等）即时刷新 ----
const listeners = new Set()
export function subscribeProfiles(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
function emit() {
  for (const listener of listeners) {
    try {
      listener()
    } catch {
      // 忽略订阅方异常，不影响数据写入
    }
  }
}

// ---- 底层读写 ----
function readJSON(key) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function readIndex() {
  const parsed = readJSON(INDEX_KEY)
  if (!parsed || !Array.isArray(parsed.profiles) || parsed.profiles.length === 0) return null
  if (typeof parsed.currentId !== 'string') parsed.currentId = parsed.profiles[0].id
  // 老存档（研究等级功能之前创建的）补全两张表，缺项一律填 1
  for (const profile of parsed.profiles) profile.research = normalizeResearch(profile.research)
  return parsed
}

function writeIndex(index) {
  localStorage.setItem(INDEX_KEY, JSON.stringify(index))
}

function readCharacters(id) {
  const parsed = readJSON(DATA_KEY(id))
  if (!parsed || typeof parsed.characters !== 'object' || parsed.characters === null) return null
  return parsed.characters
}

function writeCharacters(id, characters) {
  localStorage.setItem(DATA_KEY(id), JSON.stringify({
    version: PROFILE_VERSION,
    updatedAt: now(),
    characters: characters ?? {},
  }))
}

/** 旧版单档数据（nikke-photos/profile/v1）的角色表；键保留不删，作为兜底 */
function legacyCharacters() {
  const legacy = readJSON(LEGACY_KEY)
  return legacy && typeof legacy.characters === 'object' && legacy.characters !== null
    ? legacy.characters
    : {}
}

/** 读取存档索引；不存在时创建「默认存档」并迁移旧数据（惰性，只做一次） */
function ensureIndex() {
  const existing = readIndex()
  if (existing) return existing
  const stamp = now()
  const profile = {
    id: DEFAULT_PROFILE_ID,
    name: DEFAULT_PROFILE_NAME,
    synchroLevel: DEFAULT_SYNCHRO_LEVEL,
    research: defaultResearch(),
    remark: '',
    createdAt: stamp,
    updatedAt: stamp,
    deletable: false,
  }
  const index = { version: PROFILE_VERSION, currentId: profile.id, profiles: [profile] }
  writeIndex(index)
  writeCharacters(profile.id, legacyCharacters())
  return index
}

const currentOf = (index) => index.profiles.find((item) => item.id === index.currentId) || index.profiles[0]

// ---- 对外：存档读取 ----
export function listProfiles() {
  return ensureIndex().profiles.map((item) => ({ ...item }))
}

export function getCurrentProfile() {
  return { ...currentOf(ensureIndex()) }
}

export function getCurrentProfileId() {
  return ensureIndex().currentId
}

/** 自动编号：现存「存档N」的最大编号 + 1（不补空号） */
export function nextProfileName() {
  let max = 0
  for (const item of ensureIndex().profiles) {
    const matched = /^存档(\d+)$/.exec(String(item.name || ''))
    if (matched) max = Math.max(max, Number(matched[1]))
  }
  return `存档${max + 1}`
}

/** 某存档下「已完善」角色（四件装备全录入）的 nameCode 列表 */
export function fullyRecordedCodes(id) {
  const characters = readCharacters(id) || {}
  return Object.keys(characters).filter((code) => isFullyRecorded(characters[code]))
}

// ---- 对外：存档增删改（写入后 emit 通知订阅方） ----
export function createProfile({ name, synchroLevel, remark = '', research }) {
  const index = ensureIndex()
  const stamp = now()
  const profile = {
    id: newId(),
    name: String(name || '').trim(),
    synchroLevel,
    research: normalizeResearch(research),
    remark: String(remark || ''),
    createdAt: stamp,
    updatedAt: stamp,
    deletable: true,
  }
  index.profiles.push(profile)
  index.currentId = profile.id
  writeIndex(index)
  writeCharacters(profile.id, {})
  emit()
  return { ...profile }
}

export function updateProfile(id, patch) {
  const index = ensureIndex()
  const profile = index.profiles.find((item) => item.id === id)
  if (!profile) throw new Error('存档不存在')
  if (patch.name !== undefined) profile.name = String(patch.name).trim()
  if (patch.synchroLevel !== undefined) profile.synchroLevel = patch.synchroLevel
  if (patch.research !== undefined) profile.research = normalizeResearch(patch.research)
  if (patch.remark !== undefined) profile.remark = String(patch.remark || '')
  profile.updatedAt = now()
  writeIndex(index)
  emit()
  return { ...profile }
}

export function deleteProfile(id) {
  const index = ensureIndex()
  const target = index.profiles.find((item) => item.id === id)
  if (!target) return false
  if (target.deletable === false) throw new Error('默认存档不可删除')
  index.profiles = index.profiles.filter((item) => item.id !== id)
  if (index.currentId === id) index.currentId = index.profiles[0].id
  writeIndex(index)
  try {
    localStorage.removeItem(DATA_KEY(id))
  } catch {
    // 忽略：数据键清理失败不影响可用性
  }
  emit()
  return true
}

export function setCurrentProfile(id) {
  const index = ensureIndex()
  if (!index.profiles.some((item) => item.id === id)) return false
  index.currentId = id
  writeIndex(index)
  emit()
  return true
}

// ---- 对外：同步器等级（存档级全局唯一，改动即全体生效） ----
export const getSynchroLevel = () => getCurrentProfile().synchroLevel

export function setSynchroLevel(level) {
  const index = ensureIndex()
  const profile = currentOf(index)
  profile.synchroLevel = level
  profile.updatedAt = now()
  writeIndex(index)
  emit()
  return profile.synchroLevel
}

// ---- 对外：研究所等级（存档级共通，职业 / 企业两条独立研究线） ----
export const getResearch = () => normalizeResearch(getCurrentProfile().research)

/** 取某角色对应的研究等级（按角色的职业与企业查存档表） */
export function researchLevelsFor(character, research) {
  const table = research ?? getResearch()
  return {
    classLevel: table.class?.[character?.class] ?? null,
    corporationLevel: table.corporation?.[character?.corporation] ?? null,
  }
}

/**
 * 把一组技能等级同步给「已完善」的角色（四件装备全录入），一次写入。
 * 返回被改写的角色数。
 */
export function syncSkillsToFullyRecorded(skills) {
  const index = ensureIndex()
  const profile = currentOf(index)
  const characters = readCharacters(profile.id) || {}
  let count = 0
  for (const code of Object.keys(characters)) {
    if (!isFullyRecorded(characters[code])) continue
    characters[code] = { ...characters[code], skills: { ...skills }, updatedAt: now() }
    count++
  }
  if (count > 0) {
    writeCharacters(profile.id, characters)
    profile.updatedAt = now()
    writeIndex(index)
    emit()
  }
  return count
}

// ---- 对外：角色记录（作用于当前存档，签名与旧版保持一致） ----
export function loadStore() {
  const index = ensureIndex()
  const profile = currentOf(index)
  return {
    version: STORE_VERSION,
    updatedAt: profile.updatedAt ?? null,
    characters: readCharacters(profile.id) || {},
    profileId: profile.id,
    name: profile.name,
    synchroLevel: profile.synchroLevel,
    research: normalizeResearch(profile.research),
    remark: profile.remark,
  }
}

export function saveStore(store) {
  const index = ensureIndex()
  const profile = currentOf(index)
  writeCharacters(profile.id, store.characters ?? {})
  profile.updatedAt = now()
  writeIndex(index)
  return loadStore()
}

export const loadRecord = (nameCode) => loadStore().characters[String(nameCode)] || null

export function saveRecord(nameCode, record) {
  const store = loadStore()
  store.characters[String(nameCode)] = { ...record, updatedAt: now() }
  return saveStore(store)
}

export function removeRecord(nameCode) {
  const store = loadStore()
  delete store.characters[String(nameCode)]
  return saveStore(store)
}

export const recordedCodes = () => Object.keys(loadStore().characters)
export const countRecords = () => recordedCodes().length

// ---- 对外：整档 JSON 导出 / 导入 ----
export function exportProfile() {
  const index = ensureIndex()
  const profile = currentOf(index)
  return JSON.stringify({
    format: 'nikke-photos-profile',
    version: STORE_VERSION,
    name: profile.name,
    synchroLevel: profile.synchroLevel,
    research: normalizeResearch(profile.research),
    remark: profile.remark,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
    characters: readCharacters(profile.id) || {},
  }, null, 2)
}

/** 解析整档 JSON（兼容旧版裸 characters 对象），返回元信息与统计 */
export function parseProfile(text) {
  const parsed = JSON.parse(text)
  if (!parsed || typeof parsed !== 'object') throw new Error('不是有效的档案 JSON')
  const characters = parsed.characters && typeof parsed.characters === 'object' && parsed.characters !== null
    ? parsed.characters
    : parsed
  if (typeof characters !== 'object' || characters === null) throw new Error('档案里没有角色记录')
  const known = new Set(CHARACTERS.map((character) => character.nameCode))
  const keys = Object.keys(characters)
  return {
    name: typeof parsed.name === 'string' ? parsed.name : '',
    remark: typeof parsed.remark === 'string' ? parsed.remark : '',
    synchroLevel: Number.isFinite(parsed.synchroLevel) ? parsed.synchroLevel : DEFAULT_SYNCHRO_LEVEL,
    research: normalizeResearch(parsed.research),
    characters,
    count: keys.length,
    unknown: keys.filter((code) => !known.has(code)),
  }
}

/** 覆盖某个存档：保留其名称与备注，替换角色数据，同步器等级与研究等级取导入值 */
export function importIntoProfile(id, parsed) {
  const index = ensureIndex()
  const profile = index.profiles.find((item) => item.id === id)
  if (!profile) throw new Error('存档不存在')
  profile.synchroLevel = parsed.synchroLevel
  profile.research = normalizeResearch(parsed.research)
  profile.updatedAt = now()
  writeIndex(index)
  writeCharacters(id, parsed.characters)
  emit()
  return { imported: parsed.count, unknown: parsed.unknown }
}

/** 新建存档并导入（名称 / 同步器等级由调用方在弹窗里确认，研究等级取导入值） */
export function importAsNewProfile(parsed, { name, synchroLevel }) {
  const profile = createProfile({ name, synchroLevel, research: parsed.research, remark: parsed.remark })
  writeCharacters(profile.id, parsed.characters)
  emit()
  return { imported: parsed.count, unknown: parsed.unknown, profile }
}
