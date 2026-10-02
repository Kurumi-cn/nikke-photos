// 角色练度页字段识别核心（纯函数，无 Node / DOM 依赖，CLI 与网页共用）
//
// 字段：等级 / 好感等级 / 战斗力（另有装备等级作为信息项，由调用方自行处理）
// 流程：五路墨迹掩码（深字/亮字/彩字/徽章/浅描边）→ scanNumbers 扫数字串 → 字段匹配
//
// 关键修复（实测得出）：
//   1) 战斗力图标会被误认成数字（'0'/'3'，位级置信 0.67~0.81）并粘进数字串首（如 0241356）；
//      真数字的位级置信普遍 ≥0.9 且首位不会"明显低于次位"——用"串长 ≥5 + 首位置信 <0.85
//      + 次位比首位高 0.15+"剪掉伪影（实测 4 张样本的落差为 0.19~0.33，不会误伤真数字）
//   2) '6' 曾被读成 '8'、红心小字不稳——通过 lax 采集补 PC 字形与红心专属字形解决（见采集脚本）
import { analyzeColor, buildInkMasks, scanNumbers } from './core.js'

export const CHARACTER_FIELDS = [
  { key: 'level', label: '等级' },
  { key: 'affection', label: '好感等级' },
  { key: 'combat', label: '战斗力' },
]

/**
 * 盲识别（无真值）的布局锚参数（4 张实测样本标定，PC 与手机竖屏均适用）
 * 实测：战斗力 = 全图“数字位数 ≥5”的唯一串（字高 55~56）；等级在其左上方约 72px、
 * 左缘对齐（±10px 内）；好感在其上方约 50px、右侧 +200px 左右（红心徽章上）
 */
export const CHARACTER_TUNING = {
  combatMinDigits: 5,
  // 粗扫（找战斗力锚）只跑深色一路且抬高组件门槛（只要大数字）：全质量五路全图要 6~17 秒
  coarsePasses: ['dark'],
  coarseMinHeight: 40,
  // 字段最低分：低于此视为“未识别”（宁缺毋滥——好感的红心小字在个别角色上会读错，
  // 实测灰姑娘红心“20”在 0.50 分档被读成 27，直接判未识别让用户手填，比写错值好）
  minFieldScore: 0.6,
  levelDx: 35,
  // 等级+好感的公共精扫区域（相对锚，PC 与手机竖屏通用）
  upperRegion: { x0: -90, x1: 340, y0: -190, y1: -10 },
}

/**
 * 扫描区域内全部数字串（含位级置信度与所属墨迹路）
 * 坐标已换算回原图坐标系；keepAll 保留低分串供字段匹配兜底
 */
export const scanCharacterRuns = (image, { region, templates, minScore = 0.5, passes, minHeight = 8 } = {}) => {
  const area = region || { x0: 0, y0: 0, x1: image.width - 1, y1: image.height - 1 }
  const runs = []
  const { gray, chroma, width, height } = analyzeColor(image, area)
  for (const pass of buildInkMasks(gray, chroma, width, height)) {
    if (passes && !passes.includes(pass.name)) continue
    const found = scanNumbers(pass.mask, width, height, {
      digitTemplates: templates,
      minScore,
      minHeight,
      minPixels: 4,
      keepAll: true,
      detectHoles: true,
      fillGlyphs: pass.name === 'pale',
    })
    for (const item of found) {
      if (!/[0-9]/.test(item.text)) continue
      runs.push({
        text: item.text,
        score: item.score,
        mode: pass.name,
        chars: item.chars,
        box: {
          x0: item.box.x0 + area.x0,
          y0: item.box.y0 + area.y0,
          x1: item.box.x1 + area.x0,
          y1: item.box.y1 + area.y0,
          width: item.box.width,
          height: item.box.height,
        },
      })
    }
  }
  return runs
}

/**
 * 战斗力串首伪影修剪：图标被误认成数字并粘进串首时剪掉它
 * 返回 { text, chars, trimmed }（trimmed 为被剪掉的伪影位，供留痕）
 */
export const trimCombatArtifact = (run) => {
  const chars = [...(run?.chars || [])]
  let trimmed = null
  while (chars.length >= 5) {
    const first = chars[0]
    const second = chars[1]
    const firstScore = first?.score ?? 1
    const gap = (second?.score ?? 0) - firstScore
    if (firstScore < 0.85 && gap > 0.15) {
      trimmed = first
      chars.shift()
      continue
    }
    break
  }
  return {
    text: chars.map((char) => char.char || '·').join('').replace(/\.+$/, ''),
    chars,
    trimmed,
  }
}

/** 识别串与真值的相似度：完全一致 > 包含 > 等长逐位一致率（其余视为不可比） */
export const compareRun = (text, value) => {
  if (text === value) return { score: 1, agreement: value.length, kind: 'exact' }
  if (text.includes(value)) return { score: 0.9, agreement: value.length, kind: 'inside' }
  if (text.length !== value.length) return null
  let agreement = 0
  for (let index = 0; index < value.length; index += 1) {
    if (text[index] === value[index]) agreement += 1
  }
  return { score: agreement / value.length, agreement, kind: 'same-length' }
}

/**
 * 按字段挑最佳串（回归/调试用：给定真值找最像的串）
 * 战斗力字段先做串首伪影修剪再比较；返回 { score, agreement, kind, text, chars, run, trimmedFrom }
 */
export const pickFieldRun = (runs, field, value) => {
  let best = null
  for (const run of runs) {
    const trimmed = field === 'combat' ? trimCombatArtifact(run) : { text: run.text, chars: run.chars, trimmed: null }
    const compared = compareRun(trimmed.text, value)
    if (!compared) continue
    if (!best || compared.score > best.score || (compared.score === best.score && run.score > best.run.score)) {
      best = { ...compared, text: trimmed.text, chars: trimmed.chars, trimmedFrom: trimmed.trimmed, run }
    }
  }
  return best
}

/**
 * 盲识别（app 用）：无真值，两阶段挑串
 *   1) 粗扫找锚：全图只跑深色一路 → 找“数字位数 ≥5、字高最大”的串（战斗力）
 *   2) 精扫取字段：以锚为基准，对锚区域、等级区、好感区做局部全质量扫描
 *      （区域阈值下串更干净——全图阈值会把 '2' 之类读成 '.'，实测灰姑娘 221074 → 2.074）
 * 返回 { level, affection, combat, runs }；未命中的字段为 null（调用方不写回）
 * 注：曾试过“降采样找锚”，但最近邻缩小严重破坏字形（战斗力被读成 0032074），已放弃
 */
export const recognizeCharacterFields = (image, { templates, minScore = 0.5, tuning } = {}) => {
  const config = { ...CHARACTER_TUNING, ...(tuning || {}) }
  const countDigits = (run) => (run.text.match(/\d/g) || []).length

  // —— 1) 粗扫找锚（原图坐标，无需换算；只跑 dark 一路 + 抬高组件门槛省时间） ——
  const coarseRuns = scanCharacterRuns(image, {
    templates,
    minScore,
    passes: config.coarsePasses,
    minHeight: config.coarseMinHeight,
  })
  const coarseCombat = coarseRuns
    .filter((run) => countDigits(run) >= config.combatMinDigits)
    .sort((left, right) => right.box.height - left.box.height)[0] || null
  const result = { level: null, affection: null, combat: null, runs: [] }
  if (!coarseCombat) return result
  const anchorBox = coarseCombat.box

  // —— 2) 精扫：锚区域（含伪影）→ 战斗力 ——
  const clamp = (value, min, max) => Math.min(Math.max(value, min), max)
  const combatRuns = scanCharacterRuns(image, {
    region: {
      x0: clamp(anchorBox.x0 - 40, 0, image.width - 1),
      y0: clamp(anchorBox.y0 - 30, 0, image.height - 1),
      x1: clamp(anchorBox.x1 + 40, 0, image.width - 1),
      y1: clamp(anchorBox.y1 + 30, 0, image.height - 1),
    },
    templates,
    minScore,
  })
  const combatPick = combatRuns
    .map((run) => ({ run, trimmed: trimCombatArtifact(run) }))
    .filter((item) => item.trimmed.chars.length >= config.combatMinDigits)
    .sort((left, right) => right.run.box.height - left.run.box.height)[0] || null
  if (!combatPick) return result
  const combatRun = combatPick.run
  result.combat = {
    text: combatPick.trimmed.text,
    score: combatRun.score,
    mode: combatRun.mode,
    run: combatRun,
    trimmed: combatPick.trimmed.trimmed,
  }

  const cx0 = combatRun.box.x0
  const cy0 = combatRun.box.y0

  // —— 3) 等级+好感：公共区域精扫一次（区域太小会让红心数字的分割阈值失真，太大又慢） ——
  const upper = config.upperRegion
  const upperRuns = scanCharacterRuns(image, {
    region: {
      x0: clamp(cx0 + upper.x0, 0, image.width - 1),
      y0: clamp(cy0 + upper.y0, 0, image.height - 1),
      x1: clamp(cx0 + upper.x1, 0, image.width - 1),
      y1: clamp(cy0 + upper.y1, 0, image.height - 1),
    },
    templates,
    minScore,
  })

  // 等级：左缘与锚对齐的 2~4 位纯整数（"/200" 上限在右侧不入选）
  const levelRun = upperRuns
    .filter((run) => /^\d{2,4}$/.test(run.text)
      && Math.abs(run.box.x0 - cx0) <= config.levelDx
      && run.score >= config.minFieldScore)
    .sort((left, right) => right.score - left.score)[0] || null
  if (levelRun) result.level = { text: levelRun.text, score: levelRun.score, mode: levelRun.mode, run: levelRun }

  // 好感：红心徽章区的 2 位纯整数（明显靠右 + 合理宽高比——红心边缘的细缝会被读成"00"，
  // 宽高比过滤把它们排除；分数门槛兜住残形读数）
  const affectionRun = upperRuns
    .filter((run) => {
      if (!/^\d{2}$/.test(run.text)) return false
      if (run.score < config.minFieldScore) return false
      const dx = run.box.x0 - cx0
      if (dx < 120 || dx > 320) return false
      const ratio = run.box.width / run.box.height
      return ratio >= 0.8 && ratio <= 3
    })
    .sort((left, right) => right.score - left.score)[0] || null
  if (affectionRun) result.affection = { text: affectionRun.text, score: affectionRun.score, mode: affectionRun.mode, run: affectionRun }

  result.runs = [...combatRuns, ...upperRuns]
  return result
}