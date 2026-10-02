// 角色卡素材路径解析：与 NIKKE Workshop 的 ui-assets/nikke 保持同一相对结构
import { assetUrl } from './roster.js'

const UI_ROOT = 'ui-assets/nikke'

export const cardAsset = (relative) => (relative ? assetUrl(`${UI_ROOT}/${relative}`) : '')

// 元数据图标：分组 → 值 → 文件名（规则取自 Workshop src/data/characterMetadataAssets.json）
const BURST_ASSET = { Step1: 'burst-1', Step2: 'burst-2', Step3: 'burst-3', AllStep: 'burst-all' }
// 属性图标统一使用分类图标素材（public/icons/属性，与列表页同一套 5 个文件）
const ELEMENT_ASSET = { Fire: '燃烧', Water: '水冷', Wind: '风压', Electronic: '电击', Elect: '电击', Iron: '铁甲' }
const WEAPON_ASSET = { AR: 'ar', MG: 'mg', RL: 'rl', SG: 'sg', SMG: 'smg', SR: 'sr' }
const CLASS_ASSET = { Attacker: 'attacker', Defender: 'defender', Supporter: 'supporter' }
const CORPORATION_ASSET = {
  ELYSION: 'elysion',
  MISSILIS: 'missilis',
  TETRA: 'tetra',
  PILGRIM: 'pilgrim',
  ABNORMAL: 'abnormal',
}

export function metaAsset(group, value) {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  if (group === 'burst') {
    const key = BURST_ASSET[raw]
    return key ? cardAsset(`metadata/native/burst/${key}.png`) : ''
  }
  if (group === 'element') {
    const key = ELEMENT_ASSET[raw]
    return key ? assetUrl(`icons/属性/${key}.webp`) : ''
  }
  if (group === 'weapon') {
    const key = WEAPON_ASSET[raw.toUpperCase()]
    return key ? cardAsset(`metadata/native/weapon/${key}.png`) : ''
  }
  if (group === 'class') {
    const key = CLASS_ASSET[raw]
    return key ? cardAsset(`metadata/native/class/${key}.png`) : ''
  }
  if (group === 'manufacturer') {
    const key = CORPORATION_ASSET[raw.toUpperCase()]
    return key ? cardAsset(`metadata/native/manufacturer/${key}.png`) : ''
  }
  return ''
}

export const rarityAsset = (rarity) => {
  const normalized = String(rarity ?? '').trim().toLowerCase()
  return ['r', 'sr', 'ssr'].includes(normalized) ? cardAsset(`metadata/rarity/${normalized}.png`) : ''
}

export const starAsset = (filled) =>
  cardAsset(`metadata/breakthrough/${filled ? 'star-filled' : 'star-empty'}.png`)

export const coreFrameAsset = () => cardAsset('metadata/breakthrough/core-frame.png')

export const decorAsset = (name) => cardAsset(`metadata/decorations/${name}.png`)

export const overloadBadgeAsset = () => cardAsset('equipment/overload-badge.png')

// 过载装备图标：职业 → 系列（v金属 / 99 型 / 代号），槽位 head/body/arms/legs
const EQUIPMENT_FAMILY = { attacker: 'vmetal', defender: '99', supporter: 'code' }

export const overloadIconAsset = (className, slotKey) => {
  const family = EQUIPMENT_FAMILY[String(className ?? '').trim().toLowerCase()]
  return family ? cardAsset(`equipment/overload/${family}-${slotKey}.png`) : ''
}

export const cubeIconAsset = (resourceId) =>
  (resourceId ? cardAsset(`cubes/ie_${resourceId}.png`) : '')

// 收藏品（非 SSR 珍藏品）按武器类型取玩偶图标
const DOLL_BY_WEAPON = {
  AR: 'collectible-ar-cooking.png',
  SMG: 'collectible-smg-coffee.png',
  MG: 'collectible-mg-shopping.png',
  SG: 'collectible-sg-battling.png',
  SR: 'collectible-sr-napping.png',
  RL: 'collectible-rl-exercising.png',
}

export const dollAssetForWeapon = (weaponType) => {
  const key = String(weaponType ?? '').trim().toUpperCase()
  return DOLL_BY_WEAPON[key] ? cardAsset(`character-card/${DOLL_BY_WEAPON[key]}`) : ''
}