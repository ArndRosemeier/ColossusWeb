/**
 * Named AI personality presets — one decision core, different tuning constants.
 * Not 1:1 ports of Colossus Java AIs.
 */

export type AiProfileId = 'balanced' | 'aggressive' | 'cautious' | 'expander' | 'random'

/** Concrete profiles after resolving `random` at game create. */
export type ResolvedAiProfileId = Exclude<AiProfileId, 'random'>

export interface AiProfile {
  id: ResolvedAiProfileId
  label: string
  blurb: string
  /** Chance to optionally split mid-game stacks below height 7 (unused; AI always splits 7s). */
  splitChance: number
  /** Prefer leaving Titan on parent when splitting turn 1 (Angel goes to child) */
  preferAngelOnTurn1: number
  /** After first move, chance to keep moving other legions */
  continueMovingChance: number
  /** Extra flat score when considering an attack hex (legacy spice) */
  preferAttackWeight: number
  /** Score bonus when attacking a stronger enemy stack (lower = avoid more) */
  attackEvenIfWeakerBonus: number
  /**
   * Multiplier on positive fight rewards. Low = prefer growth over combat;
   * high = hunt engagements. Typical range ~0.25–1.2.
   */
  attackAppetite: number
  /**
   * Multiplier on muster/recruit destination value. High = improve own legions first.
   */
  recruitPreference: number
  /**
   * How harshly to punish bad/draw fights (scales lose-legion penalties).
   */
  fightLossPenalty: number
  /** Minimum score to auto-take a "strong" move */
  strongMoveThreshold: number
  /** Flee as defender when enemy height / own height >= this (0 = never) */
  fleeOutnumberRatio: number
  /** In battle Move, prefer closing on enemies (higher = closer) */
  battleApproachEnemy: number
  /** Extra value for Titan targets / own-Titan threat in battle scoring */
  battleTitanValue: number
  /** After someone moved, end Move when best hex score ≤ this */
  battleMoveThreshold: number
  /** Chance to skip reinforce when options exist */
  skipReinforceChance: number
  /** Chance to skip summon when options exist */
  skipSummonChance: number
  /** 0 = random recruit, 1 = always highest ability-aware muster score */
  musterGreed: number
  /** Chance to concede battle when alive units << enemy alive */
  concedeWhenHopelessChance: number
}

const RESOLVED_IDS: ResolvedAiProfileId[] = ['balanced', 'aggressive', 'cautious', 'expander']

export const AI_PROFILES: Record<ResolvedAiProfileId, AiProfile> = {
  balanced: {
    id: 'balanced',
    label: 'Balanced',
    blurb: 'Grows stacks first; attacks only when the prize is clear.',
    splitChance: 0.35,
    preferAngelOnTurn1: 0.7,
    continueMovingChance: 0.75,
    preferAttackWeight: 12,
    attackEvenIfWeakerBonus: 2,
    attackAppetite: 0.45,
    recruitPreference: 1.85,
    fightLossPenalty: 1.1,
    strongMoveThreshold: 8,
    fleeOutnumberRatio: 1.4,
    battleApproachEnemy: 1,
    battleTitanValue: 80,
    battleMoveThreshold: 0,
    skipReinforceChance: 1,
    skipSummonChance: 1,
    musterGreed: 1,
    // Mid-battle concede = full points; never gift that when combat wipe is half
    concedeWhenHopelessChance: 0,
  },
  aggressive: {
    id: 'aggressive',
    label: 'Aggressive',
    blurb: 'Hunts fights; growth is secondary.',
    splitChance: 0.25,
    preferAngelOnTurn1: 0.55,
    continueMovingChance: 0.9,
    preferAttackWeight: 35,
    attackEvenIfWeakerBonus: 18,
    attackAppetite: 1.15,
    recruitPreference: 0.95,
    fightLossPenalty: 0.7,
    strongMoveThreshold: 3,
    /** 0 = never use ratio alone; crushing flee uses a higher bar in engagementDecision */
    fleeOutnumberRatio: 0,
    battleApproachEnemy: 1.4,
    battleTitanValue: 120,
    battleMoveThreshold: -2,
    skipReinforceChance: 0.4,
    skipSummonChance: 0.3,
    musterGreed: 0.85,
    concedeWhenHopelessChance: 0,
  },
  cautious: {
    id: 'cautious',
    label: 'Cautious',
    blurb: 'Muster and avoid; flees bad fights.',
    splitChance: 0.2,
    preferAngelOnTurn1: 0.85,
    continueMovingChance: 0.55,
    preferAttackWeight: 8,
    attackEvenIfWeakerBonus: 0,
    attackAppetite: 0.28,
    recruitPreference: 2.1,
    fightLossPenalty: 1.45,
    strongMoveThreshold: 12,
    fleeOutnumberRatio: 1.5,
    battleApproachEnemy: 0.6,
    battleTitanValue: 100,
    battleMoveThreshold: 1,
    skipReinforceChance: 0.5,
    skipSummonChance: 0.6,
    musterGreed: 0.7,
    concedeWhenHopelessChance: 0,
  },
  expander: {
    id: 'expander',
    label: 'Expander',
    blurb: 'Splits and musters hard; fights only juicy targets.',
    splitChance: 0.65,
    preferAngelOnTurn1: 0.75,
    continueMovingChance: 0.8,
    preferAttackWeight: 14,
    attackEvenIfWeakerBonus: 4,
    attackAppetite: 0.4,
    recruitPreference: 2.25,
    fightLossPenalty: 1.15,
    strongMoveThreshold: 6,
    fleeOutnumberRatio: 2.2,
    battleApproachEnemy: 1,
    battleTitanValue: 80,
    battleMoveThreshold: 0,
    skipReinforceChance: 0.2,
    skipSummonChance: 0.2,
    musterGreed: 1,
    concedeWhenHopelessChance: 0,
  },
}

/** Setup / UI choices including Random. */
export const AI_PROFILE_CHOICES: { id: AiProfileId; label: string }[] = [
  { id: 'balanced', label: 'Balanced' },
  { id: 'aggressive', label: 'Aggressive' },
  { id: 'cautious', label: 'Cautious' },
  { id: 'expander', label: 'Expander' },
  { id: 'random', label: 'Random' },
]

export function resolveAiProfileId(
  choice: AiProfileId | null | undefined,
  rng: () => number,
): ResolvedAiProfileId | null {
  if (choice == null) return null
  if (choice === 'random') {
    return RESOLVED_IDS[Math.floor(rng() * RESOLVED_IDS.length)]!
  }
  return choice
}

export function profileFor(id: ResolvedAiProfileId | null | undefined): AiProfile {
  return AI_PROFILES[id ?? 'balanced']
}
