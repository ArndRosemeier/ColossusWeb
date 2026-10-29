// Usage: node scripts/import-creature-animations.mjs <approved creature-collection directory>
// Copies accepted PNG atlases byte-for-byte; metadata, not image heuristics, drives playback.
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = resolve(process.argv[2] ?? (() => { throw Error('Supply approved creature-collection directory') })())
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'))
const manifest = await readJson(resolve(source, 'manifest.json'))
const expected = 'Angel Archangel Behemoth Centaur Colossus Cyclops Dragon Gargoyle Giant Gorgon Griffon Guardian Hydra Lion Minotaur Ogre Ranger Serpent Titan Troll Unicorn Warbear Warlock Wyvern'.split(' ')
if (JSON.stringify(manifest.creatures.map(c => c.name).sort()) !== JSON.stringify([...expected].sort())) throw Error('Expected all 24 standard creatures exactly once')
const registry = {}
const provenance = { description: 'Approved full-color creature collection, 2026-10-29. PNGs copied without alteration.', inputs: {} }
provenance.inputs['manifest.json'] = createHash('sha256').update(await readFile(resolve(source, 'manifest.json'))).digest('hex')
for (const creature of manifest.creatures) {
  const name = creature.name
  if (creature.directory !== name) throw Error(`Invalid directory: ${name}`)
  const metadataPath = `${name}/animation.json`
  const metadataBytes = await readFile(resolve(source, metadataPath))
  const metadata = JSON.parse(metadataBytes.toString('utf8'))
  provenance.inputs[metadataPath] = createHash('sha256').update(metadataBytes).digest('hex')
  registry[name] = {}
  for (const state of ['resting', 'moving', 'attacking']) {
    // Dragon predates the collection schema. Its atlas geometry is explicit here.
    const info = name === 'Dragon' ? metadata[state] : metadata.states[state]
    const frames = info.frames
    const durations = name === 'Dragon' ? info.frame_durations_ms : info.durations
    const columns = name === 'Dragon' ? info.atlas_grid[0] : info.columns
    const frameSize = name === 'Dragon' ? info.atlas_frame_size[0] : info.frameSize
    const rows = name === 'Dragon' ? info.atlas_grid[1] : Math.ceil(frames / columns)
    const atlas = name === 'Dragon' ? `${name}/${state}-atlas.png` : info.atlas
    if (frames !== (name === 'Dragon' ? 12 : 8) || durations.length !== frames || !durations.every(d => Number.isInteger(d) && d > 0)) throw Error(`Invalid timeline: ${name}/${state}`)
    if (atlas !== `${name}/${state}-atlas.png` || !Number.isInteger(columns) || columns < 1 || !Number.isInteger(frameSize) || frameSize < 1 || columns * rows !== frames) throw Error(`Invalid grid: ${name}/${state}`)
    const bytes = await readFile(resolve(source, atlas))
    if (bytes.toString('hex', 0, 8) !== '89504e470d0a1a0a' || bytes.readUInt32BE(16) !== columns * frameSize || bytes.readUInt32BE(20) !== rows * frameSize) throw Error(`PNG dimensions disagree with metadata: ${atlas}`)
    await mkdir(resolve(root, 'public/creature-animations', name), { recursive: true })
    await copyFile(resolve(source, atlas), resolve(root, 'public/creature-animations', atlas))
    provenance.inputs[atlas] = createHash('sha256').update(bytes).digest('hex')
    registry[name][state] = { atlas, columns, rows, frameSize, durations }
  }
}
await writeFile(resolve(root, 'src/ui/creatureAnimationRegistry.json'), JSON.stringify(registry) + '\n')
await writeFile(resolve(root, 'public/creature-animations/provenance.json'), JSON.stringify(provenance, null, 2) + '\n')
console.log('Imported 24 creatures, 72 PNG atlases; validated geometry and every timeline.')
