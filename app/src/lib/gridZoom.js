/**
 * 网格缩放档位：「角色列表」与「我的妮姬」共用同一份偏好。
 *
 * 单独占一个 sessionStorage key，不和筛选状态混存——两个页面的筛选项并不相同
 * （「我的妮姬」没有属性下拉），存一起会互相覆盖。
 */
export const ZOOM_PRESETS = [
  { key: 's', label: '小', size: '76px' },
  { key: 'm', label: '中', size: '92px' },
  { key: 'l', label: '大', size: '112px' },
]

export const DEFAULT_ZOOM = 'm'

const ZOOM_KEY = 'nikke-photos:grid-zoom'

/** 读当前缩放档位；读不到或值不合法时返回默认档 */
export function loadGridZoom() {
  try {
    const raw = sessionStorage.getItem(ZOOM_KEY)
    return ZOOM_PRESETS.some((item) => item.key === raw) ? raw : DEFAULT_ZOOM
  } catch {
    // 隐私模式等场景下存储不可用，退回默认档
    return DEFAULT_ZOOM
  }
}

export function saveGridZoom(key) {
  try {
    sessionStorage.setItem(ZOOM_KEY, key)
  } catch {
    // 同上，存储不可用时静默忽略
  }
}
