// SPDX-License-Identifier: GPL-3.0-or-later
// 行级裁决：名称候选 walk + confidence / needsConfirm / flags（纯逻辑，无 I/O）
//
// 设计见规格 §4.2（Q25=b）。要点：
//   1) 名称给出候选排名；用**值模板证据**逐个验证，第一个命中合法档位的就是答案
//   2) 不再有"盲路"（旧实现的 % 锚点逐字识别正是本次缺陷的发生地），因此也没有档位吸附：
//      值直接取自档位表，snapped 恒 false
//   3) 第 1 行判空是强异常（§4.1 结构先验），必须显式标记而不是静默输出空行
//
// 本文件不做任何 I/O 与图像处理：值模板匹配以 `matchValue(functionType)` 回调注入，
// 便于单测与复用。

import { AFFIX_TIER_VALUES, FUNCTION_LABELS } from '../../../data/affixTiers.js'
import { VALUE_MATCH_TUNING } from './valueTemplate.js'
import { expectedOcrValueStyle, OCR_VALUE_STYLES } from './valueStyle.js'

export const ADJUDICATE_TUNING = Object.freeze({
  /** walk 最多往下试几个名称候选 */
  walkLimit: 3,
  /** 判定 high 所需的名称 margin */
  highNameMargin: 0.05,
  /** 判定 high 所需的数值 margin（仅当值证据**不精确**时才有意义，见下） */
  highValueMargin: 0.04,
  /** 名称 margin 低于该值即标 NAME_LOW_CONFIDENCE */
  nameMinMargin: 0.03,
  /**
   * 「值证据精确」的阈值：掩码距离 ≤ 该值即视为最强证据，**不再看 margin**
   *
   * 为什么必须这样：`StatAtk` / `StatAccuracyCircle` / `StatDef` / `StatChargeDamage`
   * 共用 `COMMON_TIERS`（§4.2），同值词条的模板几乎逐像素相同 → 竞争候选距离与被选候选
   * 距离**结构性地**挤在一起，margin 趋零。实测 55 行里 44 行 `score ≤ 0.01`（精确命中），
   * 却因 margin ≈ 0 全部被判"低置信"——那是把"值不能用于区分同义词条"误读成"值不可信"。
   * 值证据的强度应当由**距离**回答，margin 只在"距离不是最好"时提供补充。
   */
  valueExactScore: VALUE_MATCH_TUNING.glyphExactScore,
})

/** 空行（游戏本身没有词条） */
export const emptyRowResult = (position, flags = []) => ({
  position,
  status: 'empty',
  empty: true,
  name: null,
  functionType: null,
  value: null,
  tier: null,
  confidence: null,
  snapped: false,
  snapReason: 'none',
  needsConfirm: flags.includes('ROW1_EMPTY_SUSPECT'),
  flags,
  method: null,
  engine: 'v2',
})

/**
 * 裁决一行
 *
 * @param {{
 *   position: number,
 *   nameMatch: { ranked: {functionType, score, family}[] } | null,
 *   unearned: boolean,
 *   valueStyle?: string,
 *   darkRow?: boolean,
 *   regionGuardFailed?: boolean,
 *   matchValue: (functionType: string) => Promise<{level,value,score,margin,method}|null>,
 * }} input
 */
export const adjudicateRow = async ({
  position,
  nameMatch,
  unearned = false,
  valueStyle = '',
  darkRow = false,
  regionGuardFailed = false,
  matchValue,
}) => {
  const emptyFlags = []
  if (regionGuardFailed) emptyFlags.push('ROI_CLIPPED')
  // §4.1 结构先验：第 1 行必有词条，"第 1 行判空"与机制矛盾
  if (position === 1 && unearned) emptyFlags.push('ROW1_EMPTY_SUSPECT')
  if (unearned) return emptyRowResult(position, emptyFlags)

  const ranked = (nameMatch?.ranked ?? []).slice(0, ADJUDICATE_TUNING.walkLimit)
  const nameMargin = nameMatch
    ? Number((nameMatch.ranked[0].score - (nameMatch.ranked[1]?.score ?? 0)).toFixed(3))
    : 0

  // walk 的收紧（§4.2 规则 4 实测）：第 1 名之外的候选**只有值证据精确命中**时才允许压过
  // 名称排序。理由：名称没匹配上值时，只说明"值没读对或名称没读对"，此时一个 0.02 距离的
  // 模糊匹配不足以指认词条 —— 实测唯一那次 walk 生效（命中距离 0.022）就把正确的
  // `暴击率增加 2.98%` 改成了 `命中率增加 6.88%`。反过来，精确命中（近乎逐像素）的强证据
  // 值得翻盘，所以不取消 walk，只提高它的入场门槛。
  let picked = null
  for (let index = 0; index < ranked.length; index += 1) {
    const candidate = ranked[index]
    const match = await matchValue(candidate.functionType)
    if (!match?.method) continue
    if (index > 0 && match.score > ADJUDICATE_TUNING.valueExactScore) continue
    picked = { ...match, functionType: candidate.functionType, nameScore: candidate.score, nameRank: index + 1 }
    break
  }

  if (!picked) {
    // 名称有排名、值却没有一条能站住：**报第 1 名名称 + 值留空**，而不是丢掉名称。
    // 名称模板路在这个样本集上是 55/55，它的排序本身是证据；输出空名称等于把这份证据扔掉，
    // 让用户从零开始选。
    const bestName = ranked[0] ?? null
    return {
      position,
      status: 'unknown',
      empty: false,
      name: bestName ? (FUNCTION_LABELS[bestName.functionType] ?? null) : null,
      functionType: bestName?.functionType ?? null,
      value: null,
      tier: null,
      confidence: 'low',
      snapped: false,
      snapReason: 'none',
      needsConfirm: true,
      flags: ['VALUE_LOW_CONFIDENCE', ...emptyFlags],
      method: null,
      engine: 'v2',
      evidence: { nameRank: null, nameScore: bestName?.score ?? 0, nameMargin, valueStyle, darkRow },
    }
  }

  const flags = []
  if (picked.nameRank > 1) flags.push('NAME_VALUE_CONFLICT')
  if (nameMargin < ADJUDICATE_TUNING.nameMinMargin) flags.push('NAME_LOW_CONFIDENCE')
  if (regionGuardFailed) flags.push('ROI_CLIPPED')
  const expectedStyle = expectedOcrValueStyle(picked.level)
  if (valueStyle && expectedStyle && expectedStyle !== valueStyle) flags.push('TIER_STYLE_MISMATCH')

  // 刻意**不**按 margin 给"命中了的行"落 VALUE_LOW_CONFIDENCE：值模板路自己已经有验收门槛
  // （`score ≤ glyphMaxScore` 且 `margin ≥ glyphMinMargin`，或 `score ≤ glyphExactScore`），
  // 没过门槛的根本不会返回结果、会走下面的 unknown 分支。再加一道外部 margin 阈值属于重复计数，
  // 且因为共用档位表（§4.2）margin 结构性趋零，实测会把 14/55 条**全对**的行标成"需核对"、
  // 把唯一那条真错的信号（NAME_VALUE_CONFLICT）淹没。值证据的强弱由距离回答，不由 margin 回答。
  const valueExact = picked.score <= ADJUDICATE_TUNING.valueExactScore
  const confident = picked.nameRank === 1
    && nameMargin >= ADJUDICATE_TUNING.highNameMargin
    && (valueExact || picked.margin >= ADJUDICATE_TUNING.highValueMargin)
  const confidence = confident ? 'high' : 'medium'

  return {
    position,
    status: 'ok',
    empty: false,
    name: FUNCTION_LABELS[picked.functionType] ?? null,
    functionType: picked.functionType,
    value: picked.value,
    tier: picked.level,
    confidence,
    // v2 没有吸附机械：值直接来自档位表
    snapped: false,
    snapReason: 'none',
    // 原则：任何弱证据都不得静默 —— 只要落了 flag 就要人核对
    needsConfirm: confidence === 'low' || flags.length > 0,
    flags,
    method: picked.method,
    engine: 'v2',
    evidence: {
      nameRank: picked.nameRank,
      nameScore: Number(picked.nameScore.toFixed(3)),
      nameMargin,
      nameFamily: nameMatch?.ranked?.[0]?.family ?? null,
      valueScore: Number(picked.score.toFixed(3)),
      valueMargin: Number(picked.margin.toFixed(3)),
      valueMethod: picked.method,
      valueStyle: valueStyle || OCR_VALUE_STYLES.LIGHT_BLACK,
      darkRow,
      regionGuardFailed,
    },
  }
}

export { AFFIX_TIER_VALUES }
