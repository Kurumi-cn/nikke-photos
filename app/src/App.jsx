import { useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import BackToTop from './components/BackToTop.jsx'
import TopNav from './components/TopNav.jsx'
import UpdateNoticeDialog from './components/UpdateNoticeDialog.jsx'
import BotSharePage from './pages/BotSharePage.jsx'
import ChangelogPage from './pages/ChangelogPage.jsx'
import CharacterListPage from './pages/CharacterListPage.jsx'
import CharacterPage from './pages/CharacterPage.jsx'
import DataEntryPage from './pages/DataEntryPage.jsx'
import MyNikkePage from './pages/MyNikkePage.jsx'
import MyPage from './pages/MyPage.jsx'
import ProfilesPage from './pages/ProfilesPage.jsx'
import SchemesPage from './pages/SchemesPage.jsx'
import StatsPage from './pages/StatsPage.jsx'
import { shouldShowUpdateNotice } from './lib/updateNotice.js'

export default function App() {
  // 进页面时按版本号判断要不要弹「版本更新」（只在挂载时判断一次）
  const [showUpdate, setShowUpdate] = useState(() => shouldShowUpdateNotice())

  return (
    <>
      <TopNav />
      <Routes>
        <Route path="/" element={<CharacterListPage />} />
        <Route path="/character/:code" element={<CharacterPage />} />
        <Route path="/data" element={<DataEntryPage />} />
        <Route path="/my-nikke" element={<MyNikkePage />} />
        <Route path="/my" element={<MyPage />} />
        <Route path="/profiles" element={<ProfilesPage />} />
        <Route path="/schemes" element={<SchemesPage />} />
        <Route path="/bot-share" element={<BotSharePage />} />
        <Route path="/stats" element={<StatsPage />} />
        <Route path="/changelog" element={<ChangelogPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <BackToTop />
      {showUpdate ? <UpdateNoticeDialog onClose={() => setShowUpdate(false)} /> : null}
    </>
  )
}
