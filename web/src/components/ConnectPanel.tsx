/**
 * The connect affordance: paste a ServerStore key, connect, see who `whoami`
 * says you are, and forget the key again.
 *
 * The key is validated against the store BEFORE it is remembered — see
 * `connect.ts` for the ordering and `keyStorage.ts` for the one place it is
 * written down. This component renders the outcome and nothing else; it changes
 * no game behaviour.
 *
 * The connection state is a PROP, not a hook call of its own: the lobby must see
 * the same identity as this panel, and two `useConnection()` calls would be two
 * identities (and two stored-key re-validations). `SetupScreen` calls the hook
 * once and hands the one state to both panels.
 */

import { useCallback, useState } from 'react'
import { isConnected } from '../net/keyStore'
import type { ConnectionState } from '../net/useConnection'
import { serverStoreBaseUrl } from '../net/serverStore'

interface Props {
  connection: ConnectionState
}

export function ConnectPanel({ connection }: Props) {
  const { identity, failure, busy, loaded, submit, clear } = connection
  const [entry, setEntry] = useState('')

  const onConnect = useCallback(async () => {
    await submit(entry)
    // Keep the typed key on screen when it was refused, so the player can see
    // and correct it; drop it once the store accepted it.
    if (isConnected()) setEntry('')
  }, [entry, submit])

  return (
    <section className="connect-panel" aria-label="ServerStore connection">
      <h2>ServerStore</h2>
      {identity ? (
        <>
          <p className="connect-identity">
            Connected as <strong>{identity.label}</strong>{' '}
            <span className="muted">
              id {identity.id} · stores {identity.stores.join(', ') || 'none'} · perms{' '}
              {identity.perms.join(', ') || 'none'}
            </span>
          </p>
          <div className="connect-actions">
            <button type="button" className="ghost" onClick={clear}>
              Forget key
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="connect-hint">
            Paste a ServerStore key to connect. It is checked against the store immediately
            and only saved to this browser&rsquo;s local storage if it works.
          </p>
          <div className="connect-row">
            <input
              type="password"
              name="serverstore-key"
              aria-label="ServerStore key"
              autoComplete="off"
              spellCheck={false}
              placeholder="ssk_…"
              value={entry}
              onChange={(e) => setEntry(e.target.value)}
            />
            <button type="button" className="primary" onClick={onConnect} disabled={busy}>
              {busy ? 'Connecting…' : 'Connect'}
            </button>
          </div>
          <p className="connect-endpoint muted">
            {serverStoreBaseUrl()}
            {!loaded && ' · checking a saved key…'}
          </p>
          {failure && (
            <p className="connect-failure" role="alert">
              {failure.title} <span className="connect-code">{failure.code}</span> {failure.message}
            </p>
          )}
        </>
      )}
    </section>
  )
}
