import { Navigate, Route, Routes } from 'react-router-dom'
import BackToTop from './components/BackToTop.jsx'
import TopNav from './components/TopNav.jsx'
import BotSharePage from './pages/BotSharePage.jsx'
import CharacterListPage from './pages/CharacterListPage.jsx'
import CharacterPage from './pages/CharacterPage.jsx'
import DataEntryPage from './pages/DataEntryPage.jsx'
import MyNikkePage from './pages/MyNikkePage.jsx'
import MyPage from './pages/MyPage.jsx'
import ProfilesPage from './pages/ProfilesPage.jsx'
import StatsPage from './pages/StatsPage.jsx'

export default function App() {
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
        <Route path="/bot-share" element={<BotSharePage />} />
        <Route path="/stats" element={<StatsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <BackToTop />
    </>
  )
}