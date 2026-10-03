import cubesData from '../data/cubes.json' with { type: 'json' }

export const CUBES = cubesData.cubes

export const findCube = (resourceId) =>
  CUBES.find((cube) => cube.resourceId === Number(resourceId)) || null

/**
 * 按 `cubeId` 查魔方。
 *
 * 我们的角色记录里存的是 `resourceId`（10001…），但**外部数据源（BlaBlaLink 账号接口）
 * 给的是 `cubeId`（1000301…）**——两套编号都在 cubes.json 里，别用错：
 * `findCube` 只认 `resourceId`，拿 cubeId 去查永远查不到。
 */
export const findCubeByCubeId = (cubeId) =>
  CUBES.find((cube) => cube.cubeId === Number(cubeId)) || null
