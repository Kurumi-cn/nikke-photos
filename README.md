# NIKKE Photos

妮姬（NIKKE）角色卡片生成与练度管理工具，纯前端网页应用（React 19 + Vite，无后端）：角色列表、我的妮姬、数据录入、词条统计、BOT 分享五个页面，角色卡片实时预览并导出 1x/2x/3x PNG。

## 本地运行

```bash
cd app
npm install
npm run dev      # 开发服务器
npm run build    # 构建，产物在 app/dist
```

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
