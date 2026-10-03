// 全局拖放导入：把 JSON 拖到页面任意位置，自动认出它是「档案」还是「BlaBlaLink 账号数据」。
//
// 这里只负责「拖 + 认」，不负责「导」：认出之后交给 App 决定去哪一页、弹哪个确认框。
//
// 两个必须注意的点：
//   1. dragover 一定要 preventDefault，否则浏览器会把投放当成"用浏览器打开这个文件"；
//   2. 落在已打开的弹窗内的拖放直接放行 —— 账号导入、装备识别那些弹窗自带投放区，
//      不拦的话同一次投放会被处理两遍。
import { useEffect, useRef, useState } from 'react'
import { sniffImport } from '../lib/importSniff.js'
import '../styles/importDrop.css'

const carriesFiles = (event) => Array.from(event.dataTransfer?.types || []).includes('Files')

/** 投放落点是否在某个弹窗里（弹窗有自己的投放区，交给它们处理） */
const insideDialog = (event) => event.target instanceof Element && event.target.closest('.dlg-mask') !== null

export default function ImportDropLayer({ onSniffed, onError }) {
  const [active, setActive] = useState(false)
  // dragenter / dragleave 会随着鼠标进出页面内的每个元素反复触发，只能靠计数判断"真的离开了窗口"
  const depthRef = useRef(0)

  useEffect(() => {
    const reset = () => {
      depthRef.current = 0
      setActive(false)
    }

    const onDragEnter = (event) => {
      if (!carriesFiles(event) || insideDialog(event)) return
      depthRef.current += 1
      setActive(true)
    }

    const onDragOver = (event) => {
      if (!carriesFiles(event)) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    }

    const onDragLeave = (event) => {
      if (!carriesFiles(event)) return
      depthRef.current = Math.max(0, depthRef.current - 1)
      if (depthRef.current === 0) setActive(false)
    }

    const onDrop = async (event) => {
      if (!carriesFiles(event)) return
      // 弹窗内已有处理逻辑（它自己会 preventDefault），这里不接管
      if (event.defaultPrevented || insideDialog(event)) {
        reset()
        return
      }
      event.preventDefault()
      reset()
      const file = event.dataTransfer?.files?.[0]
      if (!file) return

      let text
      try {
        text = await file.text()
      } catch {
        onError(`读取 ${file.name} 失败，请重试`)
        return
      }
      try {
        onSniffed(sniffImport(text), file.name)
      } catch (problem) {
        onError(`${file.name}：${problem?.message || problem}`)
      }
    }

    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [onSniffed, onError])

  if (!active) return null

  return (
    <div className="drop-layer">
      <div className="drop-layer-box">
        <b>松手即导入</b>
        <span>支持本工具导出的「档案」，以及油猴脚本导出的「BlaBlaLink 账号数据」</span>
      </div>
    </div>
  )
}
