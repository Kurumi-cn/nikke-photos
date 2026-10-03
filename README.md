<img width="875" height="306" alt="NIKKE Photos" src="https://github.com/user-attachments/assets/a561987a-e99c-4ac2-8886-5887961a7145" />

# NIKKE Photos

妮姬（NIKKE）角色卡片生成与练度管理工具：纯前端网页应用（React 19 + Vite，无后端、无账号系统，数据只存在你的浏览器里）。

**在线使用**：https://kurumi-cn.github.io/nikke-photos/#/

## 功能一览

- **角色列表**：搜索（中文名 / 英文名 / 资源号 / 拼音首字母）+ 分类筛选（企业 / 爆裂阶段 / 武器 / 稀有度 / 属性 / 职业）+ 国服图鉴 / 珍藏品 / 超标准开关
- **角色卡**：736×1096 版式实时预览；收藏品、稀有度·突破、等级·名称等 10 个模块可独立开关；立绘支持多皮肤切换与位置微调；导出 1x / 2x / 3x PNG（白底或透明背景）
- **数据录入**：手填练度（等级 / 突破 / 好感度 / 战斗力 / 技能 / 魔方 / 收藏品 / 四件装备词条）；也支持**装备面板识图**（截图粘贴或拖入自动识别，在 1920×1080 分辨率下识别效果最佳）
- **我的妮姬 / 词条统计**：已完善角色按属性归类；多选角色生成词条汇总表，可导出图片与「表格配置码」
- **存档管理**：多存档（新建 / 切换 / 重命名 / 删除 / 备注），同步器等级与研究等级是存档级；整档 JSON 可导出 / 导入
- **方案管理**：预设一套录入默认值，一键应用到角色
- **BOT 分享**：导出分享码粘贴给 QQ 机器人，直接出角色面板图 / 练度统计表（分享码在本地编码，不含账号信息）
- 版本更新可在站内「更多 → 更新记录」查看

## 快速上手

1. 打开在线站点，在角色列表选一个角色；
2. 到「数据录入」把练度补齐——国际服账号不想手填的话，用下面的**油猴脚本**一键导入；
3. 回到角色页实时预览卡片，导出图片；或导出分享码发给 QQ BOT。

## 从 BlaBlaLink 导入账号数据（油猴脚本）

> 面向**国际服**玩家：不用再逐个角色手填。脚本在**你已登录 BlaBlaLink 的浏览器**里，读取**你自己账号**的妮姬数据（等级 / 突破 / 好感度 / 技能 / 魔方 / 收藏品 / 四件装备词条），导出成一个 JSON 文件；把 JSON 拖进本站即可**自动按游戏昵称建档并切换**。

### 使用方法

1. 安装浏览器扩展 **Tampermonkey**（油猴；Chrome / Edge / Firefox 均可）；
2. 安装脚本：打开 https://kurumi-cn.github.io/nikke-photos/nikke-photos-import.user.js，Tampermonkey 会弹出安装页，点「安装」；
3. 打开并登录 **https://www.blablalink.com**，页面右下角会出现「NIKKE Photos」面板，点「导出到 NIKKE Photos」，等它依次读取账号数据；
4. 浏览器会下载一个 `nikke-photos-<昵称>-<时间>.json` 文件；
5. 回到本站（任意页面），把 JSON 文件**拖进页面**；在弹窗里核对（存档名、同步器等级可改，可选「新建存档 / 覆盖同名存档」）→ 确认即完成导入。

> 脚本随本站一起发布，源码在仓库 `app/public/nikke-photos-import.user.js`，可自行审阅；`@downloadURL` 指向本站，脚本有新版本时 Tampermonkey 会提示更新。

### 隐私与风险提示

- 数据只在**本机**处理：脚本直连官方接口、导出的 JSON 只落到你的磁盘，**不上传任何第三方服务器**（本项目也没有服务端）；导出字段为白名单，**不含 Cookie / token / openid 等身份信息**。
- 依 NIKKE 官方服务条款，未经授权用第三方程序采集游戏数据存在风险；脚本只在你点按钮时串行请求一次，不做后台定时、不做并发。是否使用请自行判断，后果自负。

## 本地运行

```bash
cd app
npm install
npm run dev      # 开发服务器（127.0.0.1:5173）
npm run build    # 构建，产物在 app/dist
```

> Windows PowerShell 下如果 `npm` 被执行策略拦截，请改用 `npm.cmd`。

仓库自带一组自检脚本（`npm run data:check`、`store:migrate-check`、`share:check`、`account:check` 等），改数据或逻辑后建议跑一遍。

## 数据与素材

角色名单与分类数据来自 **NIKKE Helper**，卡片版式、词条档位数值表、魔方目录、OCR 模板与立绘图标素材来自 **NIKKE Workshop**（1.0.14）。这两处源目录只在本机存在，通过 `app/scripts/` 下的脚本同步与生成：

```bash
npm run assets:sync    # 同步头像/分类图标/卡片素材到 app/public
npm run data:build     # 由源数据生成 src/data/roster.json
```

生成结果已包含在仓库内，克隆后不接源目录也能直接构建和运行。


## 开源许可

本项目以 **GPL-3.0-or-later** 分发，完整条款见 [LICENSE](LICENSE)。

之所以采用 GPL-3.0 而不是更宽松的许可：本项目的卡片版式与配色、词条档位数值表、魔方图标目录、元数据图标规则及部分渲染逻辑参照/移植自 NIKKE Workshop，而该项目以 GPL-3.0-or-later 发布。按其条款，衍生作品需以同一许可证分发。

### 致谢与来源

| 来源 | 许可证 | 本项目用到的部分 |
| --- | --- | --- |
| NIKKE Workshop（1.0.14，作者 異界型w、夕紫） | GPL-3.0-or-later | 卡片版式与配色、词条档位数值表、魔方图标目录、元数据图标规则、OCR 模板、立绘与图标素材 |
| NIKKE Helper | 本人开发项目 | 角色名单（`character-assets.json`、`nikke-directory.json`、`cn-roster.json`、`tags.json`）与分类字段 |
| Shift Up 及其他权利方 | 保留所有权利 | NIKKE 游戏内的角色形象、立绘、图标与字体 |

友情链接：
NIKKE Workshop：https://github.com/ChrisLu7899/NIKKE-Workshop

### 修改说明

相对于上述来源，本项目重写了网页端（React + Vite）的渲染管线，卡片版式与配色按来源对齐；角色表由 `app/scripts/build-roster.mjs` 从来源数据重新生成合并，未直接沿用其数据文件。

## 版权

NIKKE（승리의 여신: 니케）的角色形象、立绘与图标等素材，版权归 Shift Up 及其他权利方所有。**这些游戏素材与角色数据不在本项目的 GPL-3.0 授权范围内**，本项目仅将其用于非官方玩家工具。本仓库是非官方项目，不代表上述任何一方背书。
