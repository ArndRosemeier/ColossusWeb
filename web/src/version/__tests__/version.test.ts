import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { APP_VERSION, CHANGELOG, hundredthsToVersion, parseChangelog, versionToHundredths } from '../version'
import { WhatsNewContent } from '../../components/WhatsNew'

const entry = (version: string) => ({ version, date: '2026-10-28', changes: ['Something changed'] })

describe('version', () => {
  it('is the newest changelog entry, and the history starts at 1.00', () => {
    expect(APP_VERSION).toBe(CHANGELOG[0].version)
    expect(CHANGELOG[CHANGELOG.length - 1].version).toBe('1.00')
  })

  it('converts between text and hundredths', () => {
    expect(versionToHundredths('1.00')).toBe(100)
    expect(versionToHundredths('1.09')).toBe(109)
    expect(versionToHundredths('2.10')).toBe(210)
    expect(hundredthsToVersion(199)).toBe('1.99')
    expect(hundredthsToVersion(200)).toBe('2.00')
    expect(() => versionToHundredths('1.1')).toThrow(/two decimals/)
  })

  it('accepts a newest-first history in steps of 0.01, across 1.99 -> 2.00', () => {
    const history = [
      entry('2.01'),
      entry('2.00'),
      entry('1.99'),
      ...Array.from({ length: 99 }, (_, i) => entry(hundredthsToVersion(198 - i))),
    ]
    expect(parseChangelog(history)[0].version).toBe('2.01')
  })

  it('refuses gaps, wrong order, a wrong start and empty changes', () => {
    expect(() => parseChangelog([entry('1.02'), entry('1.00')])).toThrow(/expected 1.01/)
    expect(() => parseChangelog([entry('1.00'), entry('1.01')])).toThrow()
    expect(() => parseChangelog([entry('1.01')])).toThrow(/oldest entry must be 1.00/)
    expect(() => parseChangelog([{ ...entry('1.00'), changes: [] }])).toThrow(/changes/)
    expect(() => parseChangelog([])).toThrow(/non-empty/)
  })

  it("lists every version in the What's new dialog", () => {
    const html = renderToStaticMarkup(createElement(WhatsNewContent, { entries: CHANGELOG, onClose: () => {} }))
    for (const e of CHANGELOG) expect(html).toContain(`Version ${e.version}`)
  })
})
