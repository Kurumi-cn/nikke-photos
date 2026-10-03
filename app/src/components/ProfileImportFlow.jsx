// 「档案导入」的两步流程：先选「覆盖某个存档 / 新建存档并导入」，再填新建存档的名称与同步器等级。
// 角色列表页的「导入档案」按钮与全局拖放导入共用这一份实现，避免同一套判断写两遍。
import { useState } from 'react'
import ImportDialog from './ImportDialog.jsx'
import ProfileDialog from './ProfileDialog.jsx'
import {
  getCurrentProfileId,
  importAsNewProfile,
  importIntoProfile,
  listProfiles,
  nextProfileName,
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
      const name = listProfiles().find((item) => item.id === id)?.name || '存档'
      onDone(importIntoProfile(id, parsed), `「${name}」`)
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
        initial={{ name: draft.name || nextProfileName(), synchroLevel: draft.synchroLevel, remark: draft.remark }}
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
