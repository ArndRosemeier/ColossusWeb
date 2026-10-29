export const MODERN_TERRAINS: Readonly<Record<string, { top: string; bottom: string }>> = {
  Plains: { top: '#77704a', bottom: '#404735' }, Woods: { top: '#426449', bottom: '#203c2c' },
  Brush: { top: '#4b7657', bottom: '#284a35' }, Hills: { top: '#796045', bottom: '#4c4030' },
  Jungle: { top: '#335b47', bottom: '#173b2a' }, Desert: { top: '#a08049', bottom: '#6b5734' },
  Marsh: { top: '#77694c', bottom: '#485441' }, Swamp: { top: '#4a6a79', bottom: '#2a4655' },
  Mountains: { top: '#80545b', bottom: '#4b3542' }, Tundra: { top: '#8da7b1', bottom: '#526e7b' },
  Tower: { top: '#6b7882', bottom: '#3f515e' }, Abyss: { top: '#705581', bottom: '#3f2c53' },
}

export function hasModernTerrain(terrain: string): boolean { return Object.hasOwn(MODERN_TERRAINS, terrain) }
export function modernTerrainUrl(terrain: string): string {
  if (!hasModernTerrain(terrain)) throw Error(`Modern terrain artwork is not registered: ${terrain}`)
  return `${import.meta.env.BASE_URL}board-art/terrain-v1/${terrain}.png`
}
