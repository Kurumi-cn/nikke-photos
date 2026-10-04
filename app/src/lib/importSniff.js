// 拖放导入的分流器：只读文件里的 format 标识，判断它属于哪条导入链路。
//
//   本工具导出的档案       → profileStore.parseProfile + profileStore.importIntoProfile/importAsNewProfile
//   油猴脚本导出的账号数据 → accountImport.parseAccountExport + 同一对写入函数
//
// 没有 format 的一律拒绝，不做"猜"：把一份恰好以角色号为键的陌生 JSON 猜成档案导进来，
// 用户拿到的是一个说不出哪里错的半成品存档，比直接报错糟得多。
// （旧版裸 characters 对象仍可在存档管理页的「导入账号/档案数据」弹窗里选文件导入，那条路是用户主动选的，不存在误判。）
import { ACCOUNT_FORMAT, parseAccountExport } from './accountImport.js'
import { PROFILE_FORMAT, parseProfile } from './profileStore.js'

export const IMPORT_KIND = { account: 'account', profile: 'profile' }

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
    `认不出这个文件（format=${raw.format ?? '缺失'}）。只支持本工具导出的「档案」，或油猴脚本导出的「账号数据」`,
  )
}
