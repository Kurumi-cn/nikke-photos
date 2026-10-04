// 「导入账号/档案数据」弹窗：统一收三种 JSON ——
//   ① 油猴脚本导出的账号数据：本弹窗内直接确认新建 / 覆盖；
//   ② 本工具导出的档案、③ 旧版无 format 的裸 characters 对象：交给 onProfileParsed，
//      由调用方打开 ProfileImportFlow 走「覆盖哪个存档 / 新建存档」两步流程。
//
// 入口放在「存档管理」页而不是「数据录入」页：导入会新建存档并切换当前存档，
// 这是存档级操作；而数据录入页的状态是挂载时读一次的、没订阅存档变更，
// 在那里做导入会让页面状态与当前存档错位（改一格就会把旧存档的记录写进新存档）。
import { useRef, useState } from 'react'
import ConfirmDialog from './ConfirmDialog.jsx'
import NumField from './NumField.jsx'
import { ACCOUNT_FORMAT, parseAccountExport } from '../lib/accountImport.js'
import {
  NAME_MAX,
  PROFILE_FORMAT,
  importAsNewProfile,
  importIntoProfile,
  listProfiles,
  nextProfileName,
  parseProfile,
  setCurrentProfile,
} from '../lib/profileStore.js'
import { assetUrl } from '../lib/roster.js'
import '../styles/accountImport.css'

const SCRIPT_FILE = 'nikke-photos-import.user.js'

/** 重名时依次避让：`名字 (2)`、`名字 (3)`… */
const uniqueProfileName = (base, taken) => {
  if (!taken.includes(base)) return base
  const stem = base.slice(0, NAME_MAX - 6)
  let index = 2
  let candidate = `${stem} (${index})`
  while (taken.includes(candidate)) {
    index += 1
    candidate = `${stem} (${index})`
  }
  return candidate
}

/**
 * @param initial          拖放场景下已解析好的账号数据（parseAccountExport 产物），非空时直接进确认态
 * @param onProfileParsed  读到档案类文件时交出 parseProfile 产物，由调用方打开 ProfileImportFlow
 */
export default function AccountImportDialog({ onClose, initial = null, onProfileParsed }) {
  const fileRef = useRef(null)
  const [dragActive, setDragActive] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(initial)
  const [name, setName] = useState(() => (initial ? initial.parsed.name || nextProfileName() : ''))
  const [synchro, setSynchro] = useState(() => initial?.parsed?.synchroLevel ?? null)
  const [pending, setPending] = useState(null)
  const [done, setDone] = useState(null)

  const profiles = listProfiles()
  const trimmedName = name.trim()
  const sameNameProfile = trimmedName ? profiles.find((item) => item.name === trimmedName) : null
  // 「新建」分支下重名要避让，先算出来给用户看，别悄悄改名
  const newName = result ? uniqueProfileName(trimmedName || nextProfileName(), profiles.map((item) => item.name)) : ''

  const readFile = async (file) => {
    setError('')
    if (!file) return
    let text
    try {
      text = await file.text()
    } catch {
      setError('读取文件失败，请重试')
      return
    }
    let raw
    try {
      raw = JSON.parse(text)
    } catch {
      setError('不是有效的 JSON 文件')
      return
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      setError('文件内容不是一个对象')
      return
    }

    if (raw.format === ACCOUNT_FORMAT) {
      const parsed = parseAccountExport(text)
      if (!parsed.ok) {
        setResult(null)
        setError(parsed.errors.join('；'))
        return
      }
      setResult(parsed)
      setName(parsed.parsed.name || nextProfileName())
      setSynchro(parsed.parsed.synchroLevel)
      return
    }

    // 本工具导出的档案；无 format 的是旧版裸 characters 对象，parseProfile 本身兼容
    if (raw.format === PROFILE_FORMAT || raw.format == null) {
      try {
        const parsed = parseProfile(text)
        if (!parsed.count) throw new Error('文件里没有角色记录')
        onProfileParsed(parsed)
      } catch (problem) {
        setResult(null)
        setError(`读取失败：${problem?.message || problem}`)
      }
      return
    }

    setResult(null)
    setError(`认不出这个文件（format=${raw.format}）。只支持油猴脚本导出的「账号数据」或本工具导出的「档案」`)
  }

  /** 落库：两个分支都要保证「导入完就是当前存档」 */
  const commit = () => {
    const parsed = { ...result.parsed, name: trimmedName, synchroLevel: synchro }
    try {
      if (pending.mode === 'overwrite') {
        const applied = importIntoProfile(pending.id, parsed)
        // importIntoProfile 只替换角色数据，不会把那个存档切为当前存档
        setCurrentProfile(pending.id)
        setDone({ profileName: pending.name, imported: applied.imported, unknown: applied.unknown, overwritten: true })
      } else {
        const applied = importAsNewProfile(parsed, { name: newName, synchroLevel: synchro })
        setDone({ profileName: applied.profile.name, imported: applied.imported, unknown: applied.unknown, overwritten: false })
      }
      setPending(null)
    } catch (problem) {
      setPending(null)
      setError(String(problem?.message || problem))
    }
  }

  const notices = result?.report?.notices ?? []
  const unmatched = result?.parsed?.unknown ?? []

  return (
    <div
      className="dlg-mask"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="dlg dlg-wide" role="dialog" aria-label="导入账号/档案数据">
        <div className="dlg-head">
          <h2>导入账号/档案数据</h2>
          <button type="button" className="dlg-x" onClick={onClose} aria-label="关闭">×</button>
        </div>

        <div className="dlg-body dlg-body-scroll">
          {done ? (
            <>
              <p className="dlg-text">
                已{done.overwritten ? '更新' : '创建'}存档「<strong>{done.profileName}</strong>」并切换为当前存档，
                写入 <strong>{done.imported}</strong> 个角色{done.unknown.length ? `，跳过 ${done.unknown.length} 个图鉴未收录的角色` : ''}。
              </p>
              {notices.length > 0 ? (
                <>
                  <p className="dlg-text">导入时的处理说明：</p>
                  <ul className="acc-notices">
                    {notices.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </>
              ) : null}
              <p className="import-hint">角色数据已按下表口径写入；如果需要修改，去「数据录入」页编辑即可。</p>
            </>
          ) : result ? (
            <>
              <div className="dlg-row">
                <span className="dlg-label">存档名</span>
                <input
                  className="dlg-input"
                  value={name}
                  maxLength={NAME_MAX}
                  placeholder="存档名称"
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
              <NumField
                label="同步器等级"
                rangeKey="synchro"
                value={synchro}
                onChange={setSynchro}
                hint="存档级：全体妮姬共用"
              />

              <div className="acc-stats">
                <div><span>来源</span><b>BlaBlaLink{result.meta.areaId ? ` · area ${result.meta.areaId}` : ''}</b></div>
                <div><span>导出时间</span><b>{result.meta.stamp || '未知'}</b></div>
                <div><span>将写入角色</span><b>{result.parsed.count} 个</b></div>
                <div><span>图鉴未收录</span><b>{unmatched.length} 个</b></div>
              </div>

              {notices.length > 0 ? (
                <ul className="acc-notices">
                  {notices.map((item) => <li key={item}>{item}</li>)}
                </ul>
              ) : (
                <p className="import-hint">没有需要特别说明的处理，数据都能直接对上。</p>
              )}

              <p className="import-hint">
                导入会新建或替换一个存档；当前档不会被动到，导入完成后会自动切到新存档。
              </p>
            </>
          ) : (
            <>
              <p className="dlg-text">
                BlaBlaLink 账号数据需要先在浏览器里装一个油猴脚本：
                脚本在你的浏览器内直接向官方接口取数，数据只留在本机，不会上传到任何服务器。
              </p>
              <div
                className={dragActive ? 'ocr-drop active' : 'ocr-drop'}
                onDragOver={(event) => {
                  event.preventDefault()
                  setDragActive(true)
                }}
                onDragLeave={() => setDragActive(false)}
                onDrop={(event) => {
                  event.preventDefault()
                  setDragActive(false)
                  readFile([...(event.dataTransfer?.files || [])][0])
                }}
              >
                <p className="ocr-drop-text">
                  把 BlaBlaLink 账号导出的 JSON（油猴脚本）或本工具导出的档案拖拽至此，或选择本地文件
                </p>
                <div className="ocr-drop-actions">
                  <button type="button" className="btn btn-sm" onClick={() => fileRef.current?.click()}>选择文件</button>
                </div>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept=".json,application/json"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  readFile(file)
                }}
              />
              <p className="import-hint">
                还没装脚本？
                <a href={assetUrl(SCRIPT_FILE)} target="_blank" rel="noreferrer">下载油猴脚本</a>
                （需要浏览器先装 Tampermonkey；脚本装好后在 BlaBlaLink 页面点「导出到 NIKKE Photos」）。
              </p>
            </>
          )}

          {error ? <p className="dlg-error">{error}</p> : null}
        </div>

        <div className="dlg-foot">
          {done ? (
            <button type="button" className="btn btn-primary" onClick={onClose}>完成</button>
          ) : result ? (
            <>
              <button type="button" className="btn" onClick={() => { setResult(null); setError('') }}>重新选择文件</button>
              {sameNameProfile ? (
                <button
                  type="button"
                  className="btn"
                  onClick={() => setPending({ mode: 'overwrite', id: sameNameProfile.id, name: sameNameProfile.name })}
                >
                  覆盖「{sameNameProfile.name}」存档
                </button>
              ) : null}
              <button
                type="button"
                className="btn btn-primary"
                disabled={!trimmedName}
                title={trimmedName ? '' : '存档名不能为空'}
                onClick={() => setPending({ mode: 'new' })}
              >
                新建存档
              </button>
            </>
          ) : (
            <button type="button" className="btn" onClick={onClose}>取消</button>
          )}
        </div>
      </div>

      {pending ? (
        <ConfirmDialog
          title={pending.mode === 'overwrite' ? '覆盖这个存档？' : '新建存档并导入？'}
          danger={pending.mode === 'overwrite'}
          confirmText={pending.mode === 'overwrite' ? '覆盖' : '新建并导入'}
          message={pending.mode === 'overwrite' ? (
            <p className="dlg-text">
              将用导入的数据替换存档「<strong>{pending.name}</strong>」的角色数据：该存档里<b>其他角色的记录会被清掉</b>，
              只保留这次导入的 {result?.parsed.count} 个角色；存档名与备注不变。此操作无法撤销。
            </p>
          ) : (
            <p className="dlg-text">
              将新建存档「<strong>{newName}</strong>」（同步器等级 {synchro}）并切换为当前存档，
              写入 {result?.parsed.count} 个角色。原有存档不受影响。
              {newName !== trimmedName ? '（该名称已被占用，已自动加上序号）' : ''}
            </p>
          )}
          onConfirm={commit}
          onClose={() => setPending(null)}
        />
      ) : null}
    </div>
  )
}
