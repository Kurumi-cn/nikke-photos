import { useEffect, useRef, useState } from 'react'
import { labelFor } from '../lib/roster.js'
import {
  NAME_MAX,
  REMARK_MAX,
  RESEARCH_CORPORATIONS,
  RESEARCH_MAX,
  RESEARCH_MIN,
  SYNCHRO_MAX,
  SYNCHRO_MIN,
  defaultResearch,
} from '../lib/profileStore.js'

// 企业研究按两行排布（行内顺序与规模由这里决定，不跟随筛选栏顺序）
const CORPORATION_ROWS = [
  ['ELYSION', 'MISSILIS'],
  ['TETRA', 'PILGRIM', 'ABNORMAL'],
]

/**
 * 新建 / 编辑存档弹窗（同一组件，标题不同）。
 * 由父组件用 key 控制挂载——打开时即为最新初值，避免编辑中途被重置。
 * mode: 'create' | 'edit'
 */
export default function ProfileDialog({ mode = 'create', initial, onClose, onSubmit }) {
  const [name, setName] = useState(() => initial?.name ?? '')
  const [level, setLevel] = useState(() => (initial?.synchroLevel == null ? '' : String(initial.synchroLevel)))
  const [research, setResearch] = useState(() => initial?.research ?? defaultResearch())
  const [remark, setRemark] = useState(() => initial?.remark ?? '')
  const [error, setError] = useState('')
  const nameRef = useRef(null)

  useEffect(() => {
    // 名称默认全选，方便直接改写
    const timer = window.setTimeout(() => {
      nameRef.current?.focus()
      nameRef.current?.select()
    }, 0)
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  const setResearchValue = (group, key, value) =>
    setResearch((prev) => ({ ...prev, [group]: { ...prev[group], [key]: value } }))

  /** 单个研究等级：留空视为未填；超范围或非整数视为非法 */
  const readResearch = (raw) => {
    if (raw === '' || raw === null || raw === undefined) return null
    const value = Number(raw)
    return Number.isInteger(value) && value >= RESEARCH_MIN && value <= RESEARCH_MAX ? value : null
  }

  /** 校验并把研究等级整理成完整表；不合法返回 null */
  const collectResearch = () => {
    const table = { class: {}, corporation: {} }
    for (const key of Object.keys(research.class || {})) {
      const value = readResearch(research.class[key])
      if (value === null) return null
      table.class[key] = value
    }
    for (const key of RESEARCH_CORPORATIONS) {
      const value = readResearch(research.corporation?.[key])
      if (value === null) return null
      table.corporation[key] = value
    }
    return Object.keys(table.class).length === 3 ? table : null
  }

  const submit = () => {
    const trimmed = name.trim()
    if (!trimmed) {
      setError('请输入存档名称（不能为空白）')
      nameRef.current?.focus()
      return
    }
    const value = Number(level)
    if (!Number.isInteger(value) || value < SYNCHRO_MIN || value > SYNCHRO_MAX) {
      setError(`同步器等级需为 ${SYNCHRO_MIN}–${SYNCHRO_MAX} 的整数`)
      return
    }
    const researchTable = collectResearch()
    if (!researchTable) {
      setError(`研究等级需为 ${RESEARCH_MIN}–${RESEARCH_MAX} 的整数，不能留空`)
      return
    }
    onSubmit({ name: trimmed, synchroLevel: value, research: researchTable, remark })
  }

  return (
    <div
      className="dlg-mask"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="dlg" role="dialog" aria-label={mode === 'create' ? '新建存档' : '编辑存档'}>
        <div className="dlg-head">
          <h2>{mode === 'create' ? '新建存档' : '编辑存档'}</h2>
          <button type="button" className="dlg-x" onClick={onClose} aria-label="关闭">×</button>
        </div>

        <div className="dlg-body dlg-body-scroll">
          <div className="dlg-row">
            <span className="dlg-label">名称</span>
            <input
              ref={nameRef}
              className="dlg-input"
              value={name}
              maxLength={NAME_MAX}
              placeholder="例如：主号"
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submit()
              }}
            />
          </div>

          <div className="dlg-row">
            <span className="dlg-label">同步器等级</span>
            <input
              className="dlg-input dlg-input-sm"
              type="number"
              min={SYNCHRO_MIN}
              max={SYNCHRO_MAX}
              value={level}
              placeholder={`${SYNCHRO_MIN}-${SYNCHRO_MAX}，必填`}
              onChange={(event) => setLevel(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submit()
              }}
            />
            <span className="dlg-hint">全体妮姬共用</span>
          </div>

          <div className="dlg-block">
            <div className="dlg-block-head">研究所等级</div>
            <div className="research-row">
              {['Attacker', 'Defender', 'Supporter'].map((key) => (
                <label className="research-cell" key={key}>
                  <span>{labelFor('class', key)}</span>
                  <input
                    className="inp"
                    type="number"
                    min={RESEARCH_MIN}
                    max={RESEARCH_MAX}
                    value={research.class?.[key] ?? ''}
                    onChange={(event) => setResearchValue('class', key, event.target.value)}
                  />
                </label>
              ))}
            </div>
            {CORPORATION_ROWS.map((row) => (
              <div className="research-row" key={row.join('-')}>
                {row.map((key) => (
                  <label className="research-cell" key={key}>
                    <span>{labelFor('corporation', key)}</span>
                    <input
                      className="inp"
                      type="number"
                      min={RESEARCH_MIN}
                      max={RESEARCH_MAX}
                      value={research.corporation?.[key] ?? ''}
                      onChange={(event) => setResearchValue('corporation', key, event.target.value)}
                    />
                  </label>
                ))}
              </div>
            ))}
            <p className="research-note">嫌麻烦的话研究等级随便填写就行</p>
          </div>

          <div className="dlg-row dlg-row-top">
            <span className="dlg-label">备注</span>
            <textarea
              className="dlg-input dlg-textarea"
              rows={3}
              maxLength={REMARK_MAX}
              value={remark}
              placeholder={`选填，最多 ${REMARK_MAX} 字`}
              onChange={(event) => setRemark(event.target.value)}
            />
          </div>

          {error ? <p className="dlg-error">{error}</p> : null}
        </div>

        <div className="dlg-foot">
          <button type="button" className="btn" onClick={onClose}>取消</button>
          <button type="button" className="btn btn-primary" onClick={submit}>
            {mode === 'create' ? '创建' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}
