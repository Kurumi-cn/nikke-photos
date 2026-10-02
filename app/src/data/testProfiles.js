// M2 固定测试档案：数值取自参考资料（参考6 桃乐丝 / 参考1 海伦 / 参考3 牡丹 / 参考4 画皮）
// 仅用于版式与导出验证；M3 将提供录入页面写入真实档案
// 词条字段与模型一致：functionType（词条类型）/ level（档位）/ value（数值 %）；留空行写 null（显示“未获得”）

const line = (functionType, level, value) => ({ functionType, level, value })
const overload = { kind: 'overload', tier: 'T10' }

export const TEST_PROFILES = {
  '5145': {
    label: '参考6 · 桃乐丝',
    level: 463,
    limitBreak: { grade: 3, core: 2 },
    affection: 10,
    combat: 204140,
    classLevel: 153,
    corporationLevel: 130,
    skills: { skill1: 10, skill2: 10, burst: 10 },
    cube: { resourceId: 10001, nameCn: '遗迹突击魔方', level: 15 },
    favoriteItem: { rarity: 'SR', level: 10 },
    equipmentMeta: [overload, overload, overload, overload],
    equipments: [
      [line('StatCritical', 3, 2.98), line('StatAmmoLoad', 15, 85.37), line('StatAtk', 10, 11.11)],
      [line('StatAmmoLoad', 12, 73.04), line('IncElementDmg', 7, 17.95), line('StatAtk', 15, 14.63)],
      [line('IncElementDmg', 10, 22.15), null, line('StatCriticalDamage', 3, 8.6)],
      [line('StatAmmoLoad', 8, 56.6), line('StatCritical', 3, 2.98), line('IncElementDmg', 13, 26.36)],
    ],
    artwork: { id: 'default', offsetX: 50, offsetY: 0, scale: 100 },
  },

  '5066': {
    label: '参考1 · 海伦',
    level: 481,
    limitBreak: { grade: 3, core: 5 },
    affection: 10,
    combat: 241356,
    classLevel: 120,
    corporationLevel: 100,
    skills: { skill1: 10, skill2: 8, burst: 10 },
    cube: { resourceId: 10003, nameCn: '遗迹巨熊魔方', level: 12 },
    favoriteItem: { rarity: 'SSR', level: 2 },
    equipmentMeta: [overload, overload, overload, overload],
    equipments: [
      [line('IncElementDmg', 15, 32.0), line('StatAtk', 10, 11.11), line('StatAmmoLoad', 12, 73.04)],
      [line('StatAmmoLoad', 15, 85.37), line('IncElementDmg', 10, 22.15), line('StatDef', 8, 9.7)],
      [line('StatCritical', 3, 2.98), line('StatCriticalDamage', 3, 8.6), line('IncElementDmg', 12, 26.36)],
      [line('StatAccuracyCircle', 10, 11.81), line('StatAtk', 8, 9.0), line('StatAmmoLoad', 10, 58.0)],
    ],
    artwork: { id: 'default', offsetX: 50, offsetY: 0, scale: 100 },
  },

  '1021': {
    label: '参考3 · 牡丹',
    level: 500,
    limitBreak: { grade: 3, core: 7 },
    affection: 10,
    combat: 180220,
    classLevel: 90,
    corporationLevel: 90,
    skills: { skill1: 9, skill2: 7, burst: 9 },
    cube: { resourceId: 10002, nameCn: '战术突击魔方', level: 12 },
    favoriteItem: { rarity: 'SSR', level: 1 },
    equipmentMeta: [overload, overload, overload, overload],
    equipments: [
      [line('IncElementDmg', 12, 23.56), line('StatAmmoLoad', 15, 68.93), line('StatAccuracyCircle', 10, 11.81)],
      [line('StatDef', 8, 11.81), line('StatChargeDamage', 10, 11.81), line('StatChargeTime', 4, 4.92)],
      [line('StatChargeDamage', 6, 9.7), line('StatDef', 3, 4.77), null],
      [line('IncElementDmg', 15, 29.16), null, line('StatCritical', 3, 3.66)],
    ],
    artwork: { id: 'default', offsetX: 50, offsetY: 0, scale: 100 },
  },

  'cn-exclusive-huapi': {
    label: '参考4 · 画皮',
    level: 450,
    limitBreak: { grade: 3, core: 4 },
    affection: 10,
    combat: 190640,
    classLevel: 110,
    corporationLevel: 80,
    skills: { skill1: 10, skill2: 9, burst: 10 },
    cube: { resourceId: 10013, nameCn: '遗迹毁灭魔方', level: 15 },
    favoriteItem: { rarity: 'R', level: 5 },
    equipmentMeta: [overload, overload, overload, overload],
    equipments: [
      [line('StatAtk', 10, 14.63), line('IncElementDmg', 12, 26.36), null],
      [line('StatCriticalDamage', 3, 11.54), line('StatAmmoLoad', 15, 77.15), line('IncElementDmg', 12, 24.96)],
      [line('StatCriticalDamage', 3, 11.54), line('IncElementDmg', 12, 26.36), null],
      [line('StatCriticalDamage', 3, 12.52), line('IncElementDmg', 11, 23.56), line('StatAmmoLoad', 12, 60.71)],
    ],
    artwork: { id: 'default', offsetX: 50, offsetY: 0, scale: 100 },
  },
}

export const getTestProfile = (nameCode) => TEST_PROFILES[String(nameCode)] || null