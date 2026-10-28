#!/usr/bin/env node
// check-version-bump.mjs — every change merged to master adds exactly one
// "What's new" entry, so the version goes up by exactly 0.01.
//
// Usage: node scripts/check-version-bump.mjs <base-ref>     (e.g. origin/master)
// Compares web/src/version/changelog.json at <base-ref> with the working tree.
// The full shape of the changelog (1.00 start, 0.01 steps) is checked by the
// unit tests; this only checks that THIS change bumped it once.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const FILE = 'web/src/version/changelog.json'
const base = process.argv[2]
if (!base) {
  console.error('usage: node scripts/check-version-bump.mjs <base-ref>')
  process.exit(2)
}

const toHundredths = (v) => {
  const m = /^(\d+)\.(\d{2})$/.exec(v)
  if (!m) throw new Error(`invalid version "${v}" in ${FILE}`)
  return Number(m[1]) * 100 + Number(m[2])
}

const head = JSON.parse(readFileSync(FILE, 'utf8'))
let baseText
try {
  baseText = execFileSync('git', ['show', `${base}:${FILE}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
} catch {
  // The changelog does not exist on the base yet: this is the change that introduces it.
  console.log(`${FILE} is new in this change (version ${head[0].version}). OK.`)
  process.exit(0)
}
const prev = JSON.parse(baseText)

const was = prev[0].version
const now = head[0].version
if (toHundredths(now) !== toHundredths(was) + 1 || head.length !== prev.length + 1) {
  console.error(
    `Version not bumped correctly: ${base} is at ${was}, this change is at ${now} with ` +
      `${head.length - prev.length} new entr(ies).\n` +
      `Add exactly one new entry at the TOP of ${FILE} with version ` +
      `${((toHundredths(was) + 1) / 100).toFixed(2)} and a line for each player-visible change.\n` +
      `If master moved on while this was open, merge it in and renumber your entry.`,
  )
  process.exit(1)
}
console.log(`Version ${was} -> ${now}. OK.`)
