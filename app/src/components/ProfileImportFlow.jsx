// 「档案导入」的两步流程：先选「覆盖某个存档 / 新建存档并导入」，再填新建存档的名称与同步器等级。
// 存档管理页的「导入账号/档案数据」弹窗与全局拖放导入共用这一份实现，避免同一套判断写两遍。
import { useState } from 'react'
import ImportDialog from './ImportDialog.jsx'
import ProfileDialog from './ProfileDialog.jsx'
import {
  getCurrentProfileId,
  importAsNewProfile,
  importIntoProfile,
  listProfiles,
  nextProfileName,
  nextWorkshopProfileName,
} from '../lib/profileStore.js'

/**
 * @param parsed    parseProfile 的产物
 * @param onDone    (result, targetLabel) 导入成功后回调，由调用方决定怎么提示
 * @param onClose   关闭整个流程
 */
export default function ProfileImportFlow({ parsed, onDone, onClose }) {
  /** 非空表示已经进到「填新建存档信息」这一步 */
  const [draft, setDraft] = useState(null)
  const [error, setError] = useState('')

  const overwrite = (id) => {
    try {
      const target = listProfiles().find((item) => item.id === id)
      // 导入文件里不含同步器等级时（如 Workshop 图鉴导入）保留目标存档的原值，不要把它清掉；
      // 档案 JSON / 账号数据都带同步器等级，走原样覆盖
      const payload = parsed.synchroLevel == null && target ? { ...parsed, synchroLevel: target.synchroLevel } : parsed
      onDone(importIntoProfile(id, payload), `「${target?.name || '存档'}」`)
    } catch (problem) {
      setError(`导入失败：${problem?.message || problem}`)
    }
  }

  const create = (values) => {
    try {
      onDone(importAsNewProfile(draft, values), `「${values.name}」`)
    } catch (problem) {
      setError(`导入失败：${problem?.message || problem}`)
    }
  }

  if (draft) {
    return (
      <ProfileDialog
        key="import-new"
        mode="create"
        initial={{
          // Workshop 图鉴导入按「workshop导入N」自动编号，其他导入沿用「存档N」
          name: draft.name || (draft.origin === 'workshop' ? nextWorkshopProfileName() : nextProfileName()),
          synchroLevel: draft.synchroLevel,
          remark: draft.remark,
        }}
        // 取消新建 → 退回上一步，而不是把整个导入丢掉
        onClose={() => setDraft(null)}
        onSubmit={create}
      />
    )
  }

  return (
    <ImportDialog
      key={`${parsed.count}-${parsed.name}`}
      parsed={parsed}
      profiles={listProfiles()}
      currentId={getCurrentProfileId()}
      error={error}
      onClose={onClose}
      onOverwrite={overwrite}
      onNew={() => { setDraft(parsed); setError('') }}
    />
  )
}
