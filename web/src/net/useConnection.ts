/**
 * The panel's view of the connection lifecycle: identity, the refusal that
 * stopped it, and the two actions (connect, forget).
 *
 * The ordering rules live in `connect.ts`; this hook only renders their result.
 * On mount it re-validates a stored key — the owner's "immediately reject it if
 * it does not work" applies to a key from an earlier visit just as much as to
 * one just pasted.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { connect, forget, restoreStoredKey } from './connect'
import { describeFailure, type FailureDescription } from './failure'
import { isConnected } from './keyStore'
import { createServerStoreTransport } from './serverStore'
import type { StoreIdentity } from './transport'

export interface ConnectionState {
  identity: StoreIdentity | null
  failure: FailureDescription | null
  busy: boolean
  /** The stored key is re-validated before the player is treated as connected. */
  loaded: boolean
  submit: (candidate: string) => Promise<void>
  clear: () => void
}

export function useConnection(): ConnectionState {
  const [identity, setIdentity] = useState<StoreIdentity | null>(null)
  const [failure, setFailure] = useState<FailureDescription | null>(null)
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const restoreRan = useRef(false)

  useEffect(() => {
    if (restoreRan.current) return
    restoreRan.current = true
    void (async () => {
      try {
        const restored = await restoreStoredKey(createServerStoreTransport())
        setIdentity(restored)
      } catch (error) {
        setFailure(describeFailure(error))
      } finally {
        setLoaded(true)
      }
    })()
  }, [])

  const submit = useCallback(async (candidate: string) => {
    if (candidate.trim().length === 0) {
      setFailure({
        title: 'No key entered.',
        code: 'no_key',
        message: 'Paste a ServerStore key first.',
      })
      return
    }
    setBusy(true)
    setFailure(null)
    try {
      setIdentity(await connect(createServerStoreTransport(), candidate))
    } catch (error) {
      setIdentity(null)
      setFailure(describeFailure(error))
    } finally {
      setBusy(false)
    }
  }, [])

  const clear = useCallback(() => {
    forget()
    setIdentity(null)
    setFailure(null)
  }, [])

  return {
    identity: identity !== null && isConnected() ? identity : null,
    failure,
    busy,
    loaded,
    submit,
    clear,
  }
}
