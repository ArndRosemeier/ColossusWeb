/** Exact owner face color is never inferred from a captured marker's foreign ID. */
export function markerInk(color: string): '#07111a' | '#ffffff' {
  const match = /^#([\da-f]{6})$/i.exec(color)
  if (!match) return '#ffffff'
  const rgb = [0, 2, 4].map(i => parseInt(match[1].slice(i, i + 2), 16) / 255)
    .map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  const luminance = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722
  return (luminance + 0.05) / (0.005206498 + 0.05) > 1.05 / (luminance + 0.05) ? '#07111a' : '#ffffff'
}

const CRESTS = [
  'M29 41 L24 20 L39 29 L48 13 L57 29 L72 20 L67 41 Z M30 46 H66',
  'M48 12 L55 27 L72 30 L59 42 L62 58 L48 50 L34 58 L37 42 L24 30 L41 27 Z',
  'M47 12 L62 32 L54 32 L54 56 L42 56 L42 32 L34 32 Z M29 43 H67',
  'M28 17 L48 24 L68 17 L64 44 L48 58 L32 44 Z M48 25 V49 M36 32 H60',
  'M27 23 L38 13 L48 28 L58 13 L69 23 L59 40 L48 57 L37 40 Z M36 36 H60',
  'M26 47 L36 30 L48 15 L60 30 L70 47 L56 43 L48 56 L40 43 Z M48 23 V44',
  'M25 17 L48 27 L71 17 L62 38 L69 53 L48 45 L27 53 L34 38 Z',
  'M48 13 L67 24 V45 L48 57 L29 45 V24 Z M39 24 L57 45 M57 24 L39 45',
] as const

/** Full ID seeds the emblem; the full printed ID remains the definitive identity. */
export function markerCrest(markerId: string): string {
  let hash = 0
  for (const char of markerId) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0
  return CRESTS[hash % CRESTS.length]
}
