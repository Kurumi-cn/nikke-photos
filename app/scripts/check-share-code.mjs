// NKP2 A4 分享码自检（JS 侧往返 + 生成给 Python 端核对的测试向量）
//
//   node app/scripts/check-share-code.mjs
//   node app/scripts/check-share-code.mjs --vectors 路径/vectors.json
//
// 验的东西：
//   1. 角色表里**每一个**角色都能编码并还原（A3 时代有 35 个角色编不出来）
//   2. 边界值（星级 0/3、核心 0/7、好感 0/40、战斗力 1/400 万、技能 1/10、
//      档位 1/15、收藏品 R/SR/SSR、空词条行）都能原样往返
//   3. 哨兵：字段值越界时编成哨兵，解回来是 null（而不是被夹到边界值）
//   4. 表格配置码（类型 1）行数 1 / 255 都能往返
//   5. 版本不一致的码要明确拒绝，不能硬解析
//   6. 编码是确定性的（同一输入两次编码结果一致）
//
// `--vectors` 会把 { code, expect, label } 列表写成 JSON，交给容器里的
// bot/tools/check_share_code.py 用 core/sharecode.py 解一遍对照。
// 跨语言对上才说明网页端导出的码 BOT 真能读。
import { readFileSync, writeFileSync } from 'node:fs'
import {
  SHARE_MAX_COUNT, TABLE_MAX_COUNT, SHARE_VERSION,
  encodeShareCode, encodeTableShareCode, decodeShareCode,
} from '../src/lib/shareCode.js'

const roster = JSON.parse(readFileSync(new URL('../src/data/roster.json', import.meta.url), 'utf8'))
const characters = roster.characters

let failed = 0
const fail = (msg) => { failed += 1; console.error(`  [FAIL] ${msg}`) }

/** 键排序后再序列化，方便比对 */
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

const vectors = []
const push = (label, code, expect) => vectors.push({ label, code, expect })

/** 往返一次并检查结果 */
function roundTrip(label, { characters: chars, fields, synchroLevel, research }, { toVectors = true, check } = {}) {
  let code
  try {
    code = encodeShareCode({ synchroLevel, research, characters: chars, fields })
  } catch (err) {
    fail(`${label} 编码失败：${err.message}`)
    return null
  }
  let decoded
  try {
    decoded = decodeShareCode(code)
  } catch (err) {
    fail(`${label} 解码失败：${err.message}`)
    return null
  }
  if (decoded.payloadType !== 0) fail(`${label} 载荷类型应为 0，实际 ${decoded.payloadType}`)
  const expectedCodes = chars.map((c) => String(c.nameCode)).sort()
  const actualCodes = Object.keys(decoded.characters).sort()
  if (stable(expectedCodes) !== stable(actualCodes)) {
    fail(`${label} 角色集合不一致：期望 ${expectedCodes} 实际 ${actualCodes}`)
  }

  // 用「解出来的东西」再编一遍：只要任何字段的值/位宽对不上，字节流就会不同。
  // 这一条能覆盖全部数值（比逐字段写期望值更不容易漏），哨兵被夹到边界值也会暴露。
  const reEncoded = encodeShareCode({
    synchroLevel: decoded.synchroLevel,
    research: decoded.research,
    characters: Object.entries(decoded.characters).map(([nameCode, record]) => ({ nameCode, record })),
    fields: decoded.fields,
  })
  if (reEncoded !== code) fail(`${label} 往返后重编码结果不同（字段值或位宽对不上）`)

  // 编码是确定性的：同一输入两次结果一致
  const again = encodeShareCode({ synchroLevel, research, characters: chars, fields })
  if (again !== code) fail(`${label} 编码不确定：两次结果不同`)

  if (check) {
    const problems = check(decoded)
    for (const problem of problems || []) fail(`${label} ${problem}`)
  }
  if (toVectors) push(label, code, decoded)
  return decoded
}

// ── 1. 每个角色都能编（equip 必选，只带装备） ─────────────────────────
console.log(`角色逐个编码：${characters.length} 个`)
const equipRecord = {
  equipments: [
    [{ functionType: 'IncElementDmg', level: 15 }, { functionType: 'StatAtk', level: 7 }, null],
    [{ functionType: 'StatCritical', level: 1 }, null, null],
    [null, null, null],
    [{ functionType: 'StatDef', level: 3 }, { functionType: 'StatAmmoLoad', level: 12 }, null],
  ],
}
for (const char of characters) {
  roundTrip(`单角色 ${char.nameCode} ${char.nameCn}`, {
    characters: [{ nameCode: char.nameCode, record: equipRecord }],
    fields: ['equip'],
    synchroLevel: 200,
  })
}
if (!failed) console.log(`  全部 ${characters.length} 个角色可编码并还原`)

/** 取出 decoded.characters 里某个角色的字段，按 [路径, 期望值] 逐条核对 */
function expectIn(nameCode, pairs) {
  return (decoded) => {
    const record = decoded.characters[nameCode] || {}
    const read = (path) => path.split('.').reduce((node, key) => (node == null ? null : node[key]), record)
    return pairs
      .filter(([path, want]) => {
        const got = read(path)
        return got !== want && !(typeof want === 'number' && Math.abs(got - want) < 1e-9)
      })
      .map(([path, want]) => `${path} 期望 ${JSON.stringify(want)}，实际 ${JSON.stringify(read(path))}`)
  }
}

// ── 2. 边界值：全部 8 项都勾 ─────────────────────────────────────────
const boundaryRecord = {
  limitBreak: { grade: 0, core: 0 },
  affection: 0,
  combat: 1,
  skills: { skill1: 1, skill2: 5, burst: 10 },
  cube: { resourceId: 10013, level: 15 },
  favoriteItem: { rarity: 'R', level: 1, resourceKey: null },
  equipments: Array.from({ length: 4 }, (_, slot) => Array.from({ length: 3 }, (_, line) => (
    slot === 0 && line === 0
      ? { functionType: 'StatChargeTime', level: 15 }
      : slot === 1 && line === 2
        ? { functionType: 'StatAccuracyCircle', level: 1 }
        : null
  ))),
}
roundTrip('边界值：0 下限 + 全 8 项', {
  characters: [{ nameCode: '3001', record: boundaryRecord }],
  fields: undefined,
  synchroLevel: 1,
}, {
  check: expectIn('3001', [
    ['limitBreak.grade', 0], ['limitBreak.core', 0], ['affection', 0], ['combat', 1],
    ['skills.skill1', 1], ['skills.skill2', 5], ['skills.burst', 10],
    ['cube.resourceId', 10013], ['cube.level', 15],
    ['favoriteItem.rarity', 'R'], ['favoriteItem.level', 1],
    ['equipments.0.0.functionType', 'StatChargeTime'], ['equipments.0.0.level', 15],
    ['equipments.0.0.value', 6.09],
    ['equipments.1.2.functionType', 'StatAccuracyCircle'], ['equipments.1.2.level', 1],
    ['equipments.1.2.value', 4.77],
    ['equipments.2.0', null], ['equipments.3.2', null],
  ]),
})

const maxRecord = {
  limitBreak: { grade: 3, core: 7 },
  affection: 40,
  combat: 4000000,
  skills: { skill1: 10, skill2: 10, burst: 10 },
  cube: { resourceId: 10001, level: 1 },
  favoriteItem: { rarity: 'SSR', resourceKey: 'c580', level: 2 },
  equipments: Array.from({ length: 4 }, () => Array.from({ length: 3 }, () => (
    { functionType: 'StatCriticalDamage', level: 15 }
  ))),
}
roundTrip('边界值：上限 + SSR 珍藏品', {
  characters: [{ nameCode: '5180', record: maxRecord }],
  fields: undefined,
  synchroLevel: 2000,
  research: { class: { Attacker: 999, Defender: 0, Supporter: 500 }, corporation: { ELYSION: 999, MISSILIS: 1, TETRA: 0, PILGRIM: 200, ABNORMAL: 7 } },
}, {
  check: expectIn('5180', [
    ['limitBreak.grade', 3], ['limitBreak.core', 7], ['affection', 40], ['combat', 4000000],
    ['skills.skill1', 10], ['skills.burst', 10],
    ['cube.resourceId', 10001], ['cube.level', 1],
    ['favoriteItem.rarity', 'SSR'], ['favoriteItem.resourceKey', 'c580'], ['favoriteItem.level', 2],
    ['equipments.0.0.level', 15], ['equipments.0.0.value', 20.36], ['equipments.3.2.level', 15],
  ]),
})

// 哨兵：全部越界 → 解回来应当全是 null（而不是被夹到 0 或 3）
roundTrip('哨兵：越界值一律解成 null', {
  characters: [{
    nameCode: '5005',
    record: {
      limitBreak: { grade: 9, core: 99 },
      affection: 99,
      combat: 0,
      skills: { skill1: 0, skill2: 11, burst: null },
      cube: { resourceId: 99999, level: 15 },
      favoriteItem: { rarity: 'SSR', resourceKey: '不存在', level: 2 },
      equipments: [[null, null, null], [null, null, null], [null, null, null], [null, null, null]],
    },
  }],
  fields: undefined,
  synchroLevel: 200,
}, {
  check: expectIn('5005', [
    ['limitBreak.grade', null], ['limitBreak.core', null], ['affection', null],
    ['combat', null], ['skills.skill1', null], ['skills.skill2', null], ['skills.burst', null],
    ['cube', null], ['favoriteItem', null],
    ['equipments.0.0', null], ['equipments.3.2', null],
  ]),
})

// 满 10 个角色（协议上限）
roundTrip(`上限：${SHARE_MAX_COUNT} 个角色`, {
  characters: characters.slice(0, SHARE_MAX_COUNT).map((c) => ({ nameCode: c.nameCode, record: equipRecord })),
  fields: ['equip', 'skills'],
  synchroLevel: 200,
})

// ── 3. 表格配置码（类型 1） ──────────────────────────────────────────
console.log('表格配置码：')
function tableRoundTrip(label, nameCodes) {
  let code
  try {
    code = encodeTableShareCode({ nameCodes })
  } catch (err) {
    fail(`${label} 编码失败：${err.message}`)
    return
  }
  const decoded = decodeShareCode(code)
  if (decoded.payloadType !== 1) fail(`${label} 载荷类型应为 1，实际 ${decoded.payloadType}`)
  if (stable(decoded.nameCodes) !== stable(nameCodes.map(String))) {
    fail(`${label} 名单或顺序不一致：期望 ${nameCodes} 实际 ${decoded.nameCodes}`)
  }
  push(label, code, decoded)
  return code
}

tableRoundTrip('表格：1 行', ['5145'])
tableRoundTrip('表格：混合 id 段（含低号与国服独占）', ['3001', '1007', '5145', 'cn-exclusive-huapi', 'cn-exclusive-yingning'])
tableRoundTrip(`表格：满 ${TABLE_MAX_COUNT} 行`, Array.from({ length: TABLE_MAX_COUNT }, (_, i) => {
  const char = characters[i % characters.length]
  return char.nameCode
}))

// ── 4. 拒绝：上限、版本、空 ──────────────────────────────────────────
const rejects = [
  ['11 个角色应拒绝', () => encodeShareCode({ synchroLevel: 200, characters: characters.slice(0, 11).map((c) => ({ nameCode: c.nameCode, record: equipRecord })), fields: ['equip'] })],
  ['0 个角色应拒绝', () => encodeShareCode({ synchroLevel: 200, characters: [], fields: ['equip'] })],
  ['空表格应拒绝', () => encodeTableShareCode({ nameCodes: [] })],
  [`超过 ${TABLE_MAX_COUNT} 行的表格应拒绝`, () => encodeTableShareCode({ nameCodes: Array.from({ length: TABLE_MAX_COUNT + 1 }, () => '5145') })],
  ['坏码应拒绝', () => decodeShareCode('NKP2:AAAAAAAA')],
  ['非 NKP2 前缀应拒绝', () => decodeShareCode('NKP3:AAAA')],
]
for (const [label, run] of rejects) {
  try {
    run()
    fail(`${label}，但没有报错`)
  } catch { /* 预期内 */ }
}

// 版本不一致必须拒绝：把一条合法码的版本字段改成 1（A3），重算 CRC 后解码
{
  const TABLE = (() => {
    const table = new Uint32Array(256)
    for (let i = 0; i < 256; i++) {
      let value = i
      for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
      table[i] = value >>> 0
    }
    return table
  })()
  const crc32 = (bytes) => {
    let crc = 0xffffffff
    for (const byte of bytes) crc = TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
    return (crc ^ 0xffffffff) >>> 0
  }

  const valid = encodeShareCode({
    synchroLevel: 200,
    characters: [{ nameCode: '5145', record: equipRecord }],
    fields: ['equip'],
  })
  const raw = Buffer.from(valid.slice(5).replace(/-/g, '+').replace(/_/g, '/'), 'base64')
  const body = Buffer.from(raw.subarray(0, raw.length - 4))
  body[0] = 0x00
  body[1] = 0x01 // 版本 = 1（A3）
  const crc = crc32(body)
  const patched = Buffer.concat([body, Buffer.from([(crc >>> 24) & 255, (crc >>> 16) & 255, (crc >>> 8) & 255, crc & 255])])
  const text = `NKP2:${patched.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`
  try {
    decodeShareCode(text)
    fail('版本号 0.1 的码应当被拒绝，但被解析了')
  } catch (err) {
    console.log(`版本拒绝正常：${err.message}`)
  }
}

// ── 5. 文档示例（协议文档里的完整示例就取这一条，保证文档与实现同步） ──
const docExampleResearch = {
  corporation: { ELYSION: 200, MISSILIS: 200, TETRA: 200, PILGRIM: 200, ABNORMAL: 200 },
  class: { Attacker: 200, Defender: 200, Supporter: 200 },
}
const docExampleRecord = {
  limitBreak: { grade: 3, core: 7 },
  affection: 30,
  combat: 114514,
  skills: { skill1: 10, skill2: 10, burst: 10 },
  cube: { resourceId: 10003, level: 15 },
  favoriteItem: { rarity: 'SR', level: 15, resourceKey: null },
  equipments: [
    [{ functionType: 'IncElementDmg', level: 15 }, { functionType: 'StatAtk', level: 12 }, { functionType: 'StatAmmoLoad', level: 10 }],
    [{ functionType: 'StatCritical', level: 8 }, { functionType: 'StatCriticalDamage', level: 5 }, null],
    [{ functionType: 'IncElementDmg', level: 13 }, { functionType: 'StatAtk', level: 15 }, { functionType: 'StatDef', level: 3 }],
    [{ functionType: 'StatAmmoLoad', level: 10 }, { functionType: 'StatCritical', level: 3 }, null],
  ],
}
roundTrip('文档示例：5012 白雪公主 全 8 项', {
  characters: [{ nameCode: '5012', record: docExampleRecord }],
  fields: undefined,
  synchroLevel: 200,
  research: docExampleResearch,
}, {
  check: expectIn('5012', [['limitBreak.grade', 3], ['affection', 30], ['combat', 114514], ['equipments.3.1.level', 3]]),
})

// ── 6. 长度参考（写进协议文档） ──────────────────────────────────────
console.log('\n长度参考（字符数，含 NKP2: 前缀）：')
const lengthCombos = [
  ['只有装备词条（默认）', ['equip']],
  ['装备 + 技能', ['equip', 'skills']],
  ['装备 + 技能 + 魔方 + 收藏品', ['equip', 'skills', 'cube', 'favorite']],
  ['装备 + 技能 + 魔方 + 收藏品 + 研究等级', ['equip', 'skills', 'cube', 'favorite', 'research']],
  ['全部 8 项', undefined],
]
for (const [label, fields] of lengthCombos) {
  const one = encodeShareCode({
    synchroLevel: 200, research: docExampleResearch,
    characters: [{ nameCode: '5012', record: docExampleRecord }], fields,
  })
  const many = encodeShareCode({
    synchroLevel: 200, research: docExampleResearch,
    characters: characters.slice(0, 10).map((c) => ({ nameCode: c.nameCode, record: docExampleRecord })), fields,
  })
  console.log(`  ${label.padEnd(26)} 1 个角色 ${String(one.length).padStart(4)} 字符   10 个角色 ${many.length} 字符`)
}

// ── 7. 输出 ──────────────────────────────────────────────────────────
const vectorIndex = process.argv.indexOf('--vectors')
if (vectorIndex >= 0 && process.argv[vectorIndex + 1]) {
  const out = process.argv[vectorIndex + 1]
  writeFileSync(out, `${JSON.stringify({ version: SHARE_VERSION, vectors }, null, 1)}\n`, 'utf8')
  console.log(`\n测试向量 ${vectors.length} 条 -> ${out}`)
}

console.log(failed ? `\n自检失败：${failed} 处` : '\nJS 侧自检通过')
process.exit(failed ? 1 : 0)
