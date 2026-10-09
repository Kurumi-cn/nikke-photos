// 数值输入框（数据录入表单与「方案管理」弹窗共用）
//
// 校验契约（配套 fieldRanges.js 的范围真源）：
//   - **空** → 合法，写入 `null`（「未填」是合法状态，不能报成越界）
//   - **范围内整数** → 合法，立即 `onChange`（所以自动保存拿到的永远是合法值）
//   - **越界 / 非整数** → **不调 `onChange`**，模型保持上一个合法值；输入框保留用户原文
//     + 红框 + 提示，直到改成合法值（刻意不自动改写用户的输入）
//
// 输入框自己持有一份草稿文本，这样「清空重打」不会被 min 值堵住；
// 外部 value 变化（切角色 / 恢复到示例数据）时重置草稿，但**聚焦中不重置**，免得打字被打断。
import { useEffect, useRef, useState } from 'react'
import { t } from '../lib/i18n.js'
import { FIELD_RANGES, isEmptyValue, isInRange, rangeText } from '../lib/fieldRanges.js'

export const toInput = (value) => (value === null || value === undefined ? '' : String(value))

export const parseNumber = (raw) => {
  if (raw === '' || raw === null) return null
  const number = Number(raw)
  return Number.isFinite(number) ? number : null
}

export default function NumField({ label, value, onChange, rangeKey, hint, onValidityChange }) {
  const range = FIELD_RANGES[rangeKey]
  const [draft, setDraft] = useState(toInput(value))
  const [message, setMessage] = useState('')
  const focusedRef = useRef(false)

  useEffect(() => {
    if (focusedRef.current) return
    setDraft(toInput(value))
    setMessage('')
    // 外部值合法（能进来的一定合法），所以重置即恢复「无错误」
    onValidityChange?.(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const handleChange = (raw) => {
    setDraft(raw)
    /** 统一出口：错误文案与「当前是否合法」一起上报（方案弹窗靠它决定保存按钮是否可点） */
    const report = (text) => {
      setMessage(text)
      onValidityChange?.(!text)
    }
    if (isEmptyValue(raw)) {
      report('')
      onChange(null)
      return
    }
    const next = parseNumber(raw)
    if (next === null) {
      report(t('请输入数字'))
      return
    }
    if (!Number.isInteger(next)) {
      report(t('请输入整数'))
      return
    }
    if (isInRange(rangeKey, next)) {
      report('')
      onChange(next)
      return
    }
    report(t('输入越界！范围 {range}', { range: rangeText(rangeKey) }))
  }

  return (
    <label className="form-row">
      <span className="form-label">{t(label)}</span>
      <input
        className={message ? 'inp is-invalid' : 'inp'}
        type="number"
        value={draft}
        min={range.min}
        max={range.max}
        step="1"
        placeholder={rangeText(rangeKey)}
        aria-invalid={message ? 'true' : undefined}
        onFocus={() => { focusedRef.current = true }}
        onBlur={() => { focusedRef.current = false }}
        onChange={(event) => handleChange(event.target.value)}
      />
      {message
        ? <span className="form-error">{message}</span>
        : (hint ? <span className="form-hint">{t(hint)}</span> : null)}
    </label>
  )
}
