// 更多：功能入口集合
import { Link } from 'react-router-dom'
import { t } from '../lib/i18n.js'

const ENTRIES = [
  {
    to: '/profiles',
    title: '存档管理',
    desc: '新建、切换、重命名或删除存档；查看每个存档已完善的角色',
  },
  {
    to: '/bot-share',
    title: 'BOT 分享',
    desc: '导出角色数据分享码和表格码，粘贴给 QQ 机器人出面板图与练度统计表',
  },
  {
    to: '/schemes',
    title: '方案管理',
    desc: '预先存好一组默认值（基础 / 研究所与技能 / 魔方与收藏品），在数据录入页一键应用到角色',
  },
  {
    to: '/changelog',
    title: '更新记录',
    desc: '查看历史版本都改了些什么',
  },
]

export default function MyPage() {
  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>{t('更多')}</h1>
          <div className="desc">{t('常用功能入口')}</div>
        </div>
      </div>
      <div className="my-grid">
        {ENTRIES.map((entry) => (
          <Link key={entry.to} className="my-card" to={entry.to}>
            <b>{t(entry.title)}</b>
            <span>{t(entry.desc)}</span>
          </Link>
        ))}
      </div>
    </main>
  )
}