/**
 * The UI half of the pin "a failure is never silent": whatever the transport
 * throws, the panel renders a code AND a message, and the service's own words
 * survive to the screen verbatim.
 */

import { describe, expect, it } from 'vitest'
import { describeFailure } from '../failure'
import { ServerStoreError } from '../transport'

describe('describeFailure', () => {
  it('carries the service code and the service message through unchanged', () => {
    const described = describeFailure(
      new ServerStoreError('forbidden', 'this key may not read store "colossus"', 403),
    )
    expect(described.code).toBe('forbidden')
    expect(described.message).toBe('this key may not read store "colossus"')
    expect(described.title).not.toBe('')
  })

  it('names a network failure as its own kind, with its message kept', () => {
    const described = describeFailure(new ServerStoreError('transport_error', 'Failed to fetch'))
    expect(described.code).toBe('transport_error')
    expect(described.message).toMatch(/Failed to fetch/)
  })

  it('never renders an empty message for an error that is not a ServerStoreError', () => {
    const described = describeFailure(new Error('boom'))
    expect(described.code).toBe('unknown')
    expect(described.message).toBe('boom')
    expect(describeFailure('a string').message).toBe('a string')
    expect(describeFailure(undefined).message).toBe('undefined')
  })
})
