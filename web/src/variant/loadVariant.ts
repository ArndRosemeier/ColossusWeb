import type { BuiltBoard, CreatureType, TerrainDef, VariantData } from '../types/variant'
import { buildBoard } from './buildBoard'

export interface LoadedVariant {
  data: VariantData
  board: BuiltBoard
  creatures: Record<string, CreatureType>
  terrains: Record<string, TerrainDef>
}

export const KNOWN_VARIANTS = ['Default', 'Abyssal6', 'Abyssal3', 'Abyssal9'] as const
export type KnownVariantName = (typeof KNOWN_VARIANTS)[number]

function withVariantDefaults(data: VariantData): VariantData {
  const towerCount = data.map.hexes.filter((h) => h.terrain === 'Tower').length
  return {
    ...data,
    titanImprove: data.titanImprove ?? 100,
    titanTeleport: data.titanTeleport ?? 400,
    maxPlayers: data.maxPlayers ?? (towerCount || 6),
  }
}

export function hydrateVariant(data: VariantData): LoadedVariant {
  const normalized = withVariantDefaults(data)
  const board = buildBoard(normalized)
  const creatures: Record<string, CreatureType> = {}
  for (const c of normalized.creatures) creatures[c.name] = c
  const terrains: Record<string, TerrainDef> = {}
  for (const t of normalized.terrains) terrains[t.name] = t
  return { data: normalized, board, creatures, terrains }
}

export async function loadVariant(name: string): Promise<LoadedVariant> {
  const res = await fetch(`${import.meta.env.BASE_URL}variants/${encodeURIComponent(name)}/variant.json`)
  if (!res.ok) {
    throw new Error(`Failed to load variant ${name}: ${res.status}`)
  }
  const data = (await res.json()) as VariantData
  return hydrateVariant(data)
}

/** @deprecated use loadVariant('Default') */
export async function loadDefaultVariant(): Promise<LoadedVariant> {
  return loadVariant('Default')
}
