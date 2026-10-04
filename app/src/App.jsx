import { useCallback, useState } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import AccountImportDialog from './components/AccountImportDialog.jsx'
import BackToTop from './components/BackToTop.jsx'
import ImportDropLayer from './components/ImportDropLayer.jsx'
import ProfileImportFlow from './components/ProfileImportFlow.jsx'
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
import { IMPORT_KIND } from './lib/importSniff.js'
import { shouldShowUpdateNotice } from './lib/updateNotice.js'

/** 拖放导入统一落到这一页：它订阅了存档变更，导入完列表会立刻刷新 */
const IMPORT_LANDING_PATH = '/profiles'

export default function App() {
  const navigate = useNavigate()
  const location = useLocation()
  // 进页面时按版本号判断要不要弹「版本更新」（只在挂载时判断一次）
  const [showUpdate, setShowUpdate] = useState(() => shouldShowUpdateNotice())
  /** 拖放进来的文件识别结果；非空时按 kind 弹对应的确认框 */
  const [dropped, setDropped] = useState(null)
  const [notice, setNotice] = useState('')

  const handleSniffed = useCallback((sniffed) => {
    setNotice('')
    setDropped(sniffed)
    // 导入会新建/切换当前存档，属于存档级操作。别的页面的状态是挂载时读一次的，
    // 就地导入会让它们停留在旧存档（数据录入页尤其危险），所以统一带到存档管理页完成。
    if (location.pathname !== IMPORT_LANDING_PATH) navigate(IMPORT_LANDING_PATH)
  }, [location.pathname, navigate])

  const handleDropError = useCallback((message) => {
    setDropped(null)
    setNotice(message)
  }, [])

  const finishProfileImport = (result, label) => {
    setDropped(null)
    setNotice(`已导入 ${result.imported} 个角色记录到${label}`)
  }

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
      <ImportDropLayer onSniffed={handleSniffed} onError={handleDropError} />

      {dropped?.kind === IMPORT_KIND.account ? (
        // 拖放场景：把已解析好的结果直接传进去，弹窗一开就是确认态，不用再拖一次
        <AccountImportDialog
          initial={dropped.result}
          onProfileParsed={(parsed) => setDropped({ kind: IMPORT_KIND.profile, parsed })}
          onClose={() => setDropped(null)}
        />
      ) : null}
      {dropped?.kind === IMPORT_KIND.profile ? (
        <ProfileImportFlow
          parsed={dropped.parsed}
          onDone={finishProfileImport}
          onClose={() => setDropped(null)}
        />
      ) : null}

      {notice ? (
        <div className="drop-toast" role="status">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice('')} aria-label="关闭">×</button>
        </div>
      ) : null}

      {showUpdate ? <UpdateNoticeDialog onClose={() => setShowUpdate(false)} /> : null}
    </>
  )
}
