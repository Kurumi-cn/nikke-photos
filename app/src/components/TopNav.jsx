import { useEffect, useState } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { CURRENT_VERSION } from '../data/changelog.js'
import { getCurrentProfile, subscribeProfiles } from '../lib/profileStore.js'

/**
 * 顶部导航：tab 位预留，后续新增页签直接往 tabs 里加 <NavLink> 即可。
 * 右侧显示当前存档（可点击进入存档管理）与版本号。
 */
export default function TopNav() {
  const [profile, setProfile] = useState(() => getCurrentProfile())

  // 常驻组件：切换 / 改名后要即时刷新，因此订阅存档变更而不是只在挂载时读一次
  useEffect(() => subscribeProfiles(() => setProfile(getCurrentProfile())), [])

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <div className="brand">
          <span className="dot" />
          NIKKE Photos
        </div>
        <nav className="tabs">
          <NavLink to="/" className={({ isActive }) => (isActive ? 'tab active' : 'tab')}>
            角色列表
          </NavLink>
          <NavLink to="/my-nikke" className={({ isActive }) => (isActive ? 'tab active' : 'tab')}>
            我的妮姬
          </NavLink>
          <NavLink to="/data" className={({ isActive }) => (isActive ? 'tab active' : 'tab')}>
            数据录入
          </NavLink>
          <NavLink to="/my" className={({ isActive }) => (isActive ? 'tab active' : 'tab')}>
            更多
          </NavLink>
        </nav>
        <div className="topbar-right">
          <Link className="current-profile" to="/profiles" title="切换 / 管理存档">
            当前存档：<strong>{profile.name}</strong>
          </Link>
          <span className="version">v{CURRENT_VERSION}</span>
        </div>
      </div>
    </header>
  )
}
