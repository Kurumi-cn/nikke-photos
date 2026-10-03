// 「版本更新」提示的已读状态
//
// 弹不弹只看版本号：用户上次读到的版本号 ≠ 当前版本 → 弹（见 data/changelog.js）。
// 关闭提示时**只有勾了「不再提醒」**才记录版本号，没勾就什么都不写，下次进页面还会弹。
import { CURRENT_VERSION } from '../data/changelog.js'

const SEEN_KEY = 'nikke-photos/update-notice/v1'

/** 用户上次读到的版本号；没读过（或读不到）返回 null */
export const readSeenVersion = () => {
  try {
    return localStorage.getItem(SEEN_KEY)
  } catch {
    // 隐私模式等存储不可用：当作没读过，提示照弹
    return null
  }
}

export const markVersionSeen = (version) => {
  try {
    localStorage.setItem(SEEN_KEY, String(version))
  } catch {
    // 存不下也就算了，最多下次再提示一遍
  }
}

/** 是否需要弹更新提示 */
export const shouldShowUpdateNotice = () => readSeenVersion() !== CURRENT_VERSION
