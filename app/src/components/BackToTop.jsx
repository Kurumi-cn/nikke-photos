import { useEffect, useState } from 'react'

/** 回到顶部：滚动一定距离后出现，点击平滑回顶（全局挂在 App 下） */
export default function BackToTop() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 400)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <button
      type="button"
      className={visible ? 'back-to-top show' : 'back-to-top'}
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      title="回到顶部"
      aria-label="回到顶部"
      aria-hidden={!visible}
      tabIndex={visible ? 0 : -1}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M8 12.5v-9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M4 7l4-4 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      回到顶部
    </button>
  )
}