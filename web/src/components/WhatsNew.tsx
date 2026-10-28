import { useEffect, useRef, useState } from 'react'
import { APP_VERSION, CHANGELOG, type ChangelogEntry } from '../version/version'

/**
 * The version number plus its "What's new" dialog. Shown on the setup screen
 * and in the in-game top bar. A small dot marks a version the player has not
 * opened yet (remembered per browser; losing that memory only re-shows the dot).
 */

const SEEN_KEY = 'colossusweb.whatsNewSeen.v1'

function readSeen(): string | null {
  try {
    return localStorage.getItem(SEEN_KEY)
  } catch {
    return null
  }
}

function writeSeen(version: string): void {
  try {
    localStorage.setItem(SEEN_KEY, version)
  } catch {
    // Storage blocked: the "unseen" dot just keeps showing. Nothing else depends on it.
  }
}

export function WhatsNewButton({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false)
  const [unseen, setUnseen] = useState(() => readSeen() !== APP_VERSION)

  const show = () => {
    setOpen(true)
    setUnseen(false)
    writeSeen(APP_VERSION)
  }

  return (
    <>
      <button
        type="button"
        className={`ghost version-button${compact ? ' compact' : ''}`}
        onClick={show}
        title="What's new"
        aria-label={`Version ${APP_VERSION}. What's new`}
      >
        <span className="version-number">v{APP_VERSION}</span>
        {!compact && <span className="version-label">What&apos;s new</span>}
        {unseen && <span className="version-dot" aria-hidden="true" />}
      </button>
      {open && <WhatsNewDialog onClose={() => setOpen(false)} />}
    </>
  )
}

function WhatsNewDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (dialog !== null && !dialog.open) dialog.showModal()
  }, [])

  return (
    <dialog
      ref={ref}
      className="whats-new-dialog"
      aria-labelledby="whats-new-title"
      onClose={onClose}
      onClick={(e) => {
        // A click on the backdrop lands on the <dialog> itself.
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <WhatsNewContent entries={CHANGELOG} onClose={onClose} />
    </dialog>
  )
}

/** The dialog's body, separate so it can be rendered in tests without a browser. */
export function WhatsNewContent({ entries, onClose }: { entries: readonly ChangelogEntry[]; onClose: () => void }) {
  return (
    <div className="whats-new">
      <div className="whats-new-head">
        <h2 id="whats-new-title">What&apos;s new</h2>
        <button type="button" className="ghost" onClick={onClose} aria-label="Close">
          Close
        </button>
      </div>
      <ol className="whats-new-list">
        {entries.map((entry, i) => (
          <li key={entry.version} className="whats-new-entry">
            <h3>
              Version {entry.version}
              {i === 0 && <span className="whats-new-current">current</span>}
              <span className="whats-new-date">{entry.date}</span>
            </h3>
            <ul>
              {entry.changes.map((change, j) => (
                <li key={j}>{change}</li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </div>
  )
}
