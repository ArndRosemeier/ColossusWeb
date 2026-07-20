import { readFileSync } from 'node:fs'
import { hydrateVariant } from '../variant/loadVariant'
import type { VariantData } from '../types/variant'
import { createGame, createRng, dispatch } from '../engine/GameEngine'
import { pickAiCommand } from '../ai/simpleAi'
import type { ResolvedAiProfileId } from '../ai/profiles'

const v = hydrateVariant(
  JSON.parse(readFileSync('./public/variants/Default/variant.json', 'utf8')) as VariantData,
)
const seed = Number(process.env.DEBUG_SEED ?? 99838)
const profiles: ResolvedAiProfileId[] = ['balanced', 'aggressive', 'cautious', 'expander']
const rng = createRng(seed)
let state = createGame(v, {
  players: profiles.map((p) => ({ name: p, kind: 'ai' as const, aiProfileId: p })),
  seed,
})

for (let i = 0; i < 500; i++) {
  const cmd = pickAiCommand(state, rng)
  if (!cmd) {
    const p = state.players[state.activePlayerIndex]
    const battleActor = state.battle?.activePlayerId
      ? state.players.find((x) => x.id === state.battle!.activePlayerId)
      : null
    console.log('STUCK at step', i)
    console.log({
      phase: state.phase,
      turn: state.turnNumber,
      active: p?.name,
      kind: p?.kind,
      dead: p?.dead,
      message: state.message,
      winner: state.winnerId,
      draw: state.draw,
    })
    console.log('pending', state.pendingEngagements.length, state.pendingEngagements)
    console.log('engagement', state.activeEngagement)
    console.log(
      'battle',
      state.battle && {
        phase: state.battle.phase,
        done: state.battle.done,
        activeHalf: state.battle.activeHalf,
        activePlayerId: state.battle.activePlayerId,
        actor: battleActor?.name,
        actorDead: battleActor?.dead,
      },
    )
    console.log(
      'players',
      state.players.map((x) => ({ name: x.name, dead: x.dead, score: x.score })),
    )
    break
  }
  state = dispatch(state, cmd, rng)
  if (state.winnerId || state.draw) {
    console.log('finished', state.winnerId ?? 'draw', 'at', i)
    break
  }
}
