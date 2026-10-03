// 版本更新记录（应用内展示的唯一版本真源）
//
// 发新版本时只改这一处：
//   1) 在 CHANGELOG **最前面**插入一条（新的在上，日期用 `YYYY-MM-DD`）
//   2) 同步改 app/package.json 的 version
//
// 「版本更新」提示弹不弹只看一件事：用户上次读到的版本号是否等于 CURRENT_VERSION
// （见 lib/updateNotice.js）。所以只要在这里加了新版本，所有人下次进页面就会看到提示。

/** 更新记录，新的在最前面（items 会按 `1、2、…` 自动编号展示） */
export const CHANGELOG = [
  {
    version: '1.0',
    date: '2026-10-03',
    items: [
      '新增数据录入页面方案管理，通过预先设置的数据内容快速填写信息。',
      '其他优化。',
    ],
  },
]

/** 当前版本 = 最新的一条；改 CHANGELOG 就会跟着变，不要再单独写版本号 */
export const CURRENT_VERSION = CHANGELOG[0].version

/** 加版本号之前的历史同样算「上一个版本」，只用于「v0.1 → v1.0」里的前半段 */
export const BASELINE_VERSION = '0.1'

/** `2026-10-03` → `2026/10/03`（只为了好看，展示用的唯一入口） */
export const displayDate = (date) => String(date || '').replaceAll('-', '/')
