// 主题（浅色 / 深色）管理
//
// 约定：首访不写存储、跟随系统 prefers-color-scheme；用户手动切换后记住选择。
// 首屏防闪在 index.html 的内联脚本里做（key 与这里保持一致，改一处要同步另一处）。
const KEY = 'nikke-photos:theme'

export const THEME_LIGHT = 'light'
export const THEME_DARK = 'dark'

/** 系统偏好（读不到时按浅色处理） */
export function systemTheme() {
  try {
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? THEME_DARK : THEME_LIGHT
  } catch {
    return THEME_LIGHT
  }
}

/** 当前生效的主题：用户手动选过就用用户的，否则跟随系统 */
export function currentTheme() {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === THEME_LIGHT || saved === THEME_DARK) return saved
  } catch {
    // 隐私模式等场景下存储不可用，退回系统偏好
  }
  return systemTheme()
}

/** 用户是否手动选过主题（没选过时应跟随系统变化） */
export function hasManualTheme() {
  try {
    const saved = localStorage.getItem(KEY)
    return saved === THEME_LIGHT || saved === THEME_DARK
  } catch {
    return false
  }
}

/** 手动切换：写入存储并应用到 html 根节点 */
export function setTheme(theme) {
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    // 存储不可用也不影响本次会话内的切换
  }
  document.documentElement.setAttribute('data-theme', theme)
}