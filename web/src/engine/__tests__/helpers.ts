import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hydrateVariant } from '../../variant/loadVariant'
import type { VariantData } from '../../types/variant'
import { createGame } from '../GameEngine'
import type { GameState, Legion, NewGameOptions } from '../types'
import type { LoadedVariant } from '../../variant/loadVariant'

const here = dirname(fileURLToPath(import.meta.url))

export function loadDefaultVariant(): LoadedVariant {
  const raw = readFileSync(
    resolve(here, '../../../public/variants/Default/variant.json'),
    'utf8',
  )
  return hydrateVariant(JSON.parse(raw) as VariantData)
}

export function twoPlayerGame(
  seed = 1,
  extra?: Partial<NewGameOptions>,
): GameState {
  return createGame(loadDefaultVariant(), {
    players: [
      { name: 'Alice', kind: 'human' },
      { name: 'Bob', kind: 'human' },
    ],
    seed,
    ...extra,
  })
}

/** Legal Colossus turn-1 split: Angel + 3 creatures (parent keeps Titan + 3). */
export function turn1SplitChild(state: GameState, parent: Legion): string[] {
  const angel = parent.creatures.find((c) => c.type === 'Angel')
  const nonLords = parent.creatures.filter((c) => !state.variant.creatures[c.type]?.lord)
  if (!angel || nonLords.length < 3) {
    throw new Error('Opening legion missing Angel or creatures for turn-1 split')
  }
  return [angel.type, nonLords[0].type, nonLords[1].type, nonLords[2].type]
}
