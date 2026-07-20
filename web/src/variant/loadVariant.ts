import type { BuiltBoard, CreatureType, TerrainDef, VariantData } from '../types/variant'
import { buildBoard } from './buildBoard'

export interface LoadedVariant {
  data: VariantData
  board: BuiltBoard
  creatures: Record<string, CreatureType>
  terrains: Record<string, TerrainDef>
}

export async function loadDefaultVariant(): Promise<LoadedVariant> {
  const res = await fetch('/variants/Default/variant.json')
  if (!res.ok) {
    throw new Error(`Failed to load variant: ${res.status}`)
  }
  const data = (await res.json()) as VariantData
  return hydrateVariant(data)
}

export function hydrateVariant(data: VariantData): LoadedVariant {
  const board = buildBoard(data)
  const creatures: Record<string, CreatureType> = {}
  for (const c of data.creatures) creatures[c.name] = c
  const terrains: Record<string, TerrainDef> = {}
  for (const t of data.terrains) terrains[t.name] = t
  return { data, board, creatures, terrains }
}
