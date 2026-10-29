/** Exact binomial strike expectations. The modal recurrence avoids underflow at large Titan powers. */
export function strikeExpectations(dice: number, need: number, hp: number, carryCapacity = 0) {
  if (!Number.isSafeInteger(dice) || dice < 0 || !Number.isInteger(need) || need < 1 || need > 6 ||
      !Number.isFinite(hp) || hp < 0 || !Number.isFinite(carryCapacity) || carryCapacity < 0) {
    throw new Error('Invalid tactical strike probability input')
  }
  const p = (7 - need) / 6
  let expectedDamage = 0, killProbability = 0, expectedOverflow = 0
  if (p === 1 || dice === 0) {
    const hits = p === 1 ? dice : 0
    return { expectedHits: dice * p, expectedDamage: Math.min(hits, hp), killProbability: Number(hits >= hp),
      expectedOverflow: Math.min(Math.max(0, hits - hp), carryCapacity) }
  }
  const mode = Math.floor((dice + 1) * p)
  const weights = new Float64Array(dice + 1)
  weights[mode] = 1
  for (let k = mode; k > 0; k--) weights[k - 1] = weights[k] * k / (dice - k + 1) * (1 - p) / p
  for (let k = mode; k < dice; k++) weights[k + 1] = weights[k] * (dice - k) / (k + 1) * p / (1 - p)
  let total = 0
  for (const weight of weights) total += weight
  for (let hits = 0; hits <= dice; hits++) {
    const probability = weights[hits] / total
    expectedDamage += probability * Math.min(hits, hp)
    if (hits >= hp) killProbability += probability
    expectedOverflow += probability * Math.min(Math.max(0, hits - hp), carryCapacity)
  }
  return { expectedHits: dice * p, expectedDamage, killProbability: Math.max(0, Math.min(1, killProbability)), expectedOverflow }
}
