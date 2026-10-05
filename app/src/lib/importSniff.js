// 拖放导入的分流器：只读文件里的 format 标识，判断它属于哪条导入链路。
//
//   本工具导出的档案       → profileStore.parseProfile + profileStore.importIntoProfile/importAsNewProfile
//   油猴脚本导出的账号数据 → accountImport.parseAccountExport + 同一对写入函数
//   Workshop 导出的图鉴    → workshopImport.parseWorkshopExcel（二进制 xlsx，按扩展名分流）
//
// 没有 format 的一律拒绝，不做"猜"：把一份恰好以角色号为键的陌生 JSON 猜成档案导进来，
// 用户拿到的是一个说不出哪里错的半成品存档，比直接报错糟得多。
// （旧版裸 characters 对象仍可在存档管理页的「导入账号/档案数据」弹窗里选文件导入，那条路是用户主动选的，不存在误判。）
import { ACCOUNT_FORMAT, parseAccountExport } from './accountImport.js'
import { PROFILE_FORMAT, parseProfile } from './profileStore.js'
import { parseWorkshopExcel } from './workshopImport.js'

export const IMPORT_KIND = { account: 'account', profile: 'profile', workshop: 'workshop' }

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/** 是不是 Excel 工作簿：按扩展名 / MIME 判断（xlsx 是二进制，不能按内容嗅探） */
export const isWorkbookFile = (file) => /\.xlsx$/i.test(file?.name || '') || file?.type === XLSX_MIME

/**
 * 拖放进来的文件 → 解析结果（与 sniffImport 同形状，供拖放层直接调用）。
 * xlsx 走 Workshop 图鉴解析：产物同样是「档案」形状，但 `synchroLevel` 为 null
 * （文件里没有这个值，覆盖存档时保留原值、新建时由用户填写）。
 */
export async function sniffImportFile(file) {
  if (isWorkbookFile(file)) {
    const { parsed } = await parseWorkshopExcel(await file.arrayBuffer())
    return { kind: IMPORT_KIND.workshop, parsed }
  }
  return sniffImport(await file.text())
}

/**
 * @returns {{kind: 'account', result: object} | {kind: 'profile', parsed: object}}
 * @throws {Error} 文件不是 JSON、不是对象、或 format 不认识
 */
export function sniffImport(text) {
  let raw
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('不是有效的 JSON 文件')
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('文件内容不是一个对象')
  }

  if (raw.format === ACCOUNT_FORMAT) {
    const result = parseAccountExport(text)
    if (!result.ok) throw new Error(result.errors.join('；'))
    return { kind: IMPORT_KIND.account, result }
  }

  if (raw.format === PROFILE_FORMAT) {
    const parsed = parseProfile(text)
    if (!parsed.count) throw new Error('档案里没有角色记录')
    return { kind: IMPORT_KIND.profile, parsed }
  }

  throw new Error(
    `认不出这个文件（format=${raw.format ?? '缺失'}）。只支持本工具导出的「档案」、油猴脚本导出的「账号数据」，或 NIKKE Workshop 导出的图鉴 xlsx`,
  )
}
