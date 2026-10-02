// 更多：功能入口集合
import { Link } from 'react-router-dom'

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
    to: '/stats',
    title: '词条统计',
    desc: '把已录入角色的装备词条累加值汇总成表，支持按属性排列、拖拽排序与导出图片',
  },
]

export default function MyPage() {
  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>更多</h1>
          <div className="desc">常用功能入口</div>
        </div>
      </div>
      <div className="my-grid">
        {ENTRIES.map((entry) => (
          <Link key={entry.to} className="my-card" to={entry.to}>
            <b>{entry.title}</b>
            <span>{entry.desc}</span>
          </Link>
        ))}
      </div>
    </main>
  )
}