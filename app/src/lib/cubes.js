import cubesData from '../data/cubes.json' with { type: 'json' }

export const CUBES = cubesData.cubes

export const findCube = (resourceId) =>
  CUBES.find((cube) => cube.resourceId === Number(resourceId)) || null