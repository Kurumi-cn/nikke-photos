// 表格署名：全局一份，存在本机浏览器里——不跟存档、不跟会话
//
// 它是"制表人"的标识（显示在导出图片的左上角那格），不是某个存档的数据；
// 换存档、换个页面会话都应该还是同一个名字。
const KEY = 'nikke-photos:stats-credit'

/** 署名长度上限：与输入框 maxLength 一致（两行装不下，从源头挡住极长内容） */
export const CREDIT_MAX = 20

export function loadStatsCredit() {
  try {
    return String(localStorage.getItem(KEY) || '').slice(0, CREDIT_MAX)
  } catch {
    // 隐私模式等场景下存储不可用，当作没填过
    return ''
  }
}

export function saveStatsCredit(text) {
  try {
    localStorage.setItem(KEY, String(text || '').slice(0, CREDIT_MAX))
  } catch {
    // 同上，存储不可用时静默忽略
  }
}