// 语言（locale）管理 + 界面文案取词
//
// 约定（与 theme.js 同一套模式）：
//   · 首访不写存储：跟随浏览器语言（zh-TW / zh-HK / zh-MO → 繁体，其余按简体）
//   · 手动切换后记住选择（localStorage）
//   · ?lang=zh-Hant（或 zh-Hans）只覆盖本次访问、不写存储，供分享链接用；
//     HashRouter 下参数通常落在 #/path?lang=xx 里，两处都认
//   · 首屏防闪在 index.html 的内联脚本里做（key 与这里保持一致，改一处要同步另一处）
//
// 文案机制：**以简体原文当 key**（t('保存')）。繁体字典只写与简体不同的条目，
// 缺条目自动回退原文 —— 不会出现空白或报错，迁移可以渐进；数据层名词走 hant.js 的字形转换。
import { ZH_HANT } from '../locales/zh-Hant.js'
import { toHant } from './hant.js'

const KEY = 'nikke-photos:locale'
export const LOCALE_HANS = 'zh-Hans'
export const LOCALE_HANT = 'zh-Hant'

const HANT_LANGS = new Set(['zh-tw', 'zh-hk', 'zh-mo', 'zh-hant'])

/** 浏览器语言 → 我们的 locale（非中文环境按简体处理：这个工具的用户都是中文玩家） */
export function systemLocale() {
  try {
    const list = navigator.languages?.length ? navigator.languages : [navigator.language]
    for (const raw of list) {
      const lang = String(raw || '').toLowerCase()
      if (HANT_LANGS.has(lang)) return LOCALE_HANT
      if (lang.startsWith('zh')) return LOCALE_HANS
    }
  } catch {
    // 无 navigator（Node 检查脚本）等场景
  }
  return LOCALE_HANS
}

const normalizeLocale = (raw) => {
  const value = String(raw || '').toLowerCase()
  if (!value) return null
  if (value === 'zh-hant' || value === 'tw' || value === 'hant') return LOCALE_HANT
  if (value === 'zh-hans' || value === 'cn' || value === 'hans') return LOCALE_HANS
  return null
}

/** URL 上的 lang 参数（location.search 与 hash 里的查询串都认） */
function urlLocale() {
  try {
    const fromSearch = normalizeLocale(new URLSearchParams(window.location.search).get('lang'))
    if (fromSearch) return fromSearch
    const hash = String(window.location.hash || '')
    const query = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : ''
    if (query) return normalizeLocale(new URLSearchParams(query).get('lang'))
  } catch {
    // 无 window（Node 检查脚本）
  }
  return null
}

function savedLocale() {
  try {
    return normalizeLocale(localStorage.getItem(KEY))
  } catch {
    return null
  }
}

/** 用户是否手动选过语言（没选过时可以跟随浏览器语言变化） */
export const hasManualLocale = () => savedLocale() !== null

// ---- 运行时状态 + 订阅（组件重新渲染靠它） ----
let runtimeChoice = null // 本次会话里手动切过的语言（优先级最高，压过 URL 参数）
let active = null
const listeners = new Set()

const computeLocale = () => runtimeChoice ?? urlLocale() ?? savedLocale() ?? systemLocale()

/** 当前生效的语言 */
export function currentLocale() {
  if (!active) active = computeLocale()
  return active
}

/** 把语言写到 html 根节点（CSS 字体栈、lang 属性都看它） */
export function applyLocale(locale) {
  try {
    document.documentElement.setAttribute('data-locale', locale)
    document.documentElement.lang = locale === LOCALE_HANT ? 'zh-Hant' : 'zh-CN'
  } catch {
    // 无 document 时忽略（检查脚本）
  }
}

/** 手动切换：写入存储、应用到根节点、通知订阅方 */
export function setLocale(locale) {
  runtimeChoice = locale
  try {
    localStorage.setItem(KEY, locale)
  } catch {
    // 存储不可用也不影响本次会话内的切换
  }
  active = locale
  applyLocale(locale)
  for (const listener of listeners) listener(locale)
}

export function subscribeLocale(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** 界面文案：简体原文当 key；字典缺条目时用「词级术语表 + 字形映射」兜底（不露出简体）
 *  带占位符时用 t('已导入 {count} 个角色', { count })：整句进字典，插入值原样替换 */
export function t(source, params) {
  const text = currentLocale() === LOCALE_HANT ? (ZH_HANT[source] ?? toHant(source)) : source
  if (!params) return text
  return text.replace(/\{(\w+)\}/g, (whole, key) => (key in params ? String(params[key]) : whole))
}

/** 数据层名词（角色名 / 皮肤名 / 词条名 / 分类标签 / 魔方名…）：例外表 → 字符映射 → 原文 */
export function tData(text) {
  if (currentLocale() !== LOCALE_HANT) return text
  return toHant(text)
}