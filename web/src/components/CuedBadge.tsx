/**
 * Who cued says is playing — the avatar and name, or why the pass is unusable.
 * Presentational (`cuedBadge.test.ts`). Renders nothing without a pass, so a
 * game not opened from cued looks exactly as before.
 */

import type { CuedPlayer } from '../net/cuedPlayer'

export function CuedBadge({ cued, compact = false }: { cued: CuedPlayer; compact?: boolean }) {
  if (cued.failure) {
    return (
      <p className="connect-failure cued-badge" role="alert">
        {cued.failure.title} <span className="connect-code">{cued.failure.code}</span> {cued.failure.message}
      </p>
    )
  }
  const identity = cued.identity
  if (identity === null) return null
  if (cued.expired) {
    return (
      <p className="hint cued-badge" role="status">
        Your cued pass has expired — reopen Colossus from cued to play as {identity.name}.
      </p>
    )
  }
  const avatar = identity.avatarUrl ? (
    <img className="cued-avatar" src={identity.avatarUrl} alt="" width={compact ? 22 : 32} height={compact ? 22 : 32} />
  ) : (
    <span
      className="cued-avatar cued-initials"
      aria-hidden="true"
      style={{ background: identity.circle.background, color: identity.circle.text }}
    >
      {identity.initials}
    </span>
  )
  return (
    <span className={`cued-badge${compact ? ' cued-badge-compact' : ''}`} data-player={identity.playerId}>
      {avatar}
      <span>
        {compact ? identity.name : <>Playing as <strong>{identity.name}</strong> · via cued</>}
      </span>
    </span>
  )
}
