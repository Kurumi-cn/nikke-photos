import { useEffect, useState } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { CURRENT_VERSION } from '../data/changelog.js'
import { getCurrentProfile, subscribeProfiles } from '../lib/profileStore.js'
import { THEME_DARK, THEME_LIGHT, currentTheme, hasManualTheme, setTheme } from '../lib/theme.js'

const TABS = [
  { to: '/', label: '角色列表' },
  { to: '/my-nikke', label: '我的妮姬' },
  { to: '/data', label: '数据录入' },
  { to: '/stats', label: '词条统计' },
  { to: '/my', label: '更多' },
]

/** 月亮 = 切到夜间；太阳 = 切回白天（图标显示"点下去会变成什么"） */
function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M13.4 9.6A5.2 5.2 0 0 1 6.4 2.6a5.7 5.7 0 1 0 7 7Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  )
}

function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M8 1.6v1.6M8 12.8v1.6M1.6 8h1.6M12.8 8h1.6M3.5 3.5l1.1 1.1M11.4 11.4l1.1 1.1M12.5 3.5l-1.1 1.1M4.6 11.4l-1.1 1.1"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  )
}

/**
 * 顶部导航：宽屏是一排文字 Tab；窄屏（手机）收进左侧抽屉——
 * 「亖」按钮打开，抽屉里同时放当前存档入口与版本号（这些在手机顶栏放不下）。
 * 显隐全部由 CSS 断点控制：桌面下汉堡与抽屉都不显示，观感与从前一致。
 */
export default function TopNav() {
  const [profile, setProfile] = useState(() => getCurrentProfile())
  const [menuOpen, setMenuOpen] = useState(false)
  const [theme, setThemeState] = useState(() => currentTheme())

  // 常驻组件：切换 / 改名后要即时刷新，因此订阅存档变更而不是只在挂载时读一次
  useEffect(() => subscribeProfiles(() => setProfile(getCurrentProfile())), [])

  // 与首屏内联脚本对齐一次（极少数环境下，脚本在 head 里读到的系统偏好与 React 挂载时不同，
  // 这里以 React 读到的为准，避免"按钮文案说浅色、页面却是深色"的矛盾）
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', currentTheme())
  }, [])

  // 跟随系统：用户没手动选过时，系统外观变化（日落自动切换等）实时跟随；
  // 加载瞬间系统值未就绪的极端情况（内嵌浏览器常见）也会在被纠正时自动对齐
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!media) return undefined
    const onChange = (event) => {
      if (hasManualTheme()) return
      const next = event.matches ? THEME_DARK : THEME_LIGHT
      setThemeState(next)
      document.documentElement.setAttribute('data-theme', next)
    }
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  // 第三道对齐：个别内嵌浏览器的加载早期会给出与最终不同的系统偏好、且不发 change 事件，
  // 窗口 load 与挂载 1.2 秒后再各以最终值对齐一次；手动选过的用户不受影响（正常环境就是 no-op）
  useEffect(() => {
    const sync = () => {
      if (hasManualTheme()) return
      const next = currentTheme()
      setThemeState(next)
      document.documentElement.setAttribute('data-theme', next)
    }
    if (document.readyState === 'complete') sync()
    else window.addEventListener('load', sync, { once: true })
    const timer = window.setTimeout(sync, 1200)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('load', sync)
    }
  }, [])

  const toggleTheme = () => {
    const next = theme === THEME_DARK ? THEME_LIGHT : THEME_DARK
    setTheme(next)
    setThemeState(next)
  }

  // Escape 关闭抽屉（与站内弹窗同一套习惯）
  useEffect(() => {
    if (!menuOpen) return undefined
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [menuOpen])

  const closeMenu = () => setMenuOpen(false)

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <button type="button" className="nav-burger" onClick={() => setMenuOpen(true)} aria-label="打开导航菜单">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
            <path d="M3 5h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <path d="M3 9h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <path d="M3 13h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>

        <div className="brand">
          <span className="dot" />
          NIKKE Photos
        </div>
        <nav className="tabs">
          {TABS.map((item) => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => (isActive ? 'tab active' : 'tab')}>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="topbar-right">
          <button
            type="button"
            className="theme-toggle"
            onClick={toggleTheme}
            aria-label={theme === THEME_DARK ? '切换到浅色外观' : '切换到深色外观'}
            title={theme === THEME_DARK ? '切换到浅色外观' : '切换到深色外观'}
          >
            {theme === THEME_DARK ? <SunIcon /> : <MoonIcon />}
          </button>
          <Link className="current-profile" to="/profiles" title="切换 / 管理存档">
            当前存档：<strong>{profile.name}</strong>
          </Link>
          <span className="version">v{CURRENT_VERSION}</span>
        </div>
      </div>

      {menuOpen ? (
        <div
          className="nav-drawer-mask"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeMenu()
          }}
        >
          <nav className="nav-drawer" aria-label="导航菜单">
            <div className="nav-drawer-head">
              <span className="dot" />
              NIKKE Photos
            </div>

            <div className="nav-drawer-tabs">
              {TABS.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) => (isActive ? 'nav-drawer-tab active' : 'nav-drawer-tab')}
                  onClick={closeMenu}
                >
                  {item.label}
                </NavLink>
              ))}
            </div>

            <div className="nav-drawer-foot">
              <button type="button" className="nav-drawer-theme" onClick={toggleTheme}>
                {theme === THEME_DARK ? <SunIcon /> : <MoonIcon />}
                <span>切换到{theme === THEME_DARK ? '浅色' : '深色'}外观</span>
              </button>
              <Link className="nav-drawer-profile" to="/profiles" onClick={closeMenu}>
                当前存档：<strong>{profile.name}</strong>
              </Link>
              <span className="nav-drawer-version">v{CURRENT_VERSION}</span>
            </div>
          </nav>
        </div>
      ) : null}
    </header>
  )
}