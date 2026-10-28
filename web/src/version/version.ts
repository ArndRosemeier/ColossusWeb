/**
 * The app's version and its "What's new" history — ONE seam.
 *
 * `changelog.json` is the only place a version lives: newest entry first, the
 * oldest is 1.00, and each entry is exactly 0.01 above the one below it. The
 * current version is simply the newest entry. Every change merged to master
 * adds one entry on top (see AGENTS.md, "Versioning"); CI refuses a pull
 * request that does not.
 */
import rawChangelog from './changelog.json'

export interface ChangelogEntry {
  /** "1.00", "1.01", ... always two decimals. */
  version: string
  /** ISO date, YYYY-MM-DD. */
  date: string
  /** One plain-language line per change, as the player would describe it. */
  changes: string[]
}

export const FIRST_VERSION = '1.00'

const VERSION_RE = /^(\d+)\.(\d{2})$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** "1.07" → 107. Throws on anything that is not a two-decimal version. */
export function versionToHundredths(version: string): number {
  const m = VERSION_RE.exec(version)
  if (m === null) throw new Error(`Invalid version "${version}": expected a number with two decimals, like 1.00`)
  return Number(m[1]) * 100 + Number(m[2])
}

/** 107 → "1.07". */
export function hundredthsToVersion(hundredths: number): string {
  return `${Math.floor(hundredths / 100)}.${String(hundredths % 100).padStart(2, '0')}`
}

/**
 * Validate the raw changelog. Any defect throws: a broken changelog must fail
 * the build and the tests loudly, never show a wrong version.
 */
export function parseChangelog(raw: unknown): ChangelogEntry[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new Error('changelog.json must be a non-empty array')
  const entries = raw.map((e: unknown, i): ChangelogEntry => {
    const where = `changelog.json entry ${i}`
    if (typeof e !== 'object' || e === null) throw new Error(`${where} is not an object`)
    const { version, date, changes } = e as Record<string, unknown>
    if (typeof version !== 'string') throw new Error(`${where}: "version" must be a string`)
    versionToHundredths(version)
    if (typeof date !== 'string' || !DATE_RE.test(date)) throw new Error(`${where} (${version}): "date" must be YYYY-MM-DD`)
    if (!Array.isArray(changes) || changes.length === 0 || !changes.every((c) => typeof c === 'string' && c.trim() !== '')) {
      throw new Error(`${where} (${version}): "changes" must be a non-empty list of non-empty strings`)
    }
    return { version, date, changes: changes as string[] }
  })
  const oldest = entries[entries.length - 1]
  if (oldest.version !== FIRST_VERSION) {
    throw new Error(`changelog.json: the oldest entry must be ${FIRST_VERSION}, found ${oldest.version}`)
  }
  for (let i = 0; i < entries.length - 1; i++) {
    const newer = versionToHundredths(entries[i].version)
    const older = versionToHundredths(entries[i + 1].version)
    if (newer !== older + 1) {
      throw new Error(
        `changelog.json: ${entries[i].version} must come right after ${entries[i + 1].version} ` +
          `(expected ${hundredthsToVersion(older + 1)}; newest first, steps of 0.01)`,
      )
    }
  }
  return entries
}

export const CHANGELOG: readonly ChangelogEntry[] = parseChangelog(rawChangelog)

/** The running app's version, e.g. "1.00". */
export const APP_VERSION: string = CHANGELOG[0].version
