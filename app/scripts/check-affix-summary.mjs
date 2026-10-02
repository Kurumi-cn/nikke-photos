// 词条合计回归校验：桃乐丝测试档案的合计应与参考图（参考6）完全一致
// 用法：node scripts/check-affix-summary.mjs
import { formatPercent, summarizeAffixes } from '../src/lib/cardModel.js'
import { TEST_PROFILES } from '../src/data/testProfiles.js'

const EXPECTED = {
  '5145': [
    ['StatAmmoLoad', 35, '215.01%'],
    ['IncElementDmg', 30, '66.46%'],
    ['StatAtk', 25, '25.74%'],
  ],
}

let failed = 0
for (const [code, profile] of Object.entries(TEST_PROFILES)) {
  const top = summarizeAffixes(profile.equipments, 3)
  const rendered = top.map((item) => `${item.label} 【${item.totalLevel}档】${formatPercent(item.totalValue)}`)
  console.log(`${code} ${profile.label}`)
  console.log(`  ${rendered.join('  |  ') || '（无词条）'}`)

  const expected = EXPECTED[code]
  if (!expected) continue
  expected.forEach(([functionType, totalLevel, percent], index) => {
    const actual = top[index]
    const ok = actual?.functionType === functionType
      && actual?.totalLevel === totalLevel
      && formatPercent(actual?.totalValue) === percent
    if (!ok) {
      failed += 1
      console.error(`  [不一致] 第 ${index + 1} 条：期望 ${functionType} ${totalLevel}档 ${percent}`)
    }
  })
}

if (failed > 0) {
  console.error(`词条合计校验失败：${failed} 处不一致`)
  process.exitCode = 1
} else {
  console.log('词条合计校验通过（参考6 三行数值一致）')
}