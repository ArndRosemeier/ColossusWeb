/**
 * Turning a connection failure into something a person can read — WITHOUT
 * hiding the service's own words.
 *
 * The store's error envelope carries a `code` and a `message`; both survive
 * into the UI (`AGENTS.md` rule 1: a failure is never silent, and errors are
 * visible through the app's one error surface).
 */

import { ServerStoreError } from './transport'

export interface FailureDescription {
  /** A short human sentence naming what happened. */
  title: string
  /** The service's own code, kept for a caller that wants to branch on it. */
  code: string
  /** The service's own message, verbatim. */
  message: string
}

export function describeFailure(error: unknown): FailureDescription {
  if (error instanceof ServerStoreError) {
    return {
      title: 'The store refused the key.',
      code: error.code,
      message: error.message,
    }
  }
  const message = error instanceof Error ? error.message : String(error)
  return { title: 'Could not reach the store.', code: 'unknown', message }
}
