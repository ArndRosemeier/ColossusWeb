import type { BuiltBoard, GateType, MasterHex, VariantData } from '../types/variant'

const NONE: GateType = 'NONE'

function emptyGates(): GateType[] {
  return [NONE, NONE, NONE, NONE, NONE, NONE]
}

function emptyNeighbors(): (string | null)[] {
  return [null, null, null, null, null, null]
}

/**
 * Port of MasterBoard setup: exits, entrances, label sides, neighbors.
 */
export function buildBoard(data: VariantData): BuiltBoard {
  const { width, height, hexes } = data.map
  const grid: (string | null)[][] = Array.from({ length: width }, () =>
    Array.from({ length: height }, () => null),
  )
  const hexByLabel: Record<string, MasterHex> = {}
  const show: boolean[][] = Array.from({ length: width }, () =>
    Array.from({ length: height }, () => false),
  )

  for (const def of hexes) {
    show[def.x][def.y] = true
    const hex: MasterHex = {
      label: def.label,
      terrain: def.terrain,
      x: def.x,
      y: def.y,
      exitType: emptyGates(),
      entranceType: emptyGates(),
      neighbors: emptyNeighbors(),
      labelSide: 0,
      inverted: false,
    }
    // Store base exits temporarily on the object via a side channel
    ;(hex as MasterHex & { baseExits: { type: GateType; label: string }[] }).baseExits =
      def.exits.map((e) => ({ type: e.type, label: e.label }))
    hexByLabel[def.label] = hex
    grid[def.x][def.y] = def.label
  }

  const boardParity = computeBoardParity(width, height, show)

  for (const hex of Object.values(hexByLabel)) {
    hex.inverted = ((hex.x + hex.y) & 1) === boardParity
  }

  setupExits(hexByLabel, show, boardParity)
  setupEntrances(hexByLabel, show, width, height)
  setupHexLabelSides(hexByLabel, show, width, height, boardParity)
  setupNeighbors(hexByLabel, show)

  // Drop temporary baseExits
  for (const hex of Object.values(hexByLabel)) {
    delete (hex as MasterHex & { baseExits?: unknown }).baseExits
  }

  const towers = Object.values(hexByLabel)
    .filter((h) => h.terrain === 'Tower')
    .map((h) => h.label)
    .sort()

  return { width, height, boardParity, hexByLabel, towers, grid }
}

function computeBoardParity(width: number, height: number, show: boolean[][]): number {
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height - 1; y++) {
      if (show[x][y] && show[x][y + 1]) {
        return 1 - ((x + y) & 1)
      }
    }
  }
  return 0
}

type HexWithBase = MasterHex & { baseExits: { type: GateType; label: string }[] }

function setupExits(
  hexByLabel: Record<string, MasterHex>,
  show: boolean[][],
  boardParity: number,
): void {
  for (const hex of Object.values(hexByLabel)) {
    const base = (hex as HexWithBase).baseExits
    for (let k = 0; k < base.length; k++) {
      const dest = hexByLabel[base[k].label]
      if (!dest) {
        throw new Error(`Missing exit target ${base[k].label} from ${hex.label}`)
      }
      const gate = base[k].type
      if (dest.x === hex.x) {
        if (dest.y === hex.y - 1) hex.exitType[0] = gate
        else if (dest.y === hex.y + 1) hex.exitType[3] = gate
        else throw new Error(`Bad vertical exit ${hex.label} -> ${dest.label}`)
      } else if (dest.x === hex.x + 1) {
        if (dest.y !== hex.y) throw new Error(`Bad +x exit ${hex.label} -> ${dest.label}`)
        hex.exitType[2 - ((hex.x + hex.y + boardParity) & 1)] = gate
      } else if (dest.x === hex.x - 1) {
        if (dest.y !== hex.y) throw new Error(`Bad -x exit ${hex.label} -> ${dest.label}`)
        hex.exitType[4 + ((hex.x + hex.y + boardParity) & 1)] = gate
      } else {
        throw new Error(`Bad exit ${hex.label} -> ${dest.label}`)
      }
    }
  }
  void show
}

function setupEntrances(
  hexByLabel: Record<string, MasterHex>,
  show: boolean[][],
  width: number,
  height: number,
): void {
  const byCoord = new Map<string, MasterHex>()
  for (const hex of Object.values(hexByLabel)) {
    byCoord.set(`${hex.x},${hex.y}`, hex)
  }
  for (const hex of Object.values(hexByLabel)) {
    for (let k = 0; k < 6; k++) {
      const gate = hex.exitType[k]
      if (gate === NONE) continue
      const neighbor = neighborCoords(hex.x, hex.y, k)
      if (
        neighbor.x < 0 ||
        neighbor.y < 0 ||
        neighbor.x >= width ||
        neighbor.y >= height ||
        !show[neighbor.x][neighbor.y]
      ) {
        continue
      }
      const dest = byCoord.get(`${neighbor.x},${neighbor.y}`)
      if (!dest) continue
      dest.entranceType[(k + 3) % 6] = gate
    }
  }
}

function neighborCoords(x: number, y: number, side: number): { x: number; y: number } {
  switch (side) {
    case 0:
      return { x, y: y - 1 }
    case 1:
    case 2:
      return { x: x + 1, y }
    case 3:
      return { x, y: y + 1 }
    case 4:
    case 5:
      return { x: x - 1, y }
    default:
      throw new Error(`Bad side ${side}`)
  }
}

function setupHexLabelSides(
  hexByLabel: Record<string, MasterHex>,
  show: boolean[][],
  width: number,
  height: number,
  boardParity: number,
): void {
  const midX = (width - 1) / 2
  const midY = (height - 1) / 2
  for (const hex of Object.values(hexByLabel)) {
    const deltaX = hex.x - midX
    const deltaY = ((hex.y - midY) * width) / height
    const ratio = deltaY === 0 ? deltaX * 99999999 : deltaX / deltaY
    const inverted = ((hex.x + hex.y) & 1) === boardParity
    if (Math.abs(ratio) < 0.6) {
      hex.labelSide = inverted ? 3 : 0
    } else if (deltaX >= 0) {
      if (deltaY >= 0) hex.labelSide = inverted ? 5 : 2
      else hex.labelSide = inverted ? 1 : 4
    } else if (deltaY >= 0) {
      hex.labelSide = inverted ? 1 : 4
    } else {
      hex.labelSide = inverted ? 5 : 2
    }
  }
  void show
}

function setupNeighbors(hexByLabel: Record<string, MasterHex>, show: boolean[][]): void {
  const byCoord = new Map<string, MasterHex>()
  for (const hex of Object.values(hexByLabel)) {
    byCoord.set(`${hex.x},${hex.y}`, hex)
  }
  for (const hex of Object.values(hexByLabel)) {
    for (let side = 0; side < 6; side++) {
      if (hex.exitType[side] === NONE && hex.entranceType[side] === NONE) continue
      const { x, y } = neighborCoords(hex.x, hex.y, side)
      if (!show[x]?.[y]) continue
      const n = byCoord.get(`${x},${y}`)
      hex.neighbors[side] = n?.label ?? null
    }
  }
}

export const TERRAIN_COLORS: Record<string, string> = {
  Plains: '#e8d44d',
  Woods: '#6b8e23',
  Brush: '#228b22',
  Hills: '#8b5a2b',
  Jungle: '#006400',
  Desert: '#daa520',
  Marsh: '#a0522d',
  Swamp: '#4169e1',
  Mountains: '#c41e3a',
  Tundra: '#87ceeb',
  Tower: '#808080',
}
