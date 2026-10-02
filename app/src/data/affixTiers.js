// 改造装备词条档位表
// 来源：NIKKE WORKSHOP 1.0.14 —— NIKKE-Workshop-1.0.14/src/calculator/main.js 的 STAT_TIER_VALUES（L90~L101）
//   · 优越代码伤害增加 / 最大装弹数增加 / 蓄力速度增加 / 暴击率增加 / 暴击伤害增加 为显式 15 档数组
//   · 蓄力伤害增加 / 攻击力增加 / 命中率增加 / 防御力增加 共用 COMMON_TIERS（4.77% ~ 14.63%）
//   · 已与 4 张游戏内改造面板样本逐行核对一致（文档/ocr_samples/equipment/truth.json）
// 档位编号 1~15 对应数组下标 0~14，数组值为百分比数值（9.54 表示 9.54%）

export const COMMON_TIERS = [4.77, 5.47, 6.18, 6.88, 7.59, 8.29, 9.00, 9.70, 10.40, 11.11, 11.81, 12.52, 13.22, 13.93, 14.63]

/** 词条类型 → 中文名（顺序即 UI 下拉顺序，与 Workshop 标签一致） */
export const FUNCTION_LABELS = {
  IncElementDmg: '优越代码伤害增加',
  StatAtk: '攻击力增加',
  StatAmmoLoad: '最大装弹数增加',
  StatChargeTime: '蓄力速度增加',
  StatChargeDamage: '蓄力伤害增加',
  StatCritical: '暴击率增加',
  StatCriticalDamage: '暴击伤害增加',
  StatAccuracyCircle: '命中率增加',
  StatDef: '防御力增加',
}

export const AFFIX_TIER_VALUES = {
  IncElementDmg: [9.54, 10.94, 12.34, 13.75, 15.15, 16.55, 17.95, 19.35, 20.75, 22.15, 23.56, 24.96, 26.36, 27.76, 29.16],
  StatAtk: COMMON_TIERS,
  StatAmmoLoad: [27.84, 31.95, 36.06, 40.17, 44.28, 48.39, 52.50, 56.60, 60.71, 64.82, 68.93, 73.04, 77.15, 81.26, 85.37],
  StatChargeTime: [1.98, 2.28, 2.57, 2.86, 3.16, 3.45, 3.75, 4.04, 4.33, 4.63, 4.92, 5.21, 5.51, 5.80, 6.09],
  StatChargeDamage: COMMON_TIERS,
  StatCritical: [2.30, 2.64, 2.98, 3.32, 3.66, 4.00, 4.35, 4.69, 5.03, 5.37, 5.71, 6.05, 6.39, 6.73, 7.07],
  StatCriticalDamage: [6.64, 7.62, 8.60, 9.58, 10.56, 11.54, 12.52, 13.50, 14.48, 15.46, 16.44, 17.42, 18.40, 19.38, 20.36],
  StatAccuracyCircle: COMMON_TIERS,
  StatDef: COMMON_TIERS,
}

/** 档位对应的百分比文本（如 StatAtk 第 7 档 → "9.00%"） */
export function affixTierText(functionType, tier) {
  const tiers = AFFIX_TIER_VALUES[functionType]
  if (!tiers || tier < 1 || tier > tiers.length) return null
  return `${tiers[tier - 1].toFixed(2)}%`
}

/** 值文本（如 "9.00%"）→ 数值（9）；解析失败返回 null */
export function affixValueFromText(text) {
  const match = String(text ?? '').trim().match(/^(\d+(?:\.\d+)?)\s*%$/)
  return match ? Number(match[1]) : null
}

/**
 * 档位吸附：把识别出的数值吸附到最近档位（多一重保障——最终值必是某个档位的数值）
 *  - 名词高置信（提供 functionType）→ 只在该词条档位里找最近档，容差内即吸附
 *  - 名词低置信（未提供）→ 全表匹配；候选值去重后唯一才吸附（避免跨词条歧义值误导）
 * 返回 { functionType, tier, tierValue, distance, reason } 或 null（未吸附，保留原值）
 *  - reason: 'scoped' 限词条吸附 | 'unique-value' 全表唯一值吸附 | 未吸附时其次给出 'ambiguous'/'no-match' 供留痕
 */
export function snapAffixValue(value, { functionType, tolerance = 0.1 } = {}) {
  if (!Number.isFinite(value)) return null
  const scoped = functionType && AFFIX_TIER_VALUES[functionType] ? [functionType] : null
  const functionTypes = scoped || Object.keys(AFFIX_TIER_VALUES)
  const candidates = []
  for (const type of functionTypes) {
    AFFIX_TIER_VALUES[type].forEach((tierValue, index) => {
      const distance = Math.abs(tierValue - value)
      if (distance <= tolerance + 1e-9) candidates.push({ functionType: type, tier: index + 1, tierValue, distance })
    })
  }
  if (candidates.length === 0) return scoped ? null : { reason: 'no-match' }
  if (scoped) {
    const best = candidates.sort((left, right) => left.distance - right.distance)[0]
    return { ...best, reason: 'scoped' }
  }
  const values = [...new Set(candidates.map((item) => item.tierValue))]
  if (values.length !== 1) return { reason: 'ambiguous', candidates: candidates.length }
  const tiers = [...new Set(candidates.map((item) => item.tier))]
  return {
    functionType: candidates[0].functionType,
    tier: tiers.length === 1 ? tiers[0] : null,
    tierValue: candidates[0].tierValue,
    distance: Math.min(...candidates.map((item) => item.distance)),
    reason: 'unique-value',
  }
}

/**
 * 档位字典纠错：吸附失败时，在“编辑距离 1”的邻近数值里找精确命中该词条档位的候选。
 * 用途：模糊输入（视频抓帧等）会让个别数字误判或漏检——实测 '5'→'9' 得 89.37（真值 85.37）、
 * 漏一位得 1.11（真值 11.11）；档位表是精确离散集，可做极强约束的反向纠错。
 * 多候选命中（有歧义）时返回 null，保持“需核对”不猜。
 * 返回 { tier, tierValue, distance } 或 null。
 */
export function correctAffixValueByTiers(value, functionType) {
  const tiers = functionType && AFFIX_TIER_VALUES[functionType]
  if (!Number.isFinite(value) || !tiers) return null
  const text = value.toFixed(2)
  const candidates = new Set()
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '.') continue
    for (let digit = 0; digit <= 9; digit += 1) {
      candidates.add(text.slice(0, index) + digit + text.slice(index + 1)) // 替换一位
    }
    candidates.add(text.slice(0, index) + text.slice(index + 1)) // 删掉一位（漏检）
  }
  for (let index = 0; index <= text.length; index += 1) {
    for (let digit = 0; digit <= 9; digit += 1) {
      candidates.add(text.slice(0, index) + digit + text.slice(index)) // 插入一位（漏检）
    }
  }
  const hits = []
  for (const candidate of candidates) {
    if (!/^\d{1,2}\.\d{2}$/.test(candidate)) continue
    const candidateValue = Number(candidate)
    tiers.forEach((tierValue, tierIndex) => {
      if (Math.abs(tierValue - candidateValue) < 0.005) {
        hits.push({ tier: tierIndex + 1, tierValue, candidateValue })
      }
    })
  }
  const unique = [...new Map(hits.map((hit) => [hit.candidateValue, hit])).values()]
  if (unique.length !== 1) return null
  return { tier: unique[0].tier, tierValue: unique[0].tierValue, distance: Math.abs(unique[0].tierValue - value) }
}